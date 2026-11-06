import 'package:flutter/material.dart';
import '../../models/event_model.dart';
import '../../models/scan_result_model.dart';
import '../../models/ticket_type_model.dart';
import '../../ui/ui.dart';
import 'format.dart';

/// Plain-language headline, tone and icon for every scan outcome.
class ScanCopy {
  final String title;
  final Tone tone;
  final IconData icon;
  const ScanCopy(this.title, this.tone, this.icon);

  static ScanCopy of(ScanResultModel r) {
    final out = r.scanType == 'gate_out';
    switch (r.outcome) {
      case ScanOutcome.success:
        return out
            ? const ScanCopy('Checked out', Tone.success, Icons.check_rounded)
            : const ScanCopy('Let them in', Tone.success, Icons.check_rounded);
      case ScanOutcome.alreadyIn:
        return const ScanCopy('Already inside', Tone.danger, Icons.block_rounded);
      case ScanOutcome.alreadyOut:
        return const ScanCopy('Already checked out', Tone.warning, Icons.logout_rounded);
      case ScanOutcome.notCheckedIn:
        return const ScanCopy('Not checked in', Tone.warning, Icons.error_outline_rounded);
      case ScanOutcome.invalidToken:
        return const ScanCopy('Ticket not found', Tone.danger, Icons.close_rounded);
      case ScanOutcome.cancelled:
        return const ScanCopy('Ticket not valid', Tone.danger, Icons.close_rounded);
      case ScanOutcome.unpaid:
        return const ScanCopy('Not paid', Tone.danger, Icons.money_off_rounded);
      case ScanOutcome.eventCancelled:
        return const ScanCopy('Event cancelled', Tone.danger, Icons.event_busy_rounded);
      case ScanOutcome.eventEnded:
        return const ScanCopy('Event has ended', Tone.danger, Icons.event_busy_rounded);
      case ScanOutcome.tooEarly:
        return const ScanCopy('Too early', Tone.danger, Icons.schedule_rounded);
      case ScanOutcome.wrongEvent:
        return const ScanCopy('Not valid here', Tone.danger, Icons.close_rounded);
      case ScanOutcome.wrongTicketGate:
        return const ScanCopy('Wrong entrance', Tone.danger, Icons.do_not_disturb_on_outlined);
      case ScanOutcome.capacityFull:
        return const ScanCopy('Venue is full', Tone.danger, Icons.groups_rounded);
      case ScanOutcome.networkError:
        return const ScanCopy('Saved offline', Tone.warning, Icons.cloud_off_rounded);
      case ScanOutcome.serverError:
        return const ScanCopy("Couldn't check ticket", Tone.danger, Icons.error_outline_rounded);
    }
  }
}

String scanTypeLabel(String? type) => type == 'gate_out' ? 'Gate out' : 'Gate in';

/// Pass fields for the ticket type, payment (amount due at the venue, or how it was paid) and gate note.
List<PassField> ticketTypeFields(TicketTypeInfo t) => [
      if (t.hasName) PassField('Ticket type', t.name),
      if (t.hasPriceDue)
        PassField('Pay at venue', t.priceLabel)
      else if (t.paymentNote != null)
        PassField('Payment', t.paymentNote!),
      if (t.promoCode != null) PassField('Promo code', t.promoCode!, mono: true),
      if (t.hasGateNote) PassField('Gate note', t.gateNote),
    ];

TicketPass passFromScan(ScanResultModel r, {EventModel? event, String? gate}) {
  final copy = ScanCopy.of(r);
  return TicketPass(
    eventTitle: event?.title ?? 'Eventlaya event',
    eventSubtitle: event == null ? null : [event.venue, if (event.date != null) Fmt.date(event.date)].join(' · '),
    attendeeName: (r.attendeeName?.isNotEmpty ?? false) ? r.attendeeName! : 'Unknown attendee',
    ticketCode: r.ticketCode,
    qrData: r.qrToken ?? r.ticketCode,
    statusLabel: copy.title,
    statusTone: copy.tone,
    fields: [
      ...ticketTypeFields(r.ticketType),
      PassField('Scan', scanTypeLabel(r.scanType)),
      PassField('Gate', r.gateName ?? gate ?? '—'),
      PassField('Time', Fmt.time(r.scannedAt)),
      PassField('Result', r.message),
    ],
  );
}

TicketPass passFromAttendee(Map<String, dynamic> a, {EventModel? event}) {
  final status = a['status']?.toString();
  return TicketPass(
    eventTitle: event?.title ?? 'Eventlaya event',
    eventSubtitle: event == null ? null : [event.venue, if (event.date != null) Fmt.date(event.date)].join(' · '),
    attendeeName: a['attendee_name']?.toString() ?? 'Attendee',
    ticketCode: a['ticket_number']?.toString(),
    qrData: a['qr_token']?.toString() ?? a['ticket_number']?.toString(),
    statusLabel: TicketStatus.label(status),
    statusTone: TicketStatus.tone(status),
    fields: [
      ...ticketTypeFields(TicketTypeInfo.fromTicket(a)),
      if ((a['attendee_email']?.toString() ?? '').isNotEmpty) PassField('Email', a['attendee_email'].toString()),
      if ((a['attendee_phone']?.toString() ?? '').isNotEmpty) PassField('Phone', a['attendee_phone'].toString()),
      if (a['first_check_in'] != null) PassField('First check-in', Fmt.timeIso(a['first_check_in'].toString())),
      if (a['last_activity'] != null) PassField('Last activity', Fmt.timeIso(a['last_activity'].toString())),
    ],
  );
}
