import 'dart:math' as math;
import 'package:clock/clock.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/event_model.dart';
import '../../models/gate_stats_model.dart';
import '../../models/ticket_type_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/event_provider.dart';
import '../../ui/ui.dart';
import '../common/event_phase.dart';
import '../common/format.dart';
import '../staff/staff_shell.dart' show RecentScanRow;
import 'admin_shell.dart';
import 'broadcast_sheet.dart';
import 'scan_logs_screen.dart';
import 'staff_screen.dart';

class AdminHomeScreen extends ConsumerWidget {
  const AdminHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final events = ref.watch(eventsProvider);
    final eventState = ref.watch(eventProvider);
    final event = eventState.currentEvent;
    final user = ref.watch(authProvider).user;

    Future<void> refresh() async {
      ref.invalidate(eventsProvider);
      if (event != null) {
        ref.invalidate(ticketTypeStatsProvider(event.id));
        await ref.read(eventProvider.notifier).fetchStats(event.id);
      }
    }

    final list = events.valueOrNull ?? const <EventModel>[];
    final ready = list.isNotEmpty && event != null;
    final topPad = MediaQuery.paddingOf(context).top;
    final bottomPad = MediaQuery.paddingOf(context).bottom;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: (ready ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark)
          .copyWith(statusBarColor: Colors.transparent),
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
                if (ready) ...[
                  SliverToBoxAdapter(
                    child: _Hero(event: event, stats: eventState.stats, userName: user?.firstName, gutter: gutter),
                  ),
                  padded(SliverToBoxAdapter(child: _Dashboard(event: event, stats: eventState.stats))),
                ] else ...[
                  SliverToBoxAdapter(child: SizedBox(height: topPad + 24)),
                  if (events.hasError && list.isEmpty)
                    padded(SliverFillRemaining(
                      hasScrollBody: false,
                      child: ErrorState(
                        title: "Couldn't load your events",
                        message: events.error.toString(),
                        onRetry: () => ref.invalidate(eventsProvider),
                      ),
                    ))
                  else if (events.isLoading || list.isNotEmpty)
                    padded(SliverToBoxAdapter(
                      child: LayoutBuilder(
                        builder: (_, c) => LoadingStats(columns: c.maxWidth >= 600 ? 4 : 2),
                      ),
                    ))
                  else
                    padded(SliverFillRemaining(
                      hasScrollBody: false,
                      child: EmptyState(
                        icon: Icons.event_busy_outlined,
                        title: 'No events yet',
                        message: 'Create an event on the Eventlaya web dashboard, then refresh to see it here.',
                        actionLabel: 'Refresh',
                        actionIcon: Icons.refresh_rounded,
                        onAction: () => ref.invalidate(eventsProvider),
                      ),
                    )),
                ],
                // Room for the floating tab bar and its raised Scan button.
                SliverToBoxAdapter(child: SizedBox(height: bottomPad + 32)),
              ],
            ),
          );
        }),
      ),
    );
  }
}

