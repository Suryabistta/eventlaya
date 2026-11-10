import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../models/ticket_type_model.dart' show formatRupees;
import '../../ui/ui.dart';
import '../data/vendor_models.dart';
import '../../core/bs_date.dart';

Tone requestTone(String status) => switch (status) {
      RequestStatus.pending => Tone.warning,
      RequestStatus.contacted => Tone.brand,
      RequestStatus.booked => Tone.success,
      RequestStatus.rejected => Tone.danger,
      _ => Tone.neutral,
    };

Tone slotTone(String status) => switch (status) {
      SlotStatus.open => Tone.success,
      SlotStatus.held => Tone.warning,
      SlotStatus.booked => Tone.brand,
      _ => Tone.neutral,
    };

/// Dot colour for a slot status on the calendar.
Color slotColor(String status) => switch (status) {
      SlotStatus.open => AppColors.success,
      SlotStatus.held => AppColors.marigold,
      SlotStatus.booked => AppColors.brand,
      _ => AppColors.ink400,
    };

/// "Sat 12 Apr" (adds the year when it isn't this year).
String shortDay(DateTime? d) {
  if (d == null) return 'No date';
  final sameYear = d.year == DateTime.now().year;
  return BsDate.format(sameYear ? 'EEE d MMM' : 'EEE d MMM y', d);
}

/// "Sat 12 Apr · 09:00 – 13:00 · Main hall"
String slotLine(SlotSummary s) => [shortDay(s.date), s.timeLabel, if (s.spaceName != null) s.spaceName!].join(' · ');

String priceText(double? p) => p == null ? '' : (p <= 0 ? 'Free' : formatRupees(p));

/// Copies [text] and confirms with a toast (no dialer / mail app links in this build).
Future<void> copyText(BuildContext context, String text, String what) async {
  await Clipboard.setData(ClipboardData(text: text));
  if (context.mounted) AppToast.success(context, '$what copied');
}

/// Small icon + text line used on cards.
class InfoLine extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color? color;
  final int maxLines;
  const InfoLine(this.icon, this.text, {super.key, this.color, this.maxLines = 1});

  @override
  Widget build(BuildContext context) {
    final c = color ?? AppColors.ink600;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(padding: const EdgeInsets.only(top: 1), child: Icon(icon, size: 15, color: c)),
        const SizedBox(width: 6),
        Expanded(
          child: Text(text, maxLines: maxLines, overflow: TextOverflow.ellipsis, style: AppType.body(13, color: c)),
        ),
      ]),
    );
  }
}

/// The requested slot as a tinted block (date, time, space, price).
class SlotBlock extends StatelessWidget {
  final SlotSummary slot;
  final bool dense;
  const SlotBlock({super.key, required this.slot, this.dense = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.symmetric(horizontal: 12, vertical: dense ? 8 : 12),
      decoration: BoxDecoration(
        color: AppColors.brandTint,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.brand.withValues(alpha: 0.15)),
      ),
      child: Row(children: [
        const Icon(Icons.event_available_rounded, size: 20, color: AppColors.brand),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(shortDay(slot.date), style: AppType.body(14, weight: FontWeight.w600)),
            Text(
              [slot.timeLabel, if (slot.spaceName != null) slot.spaceName!].join(' · '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppType.body(12.5, color: AppColors.ink600),
            ),
          ]),
        ),
        if (slot.price != null)
          Text(priceText(slot.price), style: AppType.heading(15, weight: FontWeight.w700, color: AppColors.brandDark)),
      ]),
    );
  }
}

/// One request in the inbox.
class RequestCard extends StatelessWidget {
  final BookingRequest request;
  final VoidCallback onTap;
  const RequestCard({super.key, required this.request, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final r = request;
    final created = r.createdAt == null ? '' : Fmtx.ago(r.createdAt!);
    final facts = [
      if (r.eventType != null) r.eventType!,
      if (r.guestCount != null && r.guestCount! > 0) '${r.guestCount} guests',
      if (r.budgetRange != null) r.budgetRange!,
    ];
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.lg),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadius.lg),
              border: Border.all(
                color: r.status == RequestStatus.pending
                    ? AppColors.marigold.withValues(alpha: 0.5)
                    : AppColors.ink200.withValues(alpha: 0.7),
                width: r.status == RequestStatus.pending ? 1 : 0.5,
              ),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                InitialsAvatar(name: r.senderName, size: 36),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(r.senderName,
                        maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.body(15, weight: FontWeight.w600)),
                    Text(
                      [r.listingName, if (created.isNotEmpty) created].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppType.caption,
                    ),
                  ]),
                ),
                const SizedBox(width: 8),
                StatusBadge(RequestStatus.label(r.status), tone: requestTone(r.status)),
              ]),
              if (facts.isNotEmpty) InfoLine(Icons.celebration_outlined, facts.join(' · ')),
              const SizedBox(height: 8),
              if (r.slot != null)
                SlotBlock(slot: r.slot!, dense: true)
              else
                InfoLine(Icons.calendar_today_outlined,
                    r.eventDate == null ? 'No date given' : 'Asked about ${shortDay(r.eventDate)} (no slot)'),
              if (r.message.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(r.message,
                    maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.body(13.5, color: AppColors.ink700)),
              ],
            ]),
          ),
        ),
      ),
    );
  }
}

