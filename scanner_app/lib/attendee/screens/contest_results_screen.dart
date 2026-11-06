import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/modules_provider.dart';
import '../../ui/ui.dart';
import '../data/contest_api.dart';
import '../models/contest.dart';
import '../providers/contest_providers.dart';
import '../widgets/contest_widgets.dart';
import 'contestant_screen.dart';

/// Live results: standings of the round on show (as much as the organizer lets the public see:
/// counts, ranks only or top N), award categories, and a winner reveal once the final round is
/// decided. Refreshes every 10 s while open.
class ContestResultsScreen extends ConsumerStatefulWidget {
  final String eventSlug;
  final String contestRef;
  final Contest? initial;
  const ContestResultsScreen({super.key, required this.eventSlug, required this.contestRef, this.initial});

  @override
  ConsumerState<ContestResultsScreen> createState() => _ContestResultsScreenState();
}

class _ContestResultsScreenState extends ConsumerState<ContestResultsScreen> {
  ContestKey get _key => (slug: widget.eventSlug, ref: widget.contestRef);
  Timer? _timer;
  bool? _wasRevealed;

  @override
  void initState() {
    super.initState();
    _wasRevealed = widget.initial?.resultsRevealed;
    _timer = Timer.periodic(const Duration(seconds: 10), (_) {
      if (ModalRoute.of(context)?.isCurrent == true) ref.invalidate(contestProvider(_key));
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(contestProvider(_key));
    ref.listen(contestProvider(_key), (_, next) {
      if (next.hasError) noteModuleDisabled(ref, next.error!);
      final c = next.valueOrNull;
      if (c != null && _wasRevealed == false && c.resultsRevealed) HapticFeedback.heavyImpact();
      if (c != null) _wasRevealed = c.resultsRevealed;
    });
    final c = async.valueOrNull ?? widget.initial;

    return AppScaffold(
      title: c?.isClosed == true ? 'Results' : 'Live results',
      onRefresh: () async {
        ref.invalidate(contestProvider(_key));
        try {
          await ref.read(contestProvider(_key).future);
        } catch (_) {}
      },
      slivers: [
        if (c == null)
          SliverFillRemaining(
            hasScrollBody: false,
            child: async.hasError
                ? _error(async.error!)
                : const Center(child: CircularProgressIndicator()),
          )
        else
          SliverList.list(children: _content(c, async.isLoading)),
      ],
    );
  }

  Widget _error(Object e) {
    final f = ContestFailure.from(e);
    if (f.moduleDisabled) {
      return const EmptyState(
        icon: Icons.power_settings_new_rounded,
        title: 'Not available right now',
        message: 'Voting is switched off at the moment.',
      );
    }
    return ErrorState(message: f.message, onRetry: () => ref.invalidate(contestProvider(_key)));
  }

  static String? _notes(Standings s) {
    final notes = [
      if (s.judgesWeight != null && s.publicWeight != null)
        'Score = ${s.judgesWeight!.toStringAsFixed(0)}% judges + ${s.publicWeight!.toStringAsFixed(0)}% public vote.',
      if (s.level == 'ranks') "Ranks only: the organizers don't show vote counts.",
      if (s.level == 'top') 'Only the top ${s.topN ?? 3} are shown, without vote counts.',
    ];
    return notes.isEmpty ? null : notes.join(' ');
  }

  List<Widget> _content(Contest c, bool refreshing) {
    final s = c.standings;
    final roundName = c.displayRound?.name;
    void open(Contestant x) => openContestant(context, contest: c, contestant: x);
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(4, 0, 4, 16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(c.title, style: AppType.heading(20)),
          const SizedBox(height: 6),
          Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
            ContestStatusBadge(c),
            if (roundName != null) StatusBadge(roundName, tone: Tone.brand, dot: false),
            if (!c.isClosed)
              Text(refreshing ? 'Updating…' : 'Updates every 10 s', style: AppType.caption),
            CountdownText(target: c.countdownTarget, label: c.countdownLabel),
          ]),
        ]),
      ),
      if (c.resultsRevealed && c.winner != null)
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 500),
          transitionBuilder: (child, a) => ScaleTransition(scale: CurvedAnimation(parent: a, curve: Curves.easeOutBack), child: child),
          child: _WinnerReveal(key: ValueKey(c.winner!.id), contest: c, winner: c.winner!, onTap: () => open(c.winner!)),
        ),
      if (s == null)
        Padding(
          padding: const EdgeInsets.only(bottom: 24),
          child: ContestNotice(
            icon: Icons.visibility_off_rounded,
            tone: Tone.neutral,
            title: c.isClosed ? 'Results will be announced by the organizers' : "Results aren't public while voting is open",
            body: c.isClosed
                ? 'This page shows them as soon as they are published.'
                : 'The organizers show results after voting closes, or announce them on stage. This page updates on its own.',
          ),
        )
      else
        GroupedSection(
          header: '${roundName == null ? 'Standings' : '$roundName standings'} · ${s.summary}',
          footer: _notes(s),
          children: s.rows.isEmpty
              ? [const ListRow(title: 'No votes yet')]
              : [
                  for (final r in s.rows)
                    StandingTile(
                      row: r,
                      standings: s,
                      maxVotes: s.rows.fold(0, (m, x) => (x.votes ?? 0) > m ? x.votes! : m),
                      placement: c.isClosed && c.resultsRevealed ? c.placementTitle(r.rank) : null,
                      onTap: () {
                        final x = c.contestantById(r.contestantId);
                        if (x != null) open(x);
                      },
                    ),
                ],
        ),
      for (final cat in c.categories) _CategoryResults(contest: c, category: cat, onOpen: open),
    ];
  }
}

