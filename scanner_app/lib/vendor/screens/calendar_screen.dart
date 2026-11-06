import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../ui/ui.dart';
import '../data/vendor_api.dart';
import '../data/vendor_models.dart';
import '../providers/vendor_providers.dart';
import '../widgets/month_grid.dart';
import '../widgets/slot_sheets.dart';
import '../widgets/vendor_widgets.dart';

const _statusOrder = [SlotStatus.booked, SlotStatus.held, SlotStatus.open, SlotStatus.blocked];

/// Availability calendar for one listing (and venue space): month grid with
/// status dots, day sheet, add / repeat / block.
class CalendarScreen extends ConsumerStatefulWidget {
  const CalendarScreen({super.key});

  @override
  ConsumerState<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends ConsumerState<CalendarScreen> {
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);

  // Last loaded month: shown (dimmed counts) while the next month loads, so
  // the grid never flashes empty. Dots are keyed by date, so days the two
  // grids share stay correct.
  List<Slot>? _lastSlots;
  CalendarTarget? _lastTarget;
  DateTime? _lastMonth;

  SlotQuery _query(CalendarTarget t, [DateTime? month]) =>
      SlotQuery(target: t, from: gridStart(month ?? _month), to: gridEnd(month ?? _month));

  @override
  Widget build(BuildContext context) {
    final listingsAsync = ref.watch(myListingsProvider);
    final listings = listingsAsync.valueOrNull;
    final target = ref.watch(effectiveCalendarTargetProvider);

    if (listings == null || listings.isEmpty || target == null) {
      return AppScaffold(
        title: 'Calendar',
        automaticBack: false,
        onRefresh: () async => ref.invalidate(myListingsProvider),
        slivers: [
          SliverFillRemaining(
            hasScrollBody: false,
            child: listings == null && listingsAsync.hasError
                ? ErrorState(
                    message: vendorErrorMessage(listingsAsync.error!),
                    onRetry: () => ref.invalidate(myListingsProvider),
                  )
                : listings == null
                    ? const Center(child: CircularProgressIndicator(color: AppColors.brand))
                    : const EmptyState(
                        icon: Icons.calendar_month_outlined,
                        title: 'No listings yet',
                        message: 'Add your venue or service on eventlaya.com first, then manage its availability here.',
                      ),
          ),
        ],
      );
    }

    final listing = listings.firstWhere((l) => l.id == target.listingId);
    final query = _query(target);
    final async = ref.watch(slotsProvider(query));
    // Keep the neighbouring months loaded so paging is instant.
    for (final m in [DateTime(_month.year, _month.month - 1), DateTime(_month.year, _month.month + 1)]) {
      ref.listen(slotsProvider(_query(target, m)), (_, __) {});
    }
    final fresh = async.valueOrNull;
    if (fresh != null) {
      _lastSlots = fresh;
      _lastTarget = target;
      _lastMonth = _month;
    }
    final stale = fresh == null && _lastSlots != null && _lastTarget == target;
    final slots = fresh ?? (stale ? _lastSlots! : const <Slot>[]);
    // Counts and the agenda describe the month the shown data belongs to.
    final dataMonth = stale ? _lastMonth! : _month;

    final byDay = <DateTime, List<Slot>>{};
    for (final s in slots) {
      byDay.putIfAbsent(dayOf(s.date), () => []).add(s);
    }
    final dots = {
      for (final e in byDay.entries)
        e.key: [
          for (final st in _statusOrder)
            if (e.value.any((s) => s.status == st)) slotColor(st),
        ],
    };
    final muted = {
      for (final e in byDay.entries)
        if (e.value.every((s) => s.status == SlotStatus.blocked)) e.key,
    };
    final inMonth = slots.where((s) => s.date.month == dataMonth.month && s.date.year == dataMonth.year).toList();
    int countOf(String st) => inMonth.where((s) => s.status == st).length;

    final today = dayOf(DateTime.now());
    final agendaDays =
        (byDay.keys.where((d) => !d.isBefore(today) && d.month == dataMonth.month && d.year == dataMonth.year).toList()
              ..sort())
            .take(8)
            .toList();

    return AppScaffold(
      title: 'Calendar',
      automaticBack: false,
      onRefresh: () async {
        ref.invalidate(slotsProvider(query));
        try {
          await ref.read(slotsProvider(query).future);
        } catch (_) {}
      },
      actions: [
        AppIconButton(
          icon: Icons.repeat_rounded,
          tooltip: 'Repeat slots',
          onPressed: () => showRepeatSheet(context, target: target, listings: listings),
        ),
        AppIconButton(
          icon: Icons.block_rounded,
          tooltip: 'Block dates',
          onPressed: () => showBlockDatesSheet(context, target: target, listings: listings),
        ),
      ],
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: TargetRow(
              target: target,
              listings: listings,
              onChanged: (t) => ref.read(calendarTargetProvider.notifier).state = t,
            ),
          ),
        ),
        if (targetPaused(target, listings))
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _Notice(
                icon: Icons.pause_circle_outline_rounded,
                text: listing.isPaused
                    ? 'This listing is paused: customers can’t send new requests. Resume it in Listings.'
                    : 'This space is paused: customers can’t request it. You can still manage its slots.',
              ),
            ),
          ),
        if (!listing.isApproved)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _Notice(
                icon: Icons.hourglass_top_rounded,
                text: listing.status == ListingStatus.rejected
                    ? 'This listing needs changes before it goes live. You can prepare slots now.'
                    : 'This listing is waiting for approval. Customers see your slots once it is live.',
              ),
            ),
          ),
        SliverToBoxAdapter(
          child: GroupedSurface(
            padding: const EdgeInsets.fromLTRB(12, 6, 8, 12),
            child: Column(children: [
              MonthHeader(month: _month, onChanged: (m) => setState(() => _month = m)),
              Stack(children: [
                MonthGrid(
                  month: _month,
                  dots: dots,
                  muted: muted,
                  onTap: (d) => showDaySheet(context, day: d, query: query, target: target, listings: listings),
                ),
                if (async.isLoading)
                  const Positioned(
                    top: 0,
                    right: 4,
                    child: SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.brand)),
                  ),
              ]),
              const SizedBox(height: 8),
              Wrap(spacing: 14, runSpacing: 6, alignment: WrapAlignment.center, children: [
                for (final st in _statusOrder) _Legend(color: slotColor(st), label: SlotStatus.label(st)),
              ]),
            ]),
          ),
        ),
        if (async.hasError && async.valueOrNull == null)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(top: 12),
              child: _Notice(
                icon: Icons.cloud_off_rounded,
                text: vendorErrorMessage(async.error!),
                action: 'Retry',
                onAction: () => ref.invalidate(slotsProvider(query)),
              ),
            ),
          ),
        SliverToBoxAdapter(
          child: AnimatedOpacity(
            opacity: stale ? 0.45 : 1,
            duration: const Duration(milliseconds: 150),
            child: Padding(
              padding: const EdgeInsets.only(top: 16, bottom: 20),
              child: Row(children: [
                Expanded(child: _Count(label: 'Open', value: countOf(SlotStatus.open), tone: Tone.success)),
                const SizedBox(width: 8),
                Expanded(child: _Count(label: 'Requested', value: countOf(SlotStatus.held), tone: Tone.warning)),
                const SizedBox(width: 8),
                Expanded(child: _Count(label: 'Booked', value: countOf(SlotStatus.booked), tone: Tone.brand)),
                const SizedBox(width: 8),
                Expanded(child: _Count(label: 'Blocked', value: countOf(SlotStatus.blocked), tone: Tone.neutral)),
              ]),
            ),
          ),
        ),
        SliverToBoxAdapter(
          child: Row(children: [
            Expanded(
              child: PrimaryButton(
                label: 'Repeat slots',
                icon: Icons.repeat_rounded,
                tonal: true,
                onPressed: () => showRepeatSheet(context, target: target, listings: listings),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: PrimaryButton(
                label: 'Block dates',
                icon: Icons.block_rounded,
                tone: ButtonTone.neutral,
                tonal: true,
                onPressed: () => showBlockDatesSheet(context, target: target, listings: listings),
              ),
            ),
          ]),
        ),
        const SliverToBoxAdapter(child: SizedBox(height: 24)),
        if (agendaDays.isNotEmpty)
          SliverToBoxAdapter(
            child: GroupedSection(
              header: 'Coming up in ${DateFormat('MMMM').format(dataMonth)}',
              separatorInset: 16,
              children: [
                for (final d in agendaDays)
                  ListRow(
                    title: DateFormat('EEE d MMM').format(d),
                    subtitleWidget: Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Wrap(spacing: 6, runSpacing: 4, children: [
                        for (final s in (byDay[d]!..sort((a, b) => a.sortKey.compareTo(b.sortKey))).take(4))
                          StatusBadge(
                            [s.timeLabel, if (target.spaceId == null && s.spaceName != null) s.spaceName!].join(' · '),
                            tone: slotTone(s.status),
                          ),
                      ]),
                    ),
                    chevron: true,
                    onTap: () => showDaySheet(context, day: d, query: query, target: target, listings: listings),
                  ),
              ],
            ),
          )
        else if (async.hasValue && inMonth.isEmpty)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                'No slots this month. Tap a day to add one, or use Repeat slots to fill several weeks at once.',
                textAlign: TextAlign.center,
                style: AppType.body(13.5, color: AppColors.textSecondary),
              ),
            ),
          ),
      ],
    );
  }
}

