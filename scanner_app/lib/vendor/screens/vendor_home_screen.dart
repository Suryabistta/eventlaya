import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/auth_provider.dart';
import '../../ui/ui.dart';
import '../data/vendor_api.dart';
import '../data/vendor_models.dart';
import '../providers/vendor_providers.dart';
import '../vendor_shell.dart';
import '../widgets/request_sheet.dart';
import '../widgets/slot_sheets.dart';
import '../widgets/vendor_widgets.dart';

String _greeting() {
  final h = DateTime.now().hour;
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/// Vendor Home: greeting hero with today's numbers, upcoming bookings and
/// quick actions.
class VendorHomeScreen extends ConsumerWidget {
  const VendorHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final topPad = MediaQuery.paddingOf(context).top;
    final bottomPad = MediaQuery.paddingOf(context).bottom;
    final listingsAsync = ref.watch(myListingsProvider);
    final listings = listingsAsync.valueOrNull;

    Future<void> refresh() async {
      ref.invalidate(myListingsProvider);
      ref.refreshVendorData();
      try {
        await ref.read(vendorRequestsProvider.future);
      } catch (_) {}
    }

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: LayoutBuilder(builder: (context, constraints) {
          final gutter = AppScaffold.gutterFor(constraints.maxWidth);
          Widget padded(Widget sliver) =>
              SliverPadding(padding: EdgeInsets.symmetric(horizontal: gutter), sliver: sliver);
          return RefreshIndicator(
            color: AppColors.brand,
            edgeOffset: topPad,
            onRefresh: refresh,
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
              slivers: [
                SliverToBoxAdapter(child: _Hero(gutter: gutter)),
                if (listings == null && listingsAsync.hasError)
                  padded(SliverToBoxAdapter(
                    child: ErrorState(
                      message: vendorErrorMessage(listingsAsync.error!),
                      onRetry: () => ref.invalidate(myListingsProvider),
                    ),
                  ))
                else if (listings != null && listings.isEmpty)
                  padded(const SliverToBoxAdapter(child: _NoListings()))
                else ...[
                  padded(SliverToBoxAdapter(child: _QuickActions(listings: listings ?? const []))),
                  padded(const SliverToBoxAdapter(child: _UpcomingBookings())),
                ],
                SliverToBoxAdapter(child: SizedBox(height: bottomPad + 32)),
              ],
            ),
          );
        }),
      ),
    );
  }
}

class _Hero extends ConsumerWidget {
  final double gutter;
  const _Hero({required this.gutter});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final topPad = MediaQuery.paddingOf(context).top;
    final user = ref.watch(authProvider).user;
    final given = (user?.firstName ?? '').trim();
    final name = given.isNotEmpty ? given : (user?.organizationName ?? 'there');
    final white70 = Colors.white.withValues(alpha: 0.78);