class _WinnerReveal extends StatelessWidget {
  final Contest contest;
  final Contestant winner;
  final VoidCallback onTap;
  const _WinnerReveal({super.key, required this.contest, required this.winner, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final title = contest.placementTitle(1) ?? 'Winner';
    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Material(
        borderRadius: BorderRadius.circular(AppRadius.xl),
        clipBehavior: Clip.antiAlias,
        color: AppColors.ink900,
        child: InkWell(
          onTap: onTap,
          child: Stack(children: [
            const Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: RadialGradient(
                    center: Alignment(0, -0.6),
                    radius: 1.1,
                    colors: [Color(0x66FFC94D), Color(0x00FFC94D)],
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(children: [
                const Icon(Icons.emoji_events_rounded, size: 40, color: Color(0xFFFFC94D)),
                const SizedBox(height: 6),
                Text(title.toUpperCase(),
                    textAlign: TextAlign.center,
                    style: AppType.body(13, weight: FontWeight.w700, color: const Color(0xFFFFC94D)).copyWith(letterSpacing: 1.6)),
                const SizedBox(height: 14),
                SizedBox(
                  width: 150,
                  height: 188,
                  child: ContestantPhoto(name: winner.name, url: winner.photoUrl, radius: 20, initialsSize: 48),
                ),
                const SizedBox(height: 14),
                NumberTag(winner.displayNumber, size: 15, background: AppColors.brand),
                const SizedBox(height: 6),
                Text(winner.name, textAlign: TextAlign.center, style: AppType.heading(26, weight: FontWeight.w800, color: Colors.white)),
                if (winner.subtitle.isNotEmpty)
                  Text(winner.subtitle, textAlign: TextAlign.center, style: AppType.body(14, color: AppColors.ink300)),
                const SizedBox(height: 4),
                Text(contest.title, textAlign: TextAlign.center, style: AppType.body(13, color: AppColors.ink300)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

class _CategoryResults extends StatelessWidget {
  final Contest contest;
  final ContestCategory category;
  final ValueChanged<Contestant> onOpen;
  const _CategoryResults({required this.contest, required this.category, required this.onOpen});

  @override
  Widget build(BuildContext context) {
    final cat = category;
    final winner = cat.winner == null ? null : contest.contestantById(cat.winner!);
    final s = cat.standings;
    final undecided = s != null && s.rows.every((r) => r.rank == null);
    if (winner == null && (s == null || undecided)) {
      return GroupedSection(
        header: cat.name,
        children: [
          ListRow(
            leading: const RowIcon(Icons.workspace_premium_rounded, background: AppColors.ink400),
            title: cat.selectionLabel,
            subtitle: cat.votingOpen
                ? (undecided ? 'Voting open · no votes yet' : 'Voting open · results not public yet')
                : 'Not announced yet${s == null ? '' : ' · ${s.rows.length} nominees'}',
          ),
        ],
      );
    }
    return GroupedSection(
      header: '${cat.name} · ${cat.selectionLabel}',
      separatorInset: 16,
      children: [
        if (winner != null)
          ListRow(
            leading: SizedBox(width: 44, height: 44, child: ContestantPhoto(name: winner.name, url: winner.photoUrl, radius: 12, initialsSize: 15)),
            titleWidget: Row(children: [
              const Icon(Icons.emoji_events_rounded, size: 16, color: AppColors.marigoldDark),
              const SizedBox(width: 4),
              Text('WINNER', style: AppType.body(11.5, weight: FontWeight.w700, color: AppColors.marigoldDark).copyWith(letterSpacing: 0.8)),
            ]),
            title: 'Winner',
            subtitle: winner.label,
            onTap: () => onOpen(winner),
          )
        else
          for (final r in s!.rows.take(5))
            StandingTile(
              row: r,
              standings: s,
              maxVotes: s.rows.fold(0, (m, x) => (x.votes ?? 0) > m ? x.votes! : m),
              onTap: () {
                final x = contest.contestantById(r.contestantId);
                if (x != null) onOpen(x);
              },
            ),
      ],
    );
  }
}