class _Legend extends StatelessWidget {
  final Color color;
  final String label;
  const _Legend({required this.color, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
      const SizedBox(width: 5),
      Text(label, style: AppType.body(12, color: AppColors.ink600)),
    ]);
  }
}

class _Count extends StatelessWidget {
  final String label;
  final int value;
  final Tone tone;
  const _Count({required this.label, required this.value, required this.tone});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      decoration: BoxDecoration(color: tone.tint, borderRadius: BorderRadius.circular(AppRadius.md)),
      child: Column(children: [
        Text('$value', style: AppType.heading(20, weight: FontWeight.w800, color: tone.strong)),
        Text(label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppType.body(11.5, weight: FontWeight.w500, color: tone.strong)),
      ]),
    );
  }
}

class _Notice extends StatelessWidget {
  final IconData icon;
  final String text;
  final String? action;
  final VoidCallback? onAction;
  const _Notice({required this.icon, required this.text, this.action, this.onAction});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
      decoration: BoxDecoration(
        color: AppColors.marigoldTint,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.marigold.withValues(alpha: 0.3)),
      ),
      child: Row(children: [
        Icon(icon, size: 20, color: AppColors.marigoldDark),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: AppType.body(13, color: AppColors.ink800))),
        if (action != null) TextButton(onPressed: onAction, child: Text(action!)),
      ]),
    );
  }
}
