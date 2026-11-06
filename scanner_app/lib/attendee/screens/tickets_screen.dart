import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../models/event_model.dart';
import '../../providers/auth_provider.dart';
import '../../ui/ui.dart';
import '../attendee_shell.dart';
import '../models/stored_pass.dart';
import '../providers/pass_providers.dart';
import '../widgets/attendee_widgets.dart';
import '../widgets/verify_banner.dart';
import 'pass_view_screen.dart';

/// Tickets: passes saved on this phone plus the signed-in account's tickets
/// (`GET /api/me/tickets/`, merged by PassesNotifier.refresh).
class TicketsScreen extends ConsumerStatefulWidget {
  const TicketsScreen({super.key});

  @override
  ConsumerState<TicketsScreen> createState() => _TicketsScreenState();
}

class _TicketsScreenState extends ConsumerState<TicketsScreen> {
  bool _past = false;

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(passesProvider);
    final upcoming = ref.watch(upcomingPassesProvider);
    final past = ref.watch(pastPassesProvider);
    final signedIn = ref.watch(authProvider).user != null;
    final list = _past ? past : upcoming;

    return AppScaffold(
      title: 'Tickets',
      onRefresh: () => ref.read(passesProvider.notifier).refresh(),
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: SegmentedControl<bool>(
              segments: [
                Segment(false, 'Upcoming', count: upcoming.length),
                Segment(true, 'Past', count: past.length),
              ],
              selected: _past,
              onChanged: (v) => setState(() => _past = v),
            ),
          ),
        ),
        const SliverToBoxAdapter(child: VerifyEmailBanner()),
        if (async.isLoading && list.isEmpty)
          const SliverToBoxAdapter(child: LoadingList(rows: 3))
        else if (list.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.confirmation_number_outlined,
              title: _past ? 'No past tickets' : 'No upcoming tickets',
              message: _past
                  ? 'Tickets for events that have ended show up here.'
                  : 'Find an event and register — your pass is saved on this phone and works offline.',
              actionLabel: _past ? null : 'Explore events',
              actionIcon: Icons.explore_rounded,
              onAction: _past ? null : () => AttendeeShell.goTo(context, AttendeeShell.exploreTab),
            ),
          )
        else
          SliverToBoxAdapter(
            child: GroupedSection(
              separatorInset: 76,
              footer: signedIn
                  ? 'Your account\'s tickets and passes registered on this phone are saved here, so they open without internet.'
                  : 'Passes registered in this app are saved on this phone, so they open without internet. Sign in to see tickets from other devices.',
              children: [
                for (final g in _groups(list)) ...[
                  _PassRow(pass: g.first, group: g),
                  if (g.length > 1)
                    for (var i = 0; i < g.length; i++) _OrderPassRow(group: g, index: i),
                ],
              ],
            ),
          ),
      ],
    );
  }
}

/// Consecutive passes from the same order (the providers keep them together,
/// buyer first); single tickets are groups of one.
List<List<StoredPass>> _groups(List<StoredPass> list) {
  final out = <List<StoredPass>>[];
  for (final p in list) {
    if (out.isNotEmpty && p.orderReference != null && out.last.first.groupKey == p.groupKey) {
      out.last.add(p);
    } else {
      out.add([p]);
    }
  }
  return out;
}

/// An event row: one pass, or the head of an order ("3 passes · ORD-7K2M9Q").
class _PassRow extends StatelessWidget {
  final StoredPass pass;
  final List<StoredPass> group;
  const _PassRow({required this.pass, required this.group});

  @override
  Widget build(BuildContext context) {
    final start = pass.event.startsAt;
    final live = pass.phase == EventPhase.live;
    final (label, tone) = pass.status != 'valid'
        ? (TicketStatus.label(pass.status), TicketStatus.tone(pass.status))
        : live
            ? ('Live', Tone.success)
            : pass.isPast
                ? (pass.phase == EventPhase.cancelled ? 'Cancelled' : 'Ended', pass.phase == EventPhase.cancelled ? Tone.danger : Tone.neutral)
                : ('Going', Tone.brand);
    return ListRow(
      leading: Container(
        width: 48,
        height: 52,
        decoration: BoxDecoration(
          color: pass.isPast ? AppColors.ink100 : AppColors.brandTint,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(start == null ? '—' : DateFormat('MMM').format(start).toUpperCase(),
                style: AppType.body(10.5,
                    weight: FontWeight.w600, color: pass.isPast ? AppColors.ink500 : AppColors.brand, height: 1.1)),
            Text(start == null ? '' : '${start.day}',
                style: AppType.heading(20, color: pass.isPast ? AppColors.ink600 : AppColors.brandDark, height: 1.1)),
          ],
        ),
      ),
      title: pass.eventTitle,
      subtitle: [
        eventWhen(pass.event),
        if (group.length > 1) ...[
          '${group.length} passes',
          if (pass.orderReference != null) pass.orderReference!,
        ] else ...[
          if (pass.ticketTypeName.isNotEmpty) pass.ticketTypeName,
          if (pass.isGuest) pass.guestLabel,
        ],
      ].join(' · '),
      trailing: StatusBadge(label, tone: tone, dot: live),
      chevron: true,
      onTap: () => openPasses(context, group),
    );
  }
}

/// One pass of a multi-ticket order, under its event row.
class _OrderPassRow extends StatelessWidget {
  final List<StoredPass> group;
  final int index;
  const _OrderPassRow({required this.group, required this.index});

  @override
  Widget build(BuildContext context) {
    final p = group[index];
    final who = p.isGuest ? p.guestLabel : 'Your ticket';
    return ListRow(
      padding: const EdgeInsets.fromLTRB(76, 6, 16, 6),
      leading: Icon(
        p.isGuest ? Icons.person_add_alt_rounded : Icons.person_rounded,
        size: 18,
        color: p.isGuest ? AppColors.ink400 : AppColors.brand,
      ),
      title: p.attendeeName.isEmpty ? who : p.attendeeName,
      // Unnamed guests are already called "<Buyer> · Guest 3".
      subtitle: [if (!p.attendeeName.endsWith(who)) who, if (p.ticketTypeName.isNotEmpty) p.ticketTypeName].join(' · '),
      trailing: p.status == 'valid'
          ? null
          : StatusBadge(TicketStatus.label(p.status), tone: TicketStatus.tone(p.status), dot: false),
      chevron: true,
      onTap: () => openPasses(context, group, initial: index),
    );
  }
}
