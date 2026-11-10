import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/notification_service.dart';
import '../../ui/ui.dart';
import '../data/vendor_api.dart';
import '../data/vendor_models.dart';
import '../providers/vendor_providers.dart';
import 'vendor_widgets.dart';
import '../../core/bs_date.dart';

/// Opens a request's detail sheet: customer contact, the slot, Confirm /
/// Decline (with an optional note) and Mark contacted.
Future<void> showRequestDetail(BuildContext context, BookingRequest request) {
  NotificationService.clearBooking(request.id); // seen: drop its push from the shade
  return showAppSheet<void>(context, builder: (_) => _RequestDetail(initial: request));
}

/// Opens the request [id] of [kind] after loading the inbox (push taps).
Future<void> openRequestById(BuildContext context, WidgetRef ref, ListingKind kind, String id) async {
  ref.invalidate(vendorRequestsProvider);
  try {
    final list = await ref.read(vendorRequestsProvider.future);
    final r = list.where((x) => x.id == id && x.kind == kind).firstOrNull;
    if (!context.mounted) return;
    if (r == null) {
      AppToast.info(context, "That request isn't available any more.");
      return;
    }
    await showRequestDetail(context, r);
  } catch (e) {
    if (context.mounted) AppToast.error(context, vendorErrorMessage(e));
  }
}

/// Optional note for the customer. Null = cancelled.
Future<String?> askOwnerNote(BuildContext context, {required bool confirm}) async {
  final ctrl = TextEditingController();
  final result = await showAppSheet<String>(
    context,
    builder: (ctx) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        SheetHeader(
          title: confirm ? 'Confirm booking' : 'Decline request',
          message: confirm
              ? 'The customer gets an email and a notification. Add a note if you like (e.g. advance payment details).'
              : 'The slot opens again for other customers. You can tell the customer why.',
        ),
        TextField(
          controller: ctrl,
          maxLines: 4,
          minLines: 2,
          maxLength: 2000,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(hintText: 'Note for the customer (optional)'),
        ),
        const SizedBox(height: 8),
        PrimaryButton(
          label: confirm ? 'Confirm booking' : 'Decline request',
          icon: confirm ? Icons.check_rounded : Icons.close_rounded,
          tone: confirm ? ButtonTone.success : ButtonTone.danger,
          onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
        ),
        const SizedBox(height: 8),
        PrimaryButton(label: 'Back', tone: ButtonTone.neutral, tonal: true, onPressed: () => Navigator.pop(ctx)),
      ],
    ),
  );
  ctrl.dispose();
  return result;
}

/// Confirm or decline [r] (asks for an optional note first). Returns the
/// updated request, or null when cancelled or failed (an error toast is shown;
/// on 409 request_cancelled / slot_unavailable the data is refreshed).
Future<BookingRequest?> decideRequest(BuildContext context, WidgetRef ref, BookingRequest r,
    {required bool confirm}) async {
  if (!confirm && r.status == RequestStatus.booked) {
    final ok = await confirmSheet(
      context,
      title: 'Cancel this booking?',
      message: 'The customer is told the booking is declined and the slot opens again.',
      confirmLabel: 'Decline booking',
    );
    if (!ok || !context.mounted) return null;
  }
  final note = await askOwnerNote(context, confirm: confirm);
  if (note == null || !context.mounted) return null;
  try {
    final updated = await ref.read(vendorApiProvider).decide(r, confirm: confirm, note: note);
    ref.refreshVendorData();
    if (context.mounted) {
      AppToast.success(context, confirm ? 'Booking confirmed — ${r.senderName} has been told' : 'Request declined');
    }
    return updated;
  } catch (e) {
    final code = vendorErrorCode(e);
    if (code == 'request_cancelled' || code == 'slot_unavailable') ref.refreshVendorData();
    if (context.mounted) AppToast.error(context, vendorErrorMessage(e));
    return null;
  }
}

class _RequestDetail extends ConsumerStatefulWidget {
  final BookingRequest initial;
  const _RequestDetail({required this.initial});

  @override
  ConsumerState<_RequestDetail> createState() => _RequestDetailState();
}

class _RequestDetailState extends ConsumerState<_RequestDetail> {
  late BookingRequest _r = widget.initial;
  String? _busy;