String _greeting() {
  final h = clock.now().hour;
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/// Brand gradient header: greeting, live event details and live occupancy.
class _Hero extends StatelessWidget {
  final EventModel event;
  final GateStatsModel stats;
  final String? userName;
  final double gutter;

  const _Hero({required this.event, required this.stats, required this.userName, required this.gutter});

  @override
  Widget build(BuildContext context) {
    final topPad = MediaQuery.paddingOf(context).top;
    final given = (userName ?? '').trim();
    final name = given.isNotEmpty ? given : 'Organizer';
    final initial = name[0].toUpperCase();
    final cap = event.capacity > 0 ? event.capacity : stats.capacity;
    final ratio = cap > 0 ? (stats.currentlyInside / cap).clamp(0.0, 1.0) : 0.0;
    final white70 = Colors.white.withValues(alpha: 0.75);
    final phase = event.phase;
    // Ended / cancelled events get a muted hero so it doesn't read as live.
    final closed = phase == EventPhase.ended || phase == EventPhase.cancelled;
    final notice = PhaseCopy.scanNotice(event);

    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: closed
              ? const [AppColors.ink500, AppColors.ink700, AppColors.ink900]
              : const [Color(0xFFD63A70), AppColors.brand, Color(0xFF6B1238)],
          stops: const [0, 0.45, 1],
        ),
        borderRadius: const BorderRadius.vertical(bottom: Radius.circular(32)),
      ),
      child: Stack(
        children: [
          // Soft decorative glows.
          Positioned(
            top: -60,
            right: -40,
            child: _Glow(
              size: 200,
              color: closed ? Colors.white.withValues(alpha: 0.08) : AppColors.marigold.withValues(alpha: 0.28),
            ),
          ),
          Positioned(
            bottom: -80,
            left: -60,
            child: _Glow(size: 220, color: Colors.white.withValues(alpha: 0.10)),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(gutter + 4, topPad + 16, gutter + 4, 28),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 42,
                      height: 42,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white.withValues(alpha: 0.18),
                        border: Border.all(color: Colors.white.withValues(alpha: 0.35)),
                      ),
                      child: Text(initial, style: AppType.heading(18, color: Colors.white)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_greeting(), style: AppType.body(13, color: white70, height: 1.2)),
                          Text(
                            name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppType.heading(18, color: Colors.white),
                          ),
                        ],
                      ),
                    ),
                    _PhasePill(event: event),
                  ],
                ),
                const SizedBox(height: 24),
                Text(
                  event.title,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.heading(26, weight: FontWeight.w800, color: Colors.white),
                ),
                const SizedBox(height: 8),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Icon(Icons.place_outlined, size: 16, color: white70),
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        [event.venue, if (event.date != null) Fmt.date(event.date)].join(' · '),
                        style: AppType.body(13, color: white70),
                      ),
                    ),
                  ],
                ),
                if (notice != null) ...[
                  const SizedBox(height: 14),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 1),
                        child: Icon(
                          phase == EventPhase.upcoming ? Icons.schedule_rounded : Icons.info_outline_rounded,
                          size: 17,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          notice,
                          style: AppType.body(13, weight: FontWeight.w600, color: Colors.white),
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 20),
                Container(
                  padding: const EdgeInsets.fromLTRB(18, 16, 16, 16),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(AppRadius.xl),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.22), width: 0.8),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Inside now', style: AppType.body(13, weight: FontWeight.w500, color: white70)),
                            const SizedBox(height: 2),
                            FittedBox(
                              fit: BoxFit.scaleDown,
                              alignment: Alignment.centerLeft,
                              child: Text(
                                Fmt.number(stats.currentlyInside),
                                style: AppType.heading(42, weight: FontWeight.w800, color: Colors.white, height: 1.1),
                              ),
                            ),
                            Text(
                              cap > 0
                                  ? '${Fmt.number(math.max(0, cap - stats.currentlyInside))} of ${Fmt.number(cap)} spots left'
                                  : 'No capacity limit',
                              style: AppType.body(12, color: white70),
                            ),
                          ],
                        ),
                      ),
                      _CapacityRing(ratio: ratio, enabled: cap > 0),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
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

/// Lifecycle pill in the hero: Live, Today 16:00 / Starts in 3 days, Ended, Cancelled, Draft.
class _PhasePill extends StatelessWidget {
  final EventModel event;
  const _PhasePill({required this.event});

  @override
  Widget build(BuildContext context) {
    final phase = event.phase;
    final (label, dot) = switch (phase) {
      EventPhase.live => ('Live', const Color(0xFF4ADE80)),
      EventPhase.upcoming => (PhaseCopy.startsIn(event, clock.now()), const Color(0xFFFCD34D)),
      EventPhase.ended => ('Ended', AppColors.ink300),
      EventPhase.cancelled => ('Cancelled', const Color(0xFFF87171)),
      EventPhase.draft => ('Draft', AppColors.ink300),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(label, style: AppType.body(12, weight: FontWeight.w600, color: Colors.white, height: 1.2)),
        ],
      ),
    );
  }
}