    final requests = ref.watch(vendorRequestsProvider).valueOrNull;
    final pending = requests?.where((r) => r.status == RequestStatus.pending).length;
    final now = DateTime.now();
    final weekStart = dayOf(now).subtract(Duration(days: now.weekday - 1));
    final weekEnd = weekStart.add(const Duration(days: 6));
    final bookedThisWeek = requests
        ?.where((r) =>
            r.status == RequestStatus.booked &&
            r.day != null &&
            !dayOf(r.day!).isBefore(weekStart) &&
            !dayOf(r.day!).isAfter(weekEnd))
        .length;
    final open = ref.watch(openSlotsWeekProvider).valueOrNull;

    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFD63A70), AppColors.brand, Color(0xFF6B1238)],
          stops: [0, 0.45, 1],
        ),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(32)),
      ),
      child: Stack(children: [
        Positioned(
          top: -60,
          right: -40,
          child: _Glow(size: 200, color: AppColors.marigold.withValues(alpha: 0.28)),
        ),
        Positioned(bottom: -80, left: -60, child: _Glow(size: 220, color: Colors.white.withValues(alpha: 0.10))),
        Padding(
          padding: EdgeInsets.fromLTRB(gutter + 4, topPad + 16, gutter + 4, 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Container(
                width: 42,
                height: 42,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white.withValues(alpha: 0.18),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.35)),
                ),
                child: const Icon(Icons.storefront_rounded, color: Colors.white, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(_greeting(), style: AppType.body(13, color: white70, height: 1.2)),
                  Text(name,
                      maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.heading(18, color: Colors.white)),
                ]),
              ),
            ]),
            const SizedBox(height: 22),
            Text(
              pending == null
                  ? 'Your business today'
                  : pending == 0
                      ? 'All caught up'
                      : '$pending booking ${pending == 1 ? 'request needs' : 'requests need'} you',
              style: AppType.heading(26, weight: FontWeight.w800, color: Colors.white),
            ),
            const SizedBox(height: 4),
            Text('Answer quickly — customers usually book the first venue that replies.',
                style: AppType.body(13, color: white70)),
            const SizedBox(height: 18),
            Row(children: [
              Expanded(
                child: _HeroStat(
                  value: pending,
                  label: 'Pending',
                  icon: Icons.inbox_rounded,
                  onTap: () => ShellScope.maybeOf(context)?.goTo(VendorShell.requestsTab),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                  child:
                      _HeroStat(value: bookedThisWeek, label: 'Booked this week', icon: Icons.event_available_rounded)),
              const SizedBox(width: 8),
              Expanded(
                child: _HeroStat(
                  value: open,
                  label: 'Open next 7 days',
                  icon: Icons.event_note_rounded,
                  onTap: () => ShellScope.maybeOf(context)?.goTo(VendorShell.calendarTab),
                ),
              ),
            ]),
          ]),
        ),
      ]),
    );
  }
}

class _HeroStat extends StatelessWidget {
  final int? value;
  final String label;
  final IconData icon;
  final VoidCallback? onTap;
  const _HeroStat({required this.value, required this.label, required this.icon, this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.14),
      borderRadius: BorderRadius.circular(AppRadius.lg),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.fromLTRB(12, 12, 10, 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(color: Colors.white.withValues(alpha: 0.22), width: 0.8),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(icon, size: 18, color: Colors.white.withValues(alpha: 0.85)),
            const SizedBox(height: 8),
            Text(value == null ? '–' : '$value',
                style: AppType.heading(26, weight: FontWeight.w800, color: Colors.white, height: 1.05)),
            const SizedBox(height: 2),
            Text(label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppType.body(11.5,
                    weight: FontWeight.w500, color: Colors.white.withValues(alpha: 0.8), height: 1.25)),
          ]),
        ),
      ),
    );
  }
}

class _Glow extends StatelessWidget {
  final double size;
  final Color color;
  const _Glow({required this.size, required this.color});

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(colors: [color, color.withValues(alpha: 0)]),
        ),
      ),
    );
  }
}

class _QuickActions extends ConsumerWidget {
  final List<OwnerListing> listings;
  const _QuickActions({required this.listings});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final target = ref.watch(effectiveCalendarTargetProvider);
    final ready = target != null && listings.isNotEmpty;
    void needListing() => AppToast.info(context, 'Your listings are still loading');
    return Padding(
      padding: const EdgeInsets.only(top: 20),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const SectionTitle('Quick actions'),
        Row(children: [
          Expanded(
            child: _ActionTile(
              icon: Icons.add_circle_rounded,
              label: 'Add slots',
              colors: const [Color(0xFFD63A70), AppColors.brandDark],
              onTap: ready ? () => showRepeatSheet(context, target: target, listings: listings) : needListing,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: _ActionTile(
              icon: Icons.block_rounded,
              label: 'Block dates',
              colors: const [AppColors.ink600, AppColors.ink900],
              onTap: ready ? () => showBlockDatesSheet(context, target: target, listings: listings) : needListing,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: _ActionTile(
              icon: Icons.calendar_month_rounded,
              label: 'Calendar',
              colors: const [Color(0xFFF5B031), AppColors.marigoldDark],
              onTap: () => ShellScope.maybeOf(context)?.goTo(VendorShell.calendarTab),
            ),
          ),
        ]),
      ]),
    );
  }
}

