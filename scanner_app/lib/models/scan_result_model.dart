import 'package:intl/intl.dart';
import 'ticket_type_model.dart';

enum ScanOutcome {
  success,         // Gate In or Gate Out successful
  alreadyIn,       // Already checked in (duplicate gate_in)
  alreadyOut,      // Already checked out
  notCheckedIn,    // Trying gate_out but ticket never checked in
  invalidToken,    // QR code not found in system
  cancelled,       // Ticket is cancelled
  unpaid,          // Online payment not completed (ticket held or released)
  eventCancelled,  // The whole event was cancelled
  eventEnded,      // The event is over; scans closed
  tooEarly,        // More than a day before the event
  wrongEvent,      // Ticket is for a different event
  wrongTicketGate, // Ticket type isn't allowed at this gate (e.g. VIP at Main gate)
  capacityFull,    // Event at max capacity
  serverError,     // Server returned unexpected error
  networkError,    // No network
}

class ScanResultModel {
  final ScanOutcome outcome;
  final String message;
  final String? attendeeName;
  final String? ticketCode;

  /// The raw token that was scanned or typed.
  final String? qrToken;
  final String? scanType;
  final String? gateName;
  final DateTime? scannedAt;
  final Map<String, dynamic>? rawData;

  /// Ticket type, price due and gate note. Empty for offline/legacy scans.
  final TicketTypeInfo ticketType;

  /// Seat ("A-12") when the organizer assigned one; empty otherwise.
  final String seatNumber;

  /// Guest tags (VIP, Press...) and the organizer's note for this guest (module guest_management).
  final List<String> guestTags;
  final String hostNote;

  ScanResultModel({
    required this.outcome,
    required this.message,
    this.attendeeName,
    this.ticketCode,
    this.qrToken,
    this.scanType,
    this.gateName,
    this.scannedAt,
    this.rawData,
    this.ticketType = TicketTypeInfo.empty,
    this.seatNumber = '',
    this.guestTags = const [],
    this.hostNote = '',
  });

  bool get isSuccess => outcome == ScanOutcome.success;
  bool get isWarning =>
      outcome == ScanOutcome.alreadyIn ||
      outcome == ScanOutcome.alreadyOut ||
      outcome == ScanOutcome.notCheckedIn;
  bool get isError => !isSuccess && !isWarning;

  factory ScanResultModel.fromJson(Map<String, dynamic> json, String qrToken) {
    final status = (json['status'] ?? json['result'])?.toString() ?? '';
    final message = json['message']?.toString() ?? 'Scan processed';

    final result = json['result']?.toString() ?? '';

    ScanOutcome outcome;
    if (result == 'wrong_ticket_gate') {
      outcome = ScanOutcome.wrongTicketGate;
    } else if (result == 'unpaid') {
      // Reserved / released online orders. The server also sends status 'cancelled' for older apps.
      outcome = ScanOutcome.unpaid;
    } else {
      switch (status) {
        case 'gate_in':
        case 'gate_out':
        case 're_entry':
        case 'success':
          outcome = ScanOutcome.success;
          break;
        case 'already_in':
        case 'duplicate':
          outcome = ScanOutcome.alreadyIn;
          break;
        case 'already_out':
          outcome = ScanOutcome.alreadyOut;
          break;
        case 'not_checked_in':
        case 'not_in':
          outcome = ScanOutcome.notCheckedIn;
          break;
        case 'invalid':
          outcome = ScanOutcome.invalidToken;
          break;
        case 'cancelled':
          outcome = ScanOutcome.cancelled;
          break;
        case 'event_cancelled':
          outcome = ScanOutcome.eventCancelled;
          break;
        case 'expired':
        case 'event_expired':
          outcome = ScanOutcome.eventEnded;
          break;
        case 'early_scan':
        case 'early_date':
          outcome = ScanOutcome.tooEarly;
          break;
        case 'wrong_gate':
        case 'gate_not_allowed':
        case 'exit_only':
        case 'entry_only':
        case 'gate_inactive':
        case 'wrong_event':
          outcome = ScanOutcome.wrongEvent;
          break;
        case 'capacity_full':
          outcome = ScanOutcome.capacityFull;
          break;
        default:
          outcome = ScanOutcome.serverError;
      }
    }

    final ticketData = json['ticket'] is Map ? json['ticket'] as Map : null;
    final name = json['attendee_name']?.toString() ??
        ticketData?['attendee_name']?.toString();

    return ScanResultModel(
      outcome: outcome,
      message: _friendlyMessage(outcome, message),
      attendeeName: name,
      ticketCode: ticketData?['ticket_number']?.toString() ?? qrToken,
      qrToken: ticketData?['qr_token']?.toString() ?? qrToken,
      scanType: json['scan_type']?.toString(),
      gateName: json['gate_name']?.toString(),
      scannedAt: DateTime.tryParse(json['scanned_at']?.toString() ?? '') ?? DateTime.now(),
      rawData: json,
      ticketType: TicketTypeInfo.fromTicket(ticketData),
      seatNumber: ticketData?['seat_number']?.toString().trim() ?? '',
      guestTags: [
        if (ticketData?['guest_tags'] is List)
          for (final t in ticketData!['guest_tags'] as List) t.toString(),
      ],
      hostNote: ticketData?['host_note']?.toString().trim() ?? '',
    );
  }

  /// Rewrites date-window refusals in plain language using the date in the
  /// server message ("…scheduled for 2026-11-02…"); otherwise keeps it.
  static String _friendlyMessage(ScanOutcome outcome, String message) {
    if (outcome == ScanOutcome.unpaid) {
      final m = message.replaceFirst(RegExp(r'^\W*Entry Denied:\s*', caseSensitive: false), '').trim();
      return "${m.isEmpty ? 'Online payment not completed.' : m} Don't let them in on this pass.";
    }
    if (outcome != ScanOutcome.tooEarly && outcome != ScanOutcome.eventEnded) return message;
    final m = RegExp(r'\d{4}-\d{2}-\d{2}').firstMatch(message);
    final d = m == null ? null : DateTime.tryParse(m.group(0)!);
    if (d == null) return message;
    final fmt = DateFormat('EEE d MMM');
    if (outcome == ScanOutcome.tooEarly) {
      final opens = DateTime(d.year, d.month, d.day - 1);
      return 'Too early. Gates open on ${fmt.format(opens)}; the event starts ${fmt.format(d)}.';
    }
    return 'This event finished on ${fmt.format(d)}. Scans are closed.';
  }

  factory ScanResultModel.networkError({String? qrToken, String? scanType, String? gateName}) =>
      ScanResultModel(
        outcome: ScanOutcome.networkError,
        message: "No connection. This scan is saved and will sync when you're back online.",
        ticketCode: qrToken,
        qrToken: qrToken,
        scanType: scanType,
        gateName: gateName,
        scannedAt: DateTime.now(),
      );

  factory ScanResultModel.serverError(String msg, {String? qrToken, String? scanType, String? gateName}) =>
      ScanResultModel(
        outcome: ScanOutcome.serverError,
        message: msg,
        ticketCode: qrToken,
        qrToken: qrToken,
        scanType: scanType,
        gateName: gateName,
        scannedAt: DateTime.now(),
      );
}