class _CapacityRing extends StatelessWidget {
  final double ratio;
  final bool enabled;
  const _CapacityRing({required this.ratio, required this.enabled});

  @override
  Widget build(BuildContext context) {
    final pct = ratio * 100;
    final color = pct > 90
        ? const Color(0xFFFCA5A5)
        : pct > 70
            ? const Color(0xFFFCD34D)
            : const Color(0xFF4ADE80);
    return SizedBox(
      width: 78,
      height: 78,
      child: Stack(
        fit: StackFit.expand,
        children: [
          TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: enabled ? ratio : 0),
            duration: const Duration(milliseconds: 700),
            curve: Curves.easeOutCubic,
            builder: (_, v, __) => CircularProgressIndicator(
              value: v,
              strokeWidth: 7,
              strokeCap: StrokeCap.round,
              color: color,
              backgroundColor: Colors.white.withValues(alpha: 0.18),
            ),
          ),
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  enabled ? '${pct.toStringAsFixed(0)}%' : '∞',
                  style: AppType.heading(18, color: Colors.white, height: 1),
                ),
                Text('full', style: AppType.body(10, color: Colors.white.withValues(alpha: 0.7), height: 1.2)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Dashboard extends StatelessWidget {
  final EventModel event;
  final GateStatsModel stats;
  const _Dashboard({required this.event, required this.stats});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      final wide = c.maxWidth >= 640;
      final statTiles = [
        _MiniStat(
          label: 'Checked in',
          value: Fmt.number(stats.checkedIn),
          icon: Icons.login_rounded,
          tone: Tone.success,
        ),
        _MiniStat(
          label: 'Checked out',
          value: Fmt.number(stats.checkedOut),
          icon: Icons.logout_rounded,
          tone: Tone.warning,
        ),
        _MiniStat(
          label: 'Registered',
          value: Fmt.number(stats.totalRegistered),
          icon: Icons.confirmation_number_outlined,
          tone: Tone.brand,
        ),
      ];

      final actions = _QuickActions(event: event);
      final recent = _RecentActivity(stats: stats);

      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 16),
          _Grid(columns: 3, children: statTiles),
          const SizedBox(height: 24),
          _TicketTypesCard(eventId: event.id),
          if (wide)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: actions),
                const SizedBox(width: 16),
                Expanded(child: recent),
              ],
            )
          else ...[
            actions,
            const SizedBox(height: 8),
            recent,
          ],
        ],
      );
    });
  }
}

class _MiniStat extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Tone tone;
  const _MiniStat({required this.label, required this.value, required this.icon, required this.tone});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg + 2),
        boxShadow: [
          BoxShadow(color: AppColors.ink900.withValues(alpha: 0.06), blurRadius: 18, offset: const Offset(0, 6)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(color: tone.tint, borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, size: 17, color: tone.strong),
          ),
          const SizedBox(height: 12),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value, style: AppType.heading(24, weight: FontWeight.w800)),
          ),
          const SizedBox(height: 2),
          // Two lines so "Checked in" / "Checked out" stay distinct at large text sizes.
          Text(
            label,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: AppType.body(12, weight: FontWeight.w500, color: AppColors.textSecondary, height: 1.2),
          ),
        ],
      ),
    );
  }
}

/// Simple non-scrolling grid whose rows size to their content (text-scale safe).
class _Grid extends StatelessWidget {
  final int columns;
  final List<Widget> children;
  const _Grid({required this.columns, required this.children});

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < children.length; i += columns) {
      if (rows.isNotEmpty) rows.add(const SizedBox(height: 12));
      rows.add(IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var j = 0; j < columns; j++) ...[
              if (j > 0) const SizedBox(width: 12),
              Expanded(child: i + j < children.length ? children[i + j] : const SizedBox()),
            ],
          ],
        ),
      ));
    }
    return Column(children: rows);
  }
}

class _QuickActions extends StatelessWidget {
  final EventModel event;
  const _QuickActions({required this.event});