class _ActionTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final List<Color> colors;
  final VoidCallback onTap;
  const _ActionTile({required this.icon, required this.label, required this.colors, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.lg + 2),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.lg + 2),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 16),
          child: Column(children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(15),
                gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: colors),
                boxShadow: [
                  BoxShadow(color: colors.last.withValues(alpha: 0.3), blurRadius: 10, offset: const Offset(0, 4)),
                ],
              ),
              child: Icon(icon, color: Colors.white, size: 24),
            ),
            const SizedBox(height: 10),
            Text(label,
                maxLines: 2,
                textAlign: TextAlign.center,
                overflow: TextOverflow.ellipsis,
                style: AppType.body(12.5, weight: FontWeight.w600, height: 1.25)),
          ]),
        ),
      ),
    );
  }
}

/// Held and booked slots from today on.
class _UpcomingBookings extends ConsumerWidget {
  const _UpcomingBookings();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(upcomingBookingsProvider);
    final slots = async.valueOrNull;
    return Padding(
      padding: const EdgeInsets.only(top: 24),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (slots == null && async.hasError)
          GroupedSection(header: 'Next bookings', children: [
            ListRow(
              title: "Couldn't load bookings",
              subtitle: vendorErrorMessage(async.error!),
              trailing: const Icon(Icons.refresh_rounded, color: AppColors.brand),
              onTap: () => ref.invalidate(upcomingBookingsProvider),
            ),
          ])
        else if (slots == null)
          const LoadingList(rows: 3)
        else
          GroupedSection(
            header: 'Next bookings',
            headerTrailing: TextButton(
              onPressed: () => ShellScope.maybeOf(context)?.goTo(VendorShell.requestsTab),
              child: const Text('All requests'),
            ),
            separatorInset: slots.isEmpty ? 16 : 70,
            children: slots.isEmpty
                ? [
                    const ListRow(
                      title: 'No bookings yet',
                      subtitle: 'Add open slots in the Calendar so customers can request them.',
                    ),
                  ]
                : [for (final s in slots.take(6)) _BookingRow(slot: s)],
          ),
      ]),
    );
  }
}

class _BookingRow extends StatelessWidget {
  final Slot slot;
  const _BookingRow({required this.slot});

  @override
  Widget build(BuildContext context) {
    final s = slot;
    final req = s.request;
    return ListRow(
      leading: _DateBadge(date: s.date, color: slotColor(s.status)),
      title: req?.senderName ?? s.listingName,
      subtitle: [
        s.timeLabel,
        s.spaceName ?? s.listingName,
        if (req?.eventType != null) req!.eventType!,
      ].join(' · '),
      trailing: StatusBadge(s.status == SlotStatus.held ? 'Reply needed' : 'Booked', tone: slotTone(s.status)),
      onTap: () {
        final r = s.toRequest();
        if (r != null) showRequestDetail(context, r);
      },
    );
  }
}

/// Calendar-page style "APR / 12" badge.
class _DateBadge extends StatelessWidget {
  final DateTime date;
  final Color color;
  const _DateBadge({required this.date, required this.color});

  static const _months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 44,
      height: 48,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Text(_months[date.month - 1],
            textScaler: TextScaler.noScaling,
            style: AppType.body(10, weight: FontWeight.w700, color: color, height: 1.1)),
        Text('${date.day}',
            textScaler: TextScaler.noScaling, style: AppType.heading(19, weight: FontWeight.w800, height: 1.1)),
      ]),
    );
  }
}

class _NoListings extends StatelessWidget {
  const _NoListings();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.only(top: 24),
      child: EmptyState(
        icon: Icons.add_business_outlined,
        title: 'No listings yet',
        message: 'Add your venue or service on eventlaya.com (Business → Listings). Once it is approved you can '
            'manage slots and booking requests here.',
      ),
    );
  }
}
