enum ScanOutcome {
  success,       // Gate In or Gate Out successful
  alreadyIn,     // Already checked in (duplicate gate_in)
  alreadyOut,    // Already checked out
  notCheckedIn,  // Trying gate_out but ticket never checked in
  invalidToken,  // QR code not found in system
  cancelled,     // Ticket is cancelled
  wrongEvent,    // Ticket is for a different event
  capacityFull,  // Event at max capacity
  serverError,   // Server returned unexpected error
  networkError,  // No network
}

class ScanResultModel {
  final ScanOutcome outcome;
  final String message;
  final String? attendeeName;
  final String? ticketCode;
  final String? scanType;
  final String? gateName;
  final DateTime? scannedAt;
  final Map<String, dynamic>? rawData;

  ScanResultModel({
    required this.outcome,
    required this.message,
    this.attendeeName,
    this.ticketCode,
    this.scanType,
    this.gateName,
    this.scannedAt,
    this.rawData,
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

    ScanOutcome outcome;
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
      case 'event_cancelled':
      case 'expired':
      case 'event_expired':
        outcome = ScanOutcome.cancelled;
        break;
      case 'wrong_event':
      case 'early_scan':
      case 'early_date':
        outcome = ScanOutcome.wrongEvent;
        break;
      case 'capacity_full':
        outcome = ScanOutcome.capacityFull;
        break;
      default:
        outcome = ScanOutcome.serverError;
    }

    final ticketData = json['ticket'] is Map ? json['ticket'] as Map : null;
    final name = json['attendee_name']?.toString() ??
        ticketData?['attendee_name']?.toString();

    return ScanResultModel(
      outcome: outcome,
      message: message,
      attendeeName: name,
      ticketCode: ticketData?['ticket_number']?.toString() ?? qrToken,
      scanType: json['scan_type']?.toString(),
      gateName: json['gate_name']?.toString(),
      scannedAt: DateTime.tryParse(json['scanned_at']?.toString() ?? '') ?? DateTime.now(),
      rawData: json,
    );
  }

  factory ScanResultModel.networkError() => ScanResultModel(
        outcome: ScanOutcome.networkError,
        message: 'Offline: QR scan queued locally for synchronization.',
      );

  factory ScanResultModel.serverError(String msg) => ScanResultModel(
        outcome: ScanOutcome.serverError,
        message: msg,
      );
}