  @override
  Widget build(BuildContext context) {
    final window = event.scanWindow;
    final scanOpen = window == ScanWindow.open;
    final notice = PhaseCopy.scanNotice(event);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionTitle('Quick actions'),
        _Grid(
          columns: 3,
          children: [
            _ActionTile(
              icon: scanOpen ? Icons.qr_code_scanner_rounded : Icons.qr_code_scanner_outlined,
              label: switch (window) {
                ScanWindow.open => 'Scan passes',
                ScanWindow.tooEarly => 'Scanning not open yet',
                _ => 'Scanning closed',
              },
              colors: scanOpen
                  ? const [Color(0xFFD63A70), AppColors.brandDark]
                  : const [AppColors.ink300, AppColors.ink400],
              onTap: () {
                if (!scanOpen && notice != null) AppToast.info(context, notice);
                ShellScope.maybeOf(context)?.goTo(AdminShell.scanTab);
              },
            ),
            _ActionTile(
              icon: Icons.campaign_rounded,
              label: 'Message staff',
              colors: const [Color(0xFFF5B031), AppColors.marigoldDark],
              onTap: () => showBroadcastSheet(context),
            ),
            _ActionTile(
              icon: Icons.badge_rounded,
              label: 'Gate staff',
              colors: const [AppColors.ink600, AppColors.ink900],
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const StaffScreen())),
            ),
          ],
        ),
      ],
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
          child: Column(
            children: [
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
              Text(
                label,
                maxLines: 2,
                textAlign: TextAlign.center,
                overflow: TextOverflow.ellipsis,
                style: AppType.body(12.5, weight: FontWeight.w600, height: 1.25),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RecentActivity extends StatelessWidget {
  final GateStatsModel stats;
  const _RecentActivity({required this.stats});

  @override
  Widget build(BuildContext context) {
    final scans = stats.recentScans.take(8).toList();
    return GroupedSection(
      header: 'Recent activity',
      headerTrailing: TextButton(
        onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ScanLogsScreen())),
        child: const Text('See all'),
      ),
      separatorInset: scans.isEmpty ? 16 : 68,
      children: scans.isEmpty
          ? [
              const ListRow(
                title: 'No scans yet',
                subtitle: 'Gate activity shows up here as passes are scanned.',
              ),
            ]
          : [for (final s in scans) RecentScanRow(scan: s)],
    );
  }
}

/// Sold and checked-in counts per ticket type (General, Student, VIP…).
/// Hidden when the event has no ticket types or analytics isn't available.
class _TicketTypesCard extends ConsumerWidget {
  final String eventId;
  const _TicketTypesCard({required this.eventId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final types = ref.watch(ticketTypeStatsProvider(eventId)).valueOrNull ?? const <TicketTypeStat>[];
    if (types.isEmpty) return const SizedBox.shrink();
    return GroupedSection(
      header: 'Tickets',
      separatorInset: 16,
      children: [for (final t in types) _TicketTypeRow(stat: t)],
    );
  }
}

class _TicketTypeRow extends StatelessWidget {
  final TicketTypeStat stat;
  const _TicketTypeRow({required this.stat});

  @override
  Widget build(BuildContext context) {
    final q = stat.quantity;
    final ratio = stat.sold > 0 ? (stat.checkedIn / stat.sold).clamp(0.0, 1.0) : 0.0;
    final details = [
      '${Fmt.number(stat.checkedIn)} checked in',
      stat.price > 0 ? formatRupees(stat.price) : 'Free',
      if (stat.isHidden) 'Hidden',
    ].join(' · ');
    return ListRow(
      title: stat.name,
      subtitleWidget: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(details, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.rowSubtitle),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: ratio,
              minHeight: 4,
              color: AppColors.success,
              backgroundColor: AppColors.ink100,
            ),
          ),
        ],
      ),
      trailing: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            q == null ? Fmt.number(stat.sold) : '${Fmt.number(stat.sold)}/${Fmt.number(q)}',
            style: AppType.heading(17, weight: FontWeight.w800),
          ),
          Text('sold', style: AppType.caption),
        ],
      ),
    );
  }
}