  Future<void> _run(String what, Future<BookingRequest> Function() call, String done, {bool close = false}) async {
    if (_busy != null) return;
    setState(() => _busy = what);
    try {
      final updated = await call();
      if (!mounted) return;
      ref.refreshVendorData();
      AppToast.success(context, done);
      if (close) {
        Navigator.pop(context);
      } else {
        setState(() => _r = updated);
      }
    } catch (e) {
      if (!mounted) return;
      AppToast.error(context, vendorErrorMessage(e));
      final code = vendorErrorCode(e);
      if (code == 'request_cancelled' || code == 'slot_unavailable') {
        ref.refreshVendorData();
        Navigator.pop(context);
      }
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _decide(bool confirm) async {
    if (_busy != null) return;
    setState(() => _busy = confirm ? 'confirm' : 'decline');
    final ok = await decideRequest(context, ref, _r, confirm: confirm);
    if (!mounted) return;
    setState(() => _busy = null);
    if (ok != null) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    // Prefer the freshest copy from the inbox (e.g. after a 409 refresh).
    final r = ref
            .watch(vendorRequestsProvider)
            .valueOrNull
            ?.where((x) => x.id == _r.id && x.kind == _r.kind && !_r.updatedAfter(x))
            .firstOrNull ??
        _r;
    final api = ref.read(vendorApiProvider);
    final created = r.createdAt == null ? null : BsDate.format('d MMM y, HH:mm', r.createdAt!);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(children: [
          InitialsAvatar(name: r.senderName, size: 48),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(r.senderName, style: AppType.heading(21)),
              Text(
                [r.kind == ListingKind.venue ? 'Venue request' : 'Service request', r.listingName].join(' · '),
                style: AppType.caption,
              ),
            ]),
          ),
          StatusBadge(RequestStatus.label(r.status), tone: requestTone(r.status)),
        ]),
        const SizedBox(height: 16),
        if (r.slot != null) ...[SlotBlock(slot: r.slot!), const SizedBox(height: 12)],
        GroupedSurface(
          color: AppColors.ink50,
          child: Column(children: [
            if (r.slot == null)
              _Fact(Icons.calendar_today_outlined, 'Date', r.eventDate == null ? 'Not given' : shortDay(r.eventDate)),
            if (r.eventType != null) _Fact(Icons.celebration_outlined, 'Event', r.eventType!),
            if (r.guestCount != null && r.guestCount! > 0) _Fact(Icons.groups_outlined, 'Guests', '${r.guestCount}'),
            if (r.budgetRange != null) _Fact(Icons.payments_outlined, 'Budget', r.budgetRange!),
            if (r.spaceName != null && r.slot == null) _Fact(Icons.meeting_room_outlined, 'Space', r.spaceName!),
            if (created != null) _Fact(Icons.schedule_rounded, 'Received', created),
          ]),
        ),
        if (r.message.isNotEmpty) ...[
          const SizedBox(height: 14),
          Text('Message', style: AppType.groupHeader),
          const SizedBox(height: 4),
          SelectableText(r.message, style: AppType.body(14.5, height: 1.5)),
        ],
        if (r.ownerNote != null) ...[
          const SizedBox(height: 14),
          Text('Your note', style: AppType.groupHeader),
          const SizedBox(height: 4),
          Text(r.ownerNote!, style: AppType.body(14, color: AppColors.ink700, height: 1.45)),
        ],
        const SizedBox(height: 16),
        Text('Contact', style: AppType.groupHeader),
        const SizedBox(height: 6),
        Row(children: [
          if (r.senderPhone != null)
            Expanded(
              child: _ContactButton(
                icon: Icons.call_rounded,
                label: r.senderPhone!,
                onTap: () => copyText(context, r.senderPhone!, 'Phone number'),
              ),
            ),
          if (r.senderPhone != null && r.senderEmail != null) const SizedBox(width: 8),
          if (r.senderEmail != null)
            Expanded(
              child: _ContactButton(
                icon: Icons.mail_rounded,
                label: r.senderEmail!,
                onTap: () => copyText(context, r.senderEmail!, 'Email address'),
              ),
            ),
          if (r.senderPhone == null && r.senderEmail == null) Text('No contact details', style: AppType.caption),
        ]),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text('Tap to copy, then call or write from your phone.', style: AppType.caption),
        ),
        const SizedBox(height: 20),
        if (r.status == RequestStatus.cancelled)
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: AppColors.ink100, borderRadius: BorderRadius.circular(AppRadius.md)),
            child: Row(children: [
              const Icon(Icons.info_outline_rounded, color: AppColors.ink600, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  r.isBooking
                      ? 'The customer cancelled this request. The slot is open again.'
                      : 'The customer cancelled this request.',
                  style: AppType.body(13.5, color: AppColors.ink700),
                ),
              ),
            ]),
          )
        else ...[
          if (r.status != RequestStatus.booked) ...[
            PrimaryButton(
              label: r.isBooking ? 'Confirm booking' : 'Mark as booked',
              icon: Icons.check_rounded,
              tone: ButtonTone.success,
              loading: _busy == 'confirm',
              onPressed: _busy == null ? () => _decide(true) : null,
            ),
            const SizedBox(height: 8),
          ],
          if (r.status != RequestStatus.rejected)
            PrimaryButton(
              label: r.status == RequestStatus.booked ? 'Cancel booking' : 'Decline',
              icon: Icons.close_rounded,
              tone: ButtonTone.danger,
              tonal: true,
              loading: _busy == 'decline',
              onPressed: _busy == null ? () => _decide(false) : null,
            ),
          if (r.status == RequestStatus.pending) ...[
            const SizedBox(height: 8),
            PrimaryButton(
              label: 'Mark as contacted',
              icon: Icons.mark_chat_read_outlined,
              tone: ButtonTone.neutral,
              tonal: true,
              loading: _busy == 'contacted',
              onPressed: _busy == null
                  ? () => _run('contacted', () => api.setStatus(r, RequestStatus.contacted), 'Marked as contacted')
                  : null,
            ),
          ],
        ],
      ],
    );
  }
}

class _Fact extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _Fact(this.icon, this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 18, color: AppColors.ink500),
        const SizedBox(width: 10),
        SizedBox(width: 84, child: Text(label, style: AppType.body(13.5, color: AppColors.ink500))),
        Expanded(child: Text(value, style: AppType.body(14, weight: FontWeight.w500))),
      ]),
    );
  }
}

class _ContactButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _ContactButton({required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.brandTint,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.md),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
          child: Row(children: [
            Icon(icon, size: 18, color: AppColors.brand),
            const SizedBox(width: 8),
            Expanded(
              child: Text(label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.body(13.5, weight: FontWeight.w500, color: AppColors.brandDark)),
            ),
            const Icon(Icons.copy_rounded, size: 15, color: AppColors.brand),
          ]),
        ),
      ),
    );
  }
}