/// Relative time helpers.
class Fmtx {
  Fmtx._();

  /// "just now", "5 min ago", "3 h ago", "2 d ago", else "12 Mar".
  static String ago(DateTime t) {
    final diff = DateTime.now().difference(t);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
    if (diff.inHours < 24) return '${diff.inHours} h ago';
    if (diff.inDays < 7) return '${diff.inDays} d ago';
    return BsDate.format('d MMM', t);
  }
}

/// Picker for a listing (and, for venues, a space). Returns the new target.
Future<CalendarTarget?> pickCalendarTarget(
  BuildContext context, {
  required List<OwnerListing> listings,
  CalendarTarget? current,
  bool allowAllSpaces = true,
}) {
  return showAppSheet<CalendarTarget>(
    context,
    builder: (ctx) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        const SheetHeader(title: 'Choose listing', message: 'Slots are kept per listing — and per space for venues.'),
        for (final l in listings) ...[
          SheetAction(
            icon: l.kind == ListingKind.venue ? Icons.location_city_rounded : Icons.storefront_rounded,
            label: l.spaces.isEmpty || !allowAllSpaces ? l.name : '${l.name} · whole venue',
            trailing: l.isPaused ? const PausedBadge() : null,
            selected: current?.listingId == l.id && current?.spaceId == null,
            onTap: () => Navigator.pop(ctx, CalendarTarget(l.kind, l.id)),
          ),
          // Paused spaces stay selectable so their slots can still be managed.
          for (final s in l.spaces)
            Padding(
              padding: const EdgeInsets.only(left: 28),
              child: SheetAction(
                icon: Icons.meeting_room_outlined,
                label: s.name,
                trailing: s.isActive ? null : const PausedBadge(),
                selected: current?.listingId == l.id && current?.spaceId == s.id,
                onTap: () => Navigator.pop(ctx, CalendarTarget(l.kind, l.id, s.id)),
              ),
            ),
        ],
      ],
    ),
  );
}

/// Grey "Paused" pill for a paused listing or venue space.
class PausedBadge extends StatelessWidget {
  const PausedBadge({super.key});

  @override
  Widget build(BuildContext context) => const StatusBadge('Paused', tone: Tone.neutral, dot: false);
}

/// Whether [t] points at a paused listing or a paused venue space.
bool targetPaused(CalendarTarget? t, List<OwnerListing> listings) {
  final l = listings.where((x) => x.id == t?.listingId).firstOrNull;
  if (l == null) return false;
  if (l.isPaused) return true;
  return t?.spaceId != null && l.spaces.any((s) => s.id == t!.spaceId && !s.isActive);
}

/// "Grand Palace · Main hall" for a target.
String targetLabel(CalendarTarget? t, List<OwnerListing> listings) {
  if (t == null) return 'No listing';
  final l = listings.where((x) => x.id == t.listingId).firstOrNull;
  if (l == null) return 'Listing';
  if (t.spaceId == null) return l.spaces.isEmpty ? l.name : '${l.name} · whole venue';
  final s = l.spaces.where((x) => x.id == t.spaceId).firstOrNull;
  return '${l.name} · ${s?.name ?? 'space'}';
}

/// Tappable "Listing" row used at the top of the slot sheets.
class TargetRow extends StatelessWidget {
  final CalendarTarget? target;
  final List<OwnerListing> listings;
  final ValueChanged<CalendarTarget> onChanged;
  const TargetRow({super.key, required this.target, required this.listings, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final multi = listings.length > 1 || listings.any((l) => l.spaces.isNotEmpty);
    return Material(
      color: AppColors.ink50,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.md),
        onTap: multi
            ? () async {
                final t = await pickCalendarTarget(context, listings: listings, current: target);
                if (t != null) onChanged(t);
              }
            : null,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          child: Row(children: [
            const Icon(Icons.storefront_outlined, size: 20, color: AppColors.ink600),
            const SizedBox(width: 10),
            Expanded(
              child: Text(targetLabel(target, listings),
                  maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.body(14.5, weight: FontWeight.w500)),
            ),
            if (targetPaused(target, listings)) ...[const SizedBox(width: 8), const PausedBadge()],
            if (multi) const Icon(Icons.unfold_more_rounded, size: 20, color: AppColors.ink400),
          ]),
        ),
      ),
    );
  }
}
