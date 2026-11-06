import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';
import '../../providers/modules_provider.dart';
import '../../ui/ui.dart';
import '../data/contest_api.dart';
import '../models/contest.dart';
import '../providers/contest_providers.dart';
import '../widgets/attendee_widgets.dart';
import '../widgets/contest_widgets.dart';
import 'contest_results_screen.dart';
import 'contestant_screen.dart';
import 'share_contestant.dart';
import 'vote_packs.dart';
import 'vote_sheet.dart';

/// Opens a contest page.
Future<void> openContest(BuildContext context, {required String eventSlug, required String ref, Contest? preview}) {
  return Navigator.of(context).push(MaterialPageRoute(
    builder: (_) => ContestScreen(eventSlug: eventSlug, contestRef: ref, preview: preview),
  ));
}

/// Votes for [contestant] (main vote, or in [category]), then offers sharing / vote packs.
Future<void> voteFor(BuildContext context, Contest contest, Contestant contestant, {ContestCategory? category}) async {
  final r = await showVoteSheet(context, contest: contest, contestant: contestant, category: category);
  if (!context.mounted || r == null) return;
  if (r.share) await shareContest(context, contest, contestant: contestant);
  if (r.wantsPacks && context.mounted) await openVotePacks(context, contest: contest, contestant: contestant);
}

enum ContestSort { number, name, rank, votes }

/// Contest / pageant page: cover, status and countdown (Nepal time), rounds, award categories
/// as tabs, a searchable contestant grid, standings link, vote packs and how voting works.
/// Refreshes every 15 s while on screen.
class ContestScreen extends ConsumerStatefulWidget {
  final String eventSlug;
  final String contestRef;
  final Contest? preview;
  const ContestScreen({super.key, required this.eventSlug, required this.contestRef, this.preview});

  @override
  ConsumerState<ContestScreen> createState() => _ContestScreenState();
}

class _ContestScreenState extends ConsumerState<ContestScreen> {
  ContestKey get _key => (slug: widget.eventSlug, ref: widget.contestRef);
  final _search = TextEditingController();
  String _query = '';
  String? _tab; // category id, or null = all contestants
  String _status = 'all';
  ContestSort _sort = ContestSort.number;
  Timer? _refresh;

  @override
  void initState() {
    super.initState();
    _refresh = Timer.periodic(const Duration(seconds: 15), (_) {
      final route = ModalRoute.of(context);
      final c = ref.read(contestProvider(_key)).valueOrNull;
      if (route?.isCurrent == true && (c == null || c.isLive)) ref.invalidate(contestProvider(_key));
    });
  }

  @override
  void dispose() {
    _refresh?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    ref.invalidate(contestProvider(_key));
    ref.invalidate(myAllowanceProvider);
    try {
      await ref.read(contestProvider(_key).future);
    } catch (_) {}
  }

  List<Contestant> _visible(Contest c) {
    final cat = c.categories.where((x) => x.id == _tab).firstOrNull;
    var list = cat == null ? c.contestants : c.nomineesOf(cat);
    final q = _query.trim().toLowerCase();
    final digits = q.replaceFirst(RegExp(r'^#?0*'), '');
    list = list.where((x) {
      if (_status == 'in' && x.isOut) return false;
      if (_status == 'out' && !x.isOut) return false;
      if (q.isEmpty) return true;
      return x.name.toLowerCase().contains(q) ||
          x.displayNumber.toLowerCase().contains(q) ||
          (digits.isNotEmpty && x.number?.toString() == digits) ||
          x.subtitle.toLowerCase().contains(q) ||
          x.profile.any((p) => p.value.toLowerCase().contains(q));
    }).toList();
    final ranks = {for (final r in (cat?.standings ?? c.standings)?.rows ?? const <StandingRow>[]) r.contestantId: r};
    int byNumber(Contestant a, Contestant b) => (a.number ?? 1 << 30).compareTo(b.number ?? 1 << 30);
    switch (_sort) {
      case ContestSort.name:
        list.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      case ContestSort.rank:
        list.sort((a, b) {
          final ra = ranks[a.id]?.rank ?? 1 << 30, rb = ranks[b.id]?.rank ?? 1 << 30;
          return ra != rb ? ra.compareTo(rb) : byNumber(a, b);
        });
      case ContestSort.votes:
        list.sort((a, b) {
          final va = ranks[a.id]?.votes ?? -1, vb = ranks[b.id]?.votes ?? -1;
          return va != vb ? vb.compareTo(va) : byNumber(a, b);
        });
      case ContestSort.number:
        list.sort(byNumber);
    }
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(contestProvider(_key));
    final contest = async.valueOrNull ?? widget.preview;
    ref.listen(contestProvider(_key), (_, next) {
      if (next.hasError) noteModuleDisabled(ref, next.error!);
    });

    final loaded = async.valueOrNull;
    if (loaded == null && async.hasError) {
      return _Shell(title: contest?.title ?? 'Contest', child: _errorView(async.error!));
    }
    if (contest == null) {
      return const _Shell(title: 'Contest', child: Center(child: CircularProgressIndicator()));
    }
    return _page(contest, refreshing: async.isLoading, firstLoad: loaded == null);
  }

  Widget _errorView(Object e) {
    final f = ContestFailure.from(e);
    if (f.moduleDisabled || ApiClient.isModuleDisabled(e)) {
      return const EmptyState(
        icon: Icons.power_settings_new_rounded,
        title: 'Not available right now',
        message: "Voting is switched off at the moment. Check back later.",
      );
    }
    return ErrorState(
      title: f.status == 404 ? "We couldn't find this contest" : "Couldn't load this contest",
      message: f.status == 404 ? "The link may be old, or the contest isn't public yet." : f.message,
      onRetry: () => ref.invalidate(contestProvider(_key)),
    );
  }

  Widget _page(Contest c, {required bool refreshing, bool firstLoad = false}) {
    final cat = c.categories.where((x) => x.id == _tab).firstOrNull;
    final visible = _visible(c);
    final standings = cat?.standings ?? c.standings;
    final ranks = {for (final r in standings?.rows ?? const <StandingRow>[]) r.contestantId: r.rank};
    final anyOut = c.contestants.any((x) => x.isOut);
    final paidOn = ref.watch(moduleEnabledProvider(AppModule.paidVotes));

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: LayoutBuilder(builder: (context, constraints) {
          final gutter = AppScaffold.gutterFor(constraints.maxWidth);
          final cols = constraints.maxWidth >= 900 ? 4 : (constraints.maxWidth >= 600 ? 3 : 2);
          return RefreshIndicator(
            color: AppColors.brand,
            edgeOffset: MediaQuery.paddingOf(context).top,
            onRefresh: _reload,
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
              slivers: [
                _Cover(contest: c, onShare: () => shareContest(context, c)),
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(gutter, 18, gutter, 0),
                  sliver: SliverList.list(children: [
                    _Header(contest: c, refreshing: refreshing),
                    const SizedBox(height: 14),
                    _StatusNotice(contest: c),
                    if (c.rounds.length > 1) ...[const SizedBox(height: 14), _RoundsStrip(contest: c)],
                    if (c.resultsRevealed && c.winner != null) ...[
                      const SizedBox(height: 14),
                      _WinnerBanner(contest: c, winner: c.winner!, onTap: () => _openResults(c)),
                    ],
                    if (c.standings != null || c.categories.any((x) => x.standings != null) || c.isClosed) ...[
                      const SizedBox(height: 14),
                      _ResultsButton(contest: c, onTap: () => _openResults(c)),
                    ],
                    if (c.paid.showPacks && paidOn && !c.isClosed) ...[
                      const SizedBox(height: 14),
                      _PacksTeaser(contest: c, onTap: c.paid.canBuy ? () => openVotePacks(context, contest: c) : null),
                    ],
                    const SizedBox(height: 22),
                    if (c.categories.isNotEmpty) ...[
                      FilterPills<String?>(
                        segments: [
                          Segment(null, c.rules.mainVoteEnabled ? 'All contestants' : 'Contestants'),
                          for (final x in c.categories) Segment(x.id, x.name),
                        ],
                        selected: _tab,
                        onChanged: (v) => setState(() => _tab = v),
                      ),
                      const SizedBox(height: 12),
                    ],
                    if (cat != null) ...[_CategoryCard(contest: c, category: cat), const SizedBox(height: 12)],
                    _SearchBar(
                      controller: _search,
                      sort: _sort,
                      canRank: standings != null,
                      canVotes: standings?.full == true,
                      onChanged: (v) => setState(() => _query = v),
                      onSort: (s) => setState(() => _sort = s),
                    ),
                    if (anyOut) ...[
                      const SizedBox(height: 10),
                      FilterPills<String>(
                        segments: const [Segment('all', 'All'), Segment('in', 'Still in'), Segment('out', 'Out')],
                        selected: _status,
                        onChanged: (v) => setState(() => _status = v),
                      ),
                    ],
                    const SizedBox(height: 10),
                    Text(
                      visible.length == c.contestants.length
                          ? '${c.contestants.length} contestants'
                          : '${visible.length} of ${c.contestants.length}',
                      style: AppType.caption,
                    ),
                    const SizedBox(height: 10),
                  ]),
                ),
                if (firstLoad)
                  const SliverToBoxAdapter(
                    child: Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())),
                  )
                else if (visible.isEmpty)
                  SliverPadding(
                    padding: EdgeInsets.symmetric(horizontal: gutter, vertical: 24),
                    sliver: SliverToBoxAdapter(
                      child: EmptyState(
                        icon: Icons.search_off_rounded,
                        title: c.contestants.isEmpty ? 'No contestants yet' : 'No one matches',
                        message: c.contestants.isEmpty
                            ? 'The organizers haven\'t added contestants yet.'
                            : 'Try another name or number, or clear the filters.',
                      ),
                    ),
                  )
                else
                  SliverPadding(
                    padding: EdgeInsets.symmetric(horizontal: gutter),
                    sliver: SliverGrid.builder(
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: cols,
                        mainAxisSpacing: 12,
                        crossAxisSpacing: 12,
                        mainAxisExtent: _cardHeight(constraints.maxWidth, gutter, cols, context),
                      ),
                      itemCount: visible.length,
                      itemBuilder: (context, i) {
                        final x = visible[i];
                        final canVote = cat == null
                            ? c.canReceiveVotes(x)
                            : (cat.votingOpen && x.status != 'withdrawn' && x.status != 'eliminated');
                        return ContestantCard(
                          contestant: x,
                          rank: ranks[x.id],
                          canVote: canVote,
                          onOpen: () => openContestant(context, contest: c, contestant: x),
                          onVote: () => voteFor(context, c, x, category: cat),
                        );
                      },
                    ),
                  ),
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(gutter, 24, gutter, MediaQuery.paddingOf(context).bottom + 32),
                  sliver: SliverList.list(children: [_HowVotingWorks(contest: c)]),
                ),
              ],
            ),
          );
        }),
      ),
    );
  }

  double _cardHeight(double width, double gutter, int cols, BuildContext context) {
    final w = (width - gutter * 2 - 12 * (cols - 1)) / cols;
    final scale = MediaQuery.textScalerOf(context).clamp(maxScaleFactor: 1.4).scale(1);
    return w * 5 / 4 + 112 * scale;
  }

  void _openResults(Contest c) => Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => ContestResultsScreen(eventSlug: c.eventSlug, contestRef: c.ref, initial: c),
      ));
}

class _Shell extends StatelessWidget {
  final String title;
  final Widget child;
  const _Shell({required this.title, required this.child});

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(leading: const BackButton(color: AppColors.brand), title: Text(title, style: AppType.navTitle)),
        body: child,
      );
}

class _Cover extends StatelessWidget {
  final Contest contest;
  final VoidCallback onShare;
  const _Cover({required this.contest, required this.onShare});

  @override
  Widget build(BuildContext context) {
    final topPad = MediaQuery.paddingOf(context).top;
    return SliverAppBar(
      pinned: true,
      stretch: true,
      expandedHeight: 210 + topPad * 0.3,
      backgroundColor: AppColors.brandDark,
      foregroundColor: Colors.white,
      systemOverlayStyle: SystemUiOverlayStyle.light,
      leading: Padding(
        padding: const EdgeInsets.all(6),
        child: _Glass(
          child: IconButton(
            tooltip: 'Back',
            icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18, color: Colors.white),
            onPressed: () => Navigator.of(context).maybePop(),
          ),
        ),
      ),
      actions: [
        Padding(
          padding: const EdgeInsets.all(6),
          child: _Glass(
            child: IconButton(
              tooltip: 'Share contest',
              icon: const Icon(Icons.ios_share_rounded, size: 20, color: Colors.white),
              onPressed: onShare,
            ),
          ),
        ),
      ],
      flexibleSpace: FlexibleSpaceBar(
        stretchModes: const [StretchMode.zoomBackground],
        background: Stack(fit: StackFit.expand, children: [
          contest.coverUrl == null
              ? const DecoratedBox(
                  decoration: BoxDecoration(gradient: brandGradient),
                  child: Center(child: Icon(Icons.emoji_events_rounded, size: 72, color: Colors.white54)),
                )
              : NetImage(url: contest.coverUrl, icon: Icons.emoji_events_rounded),
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0x66110D17), Color(0x00110D17), Color(0x88110D17)],
                stops: [0, 0.45, 1],
              ),
            ),
          ),
          Positioned(left: 16, bottom: 14, child: GlassChip(contest.eventTitle.isEmpty ? 'Contest' : contest.eventTitle)),
        ]),
      ),
    );
  }
}

class _Glass extends StatelessWidget {
  final Widget child;
  const _Glass({required this.child});

  @override
  Widget build(BuildContext context) => ClipOval(
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
          child: ColoredBox(color: AppColors.ink950.withValues(alpha: 0.3), child: child),
        ),
      );
}

class _Header extends StatelessWidget {
  final Contest contest;
  final bool refreshing;
  const _Header({required this.contest, required this.refreshing});

  @override
  Widget build(BuildContext context) {
    final c = contest;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        ContestStatusBadge(c),
        if (c.currentRound != null) StatusBadge(c.currentRound!.name, tone: Tone.brand, dot: false),
        CountdownText(target: c.countdownTarget, label: c.countdownLabel),
        if (refreshing) const SizedBox.square(dimension: 12, child: CircularProgressIndicator(strokeWidth: 1.6)),
      ]),
      const SizedBox(height: 10),
      Text(c.title, style: AppType.heading(28, weight: FontWeight.w800)),
      if (c.description.isNotEmpty) ...[
        const SizedBox(height: 6),
        _Expandable(text: c.description),
      ],
      if (c.isScheduled && c.opensAt != null || c.isOpen && c.closesAt != null) ...[
        const SizedBox(height: 6),
        Text(
          c.isScheduled ? 'Opens ${nepalTime(c.opensAt!)}' : 'Voting closes ${nepalTime(c.closesAt!)}',
          style: AppType.caption,
        ),
      ],
    ]);
  }
}

class _Expandable extends StatefulWidget {
  final String text;
  const _Expandable({required this.text});

  @override
  State<_Expandable> createState() => _ExpandableState();
}

class _ExpandableState extends State<_Expandable> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final long = widget.text.length > 180;
    return GestureDetector(
      onTap: long ? () => setState(() => _open = !_open) : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(widget.text,
            maxLines: _open || !long ? null : 3,
            overflow: _open || !long ? null : TextOverflow.ellipsis,
            style: AppType.body(15, color: AppColors.textSecondary)),
        if (long) Text(_open ? 'Show less' : 'Read more', style: AppType.body(13, weight: FontWeight.w600, color: AppColors.brand)),
      ]),
    );
  }
}

class _StatusNotice extends ConsumerWidget {
  final Contest contest;
  const _StatusNotice({required this.contest});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = contest;
    final line = c.statusLine;
    final open = c.acceptingVotes && c.isOpen;
    final mine = open ? ref.watch(myAllowanceProvider(c)).valueOrNull?.main : null;
    return ContestNotice(
      icon: c.isScheduled
          ? Icons.schedule_rounded
          : c.isClosed
              ? Icons.lock_rounded
              : open
                  ? Icons.auto_awesome_rounded
                  : Icons.gavel_rounded,
      tone: c.isScheduled ? Tone.warning : (c.isClosed ? Tone.neutral : (open ? Tone.success : Tone.brand)),
      title: line.title,
      body: mine == null ? line.body : '${line.body}\n${mine.line}.',
    );
  }
}

class _RoundsStrip extends StatelessWidget {
  final Contest contest;
  const _RoundsStrip({required this.contest});

  @override
  Widget build(BuildContext context) {
    final rounds = contest.rounds;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(children: [
        for (var i = 0; i < rounds.length; i++) ...[
          if (i > 0) const Padding(padding: EdgeInsets.symmetric(horizontal: 4), child: Icon(Icons.chevron_right_rounded, size: 18, color: AppColors.ink300)),
          _RoundChip(round: rounds[i], current: rounds[i].id == contest.currentRound?.id),
        ],
      ]),
    );
  }
}

class _RoundChip extends StatelessWidget {
  final RoundBrief round;
  final bool current;
  const _RoundChip({required this.round, required this.current});

  @override
  Widget build(BuildContext context) {
    final done = round.status == 'closed';
    final bg = current ? AppColors.brand : (done ? AppColors.ink100 : AppColors.surface);
    final fg = current ? Colors.white : (done ? AppColors.ink600 : AppColors.ink700);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: current ? AppColors.brand : AppColors.ink200, width: 0.8),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (done) ...[Icon(Icons.check_rounded, size: 14, color: fg), const SizedBox(width: 4)],
        if (current) ...[const Icon(Icons.circle, size: 7, color: Colors.white), const SizedBox(width: 6)],
        Text(round.name, style: AppType.body(13, weight: FontWeight.w600, color: fg)),
        if (round.judgingEnabled && !round.publicVoteEnabled) ...[
          const SizedBox(width: 4),
          Icon(Icons.gavel_rounded, size: 13, color: fg),
        ],
      ]),
    );
  }
}

class _WinnerBanner extends StatelessWidget {
  final Contest contest;
  final Contestant winner;
  final VoidCallback onTap;
  const _WinnerBanner({required this.contest, required this.winner, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFFFF4D6),
      borderRadius: BorderRadius.circular(AppRadius.lg),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            SizedBox(width: 56, height: 56, child: ContestantPhoto(name: winner.name, url: winner.photoUrl, radius: 14, initialsSize: 20)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  const Icon(Icons.emoji_events_rounded, size: 16, color: AppColors.marigoldDark),
                  const SizedBox(width: 4),
                  Text((contest.placementTitle(1) ?? 'Winner').toUpperCase(),
                      style: AppType.body(12, weight: FontWeight.w700, color: AppColors.marigoldDark).copyWith(letterSpacing: 0.8)),
                ]),
                Text(winner.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.heading(18)),
              ]),
            ),
            const Icon(Icons.chevron_right_rounded, color: AppColors.marigoldDark),
          ]),
        ),
      ),
    );
  }
}

class _ResultsButton extends StatelessWidget {
  final Contest contest;
  final VoidCallback onTap;
  const _ResultsButton({required this.contest, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final s = contest.standings;
    final leader = s?.rows.where((r) => r.rank == 1).firstOrNull;
    return GroupedSection(
      margin: EdgeInsets.zero,
      children: [
        ListRow(
          leading: const RowIcon(Icons.leaderboard_rounded, background: AppColors.marigold),
          title: contest.isClosed ? 'Results' : 'Live results',
          subtitle: s == null
              ? (contest.isClosed ? 'See how it ended' : 'Award categories')
              : [
                  if (contest.displayRound != null) contest.displayRound!.name,
                  s.summary,
                  if (leader != null) 'Leading: ${leader.displayNumber} ${leader.name}'.trim(),
                ].join(' · '),
          chevron: true,
          onTap: onTap,
        ),
      ],
    );
  }
}

class _PacksTeaser extends StatelessWidget {
  final Contest contest;

  /// Null when packs can't be bought right now (the server's reason is shown instead).
  final VoidCallback? onTap;
  const _PacksTeaser({required this.contest, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final paid = contest.paid;
    final cheapest = [...paid.packs]..sort((a, b) => a.price.compareTo(b.price));
    final via = paid.providers.where((p) => p.id != 'test').map((p) => p.name).join(' or ');
    return GroupedSection(
      margin: EdgeInsets.zero,
      children: [
        ListRow(
          leading: RowIcon(Icons.add_card_rounded, background: onTap == null ? AppColors.ink400 : AppColors.success),
          title: 'Get more votes',
          subtitle: onTap == null
              ? (paid.unavailableMessage ?? 'Vote packs can\'t be bought right now.')
              : [
                  if (cheapest.isNotEmpty) 'Vote packs from ${cheapest.first.priceLabel}',
                  if (via.isNotEmpty) via,
                ].join(' · '),
          chevron: onTap != null,
          onTap: onTap,
        ),
      ],
    );
  }
}

class _CategoryCard extends StatelessWidget {
  final Contest contest;
  final ContestCategory category;
  const _CategoryCard({required this.contest, required this.category});

  @override
  Widget build(BuildContext context) {
    final cat = category;
    final winner = cat.winner == null ? null : contest.contestantById(cat.winner!);
    final sub = [cat.selectionLabel, if (cat.selection == 'public_vote' && cat.voteText.isNotEmpty) cat.voteText].join(' · ');
    return GroupedSurface(
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(color: AppColors.marigoldTint, borderRadius: BorderRadius.circular(10)),
            child: const Icon(Icons.workspace_premium_rounded, color: AppColors.marigoldDark),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(cat.name, style: AppType.heading(17)),
              Text(sub, style: AppType.caption),
            ]),
          ),
          if (cat.votingOpen) const StatusBadge('Voting open', tone: Tone.success),
        ]),
        if (cat.description.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(cat.description, style: AppType.body(13.5, color: AppColors.ink700)),
        ],
        if (winner != null) ...[
          const SizedBox(height: 10),
          Row(children: [
            const Icon(Icons.emoji_events_rounded, size: 18, color: AppColors.marigoldDark),
            const SizedBox(width: 6),
            Expanded(child: Text('Winner: ${winner.label}', style: AppType.body(14, weight: FontWeight.w600))),
          ]),
        ] else if (!cat.votingOpen && cat.selection == 'public_vote' && !contest.isClosed) ...[
          const SizedBox(height: 8),
          Text('Voting in this category isn\'t open right now.', style: AppType.caption),
        ],
      ]),
    );
  }
}

class _SearchBar extends StatelessWidget {
  final TextEditingController controller;
  final ContestSort sort;
  final bool canRank;
  final bool canVotes;
  final ValueChanged<String> onChanged;
  final ValueChanged<ContestSort> onSort;
  const _SearchBar({
    required this.controller,
    required this.sort,
    required this.canRank,
    required this.canVotes,
    required this.onChanged,
    required this.onSort,
  });

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Expanded(
        child: TextField(
          controller: controller,
          onChanged: onChanged,
          textInputAction: TextInputAction.search,
          style: AppType.body(15),
          decoration: InputDecoration(
            hintText: 'Search by name or number',
            prefixIcon: const Icon(Icons.search_rounded, color: AppColors.ink400),
            suffixIcon: controller.text.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Clear search',
                    icon: const Icon(Icons.close_rounded, size: 18),
                    onPressed: () {
                      controller.clear();
                      onChanged('');
                    },
                  ),
            filled: true,
            fillColor: AppColors.surface,
            contentPadding: const EdgeInsets.symmetric(vertical: 12),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.ink200)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.ink200)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.brand)),
          ),
        ),
      ),
      const SizedBox(width: 8),
      PopupMenuButton<ContestSort>(
        tooltip: 'Sort',
        initialValue: sort,
        onSelected: onSort,
        itemBuilder: (_) => [
          const PopupMenuItem(value: ContestSort.number, child: Text('Number')),
          const PopupMenuItem(value: ContestSort.name, child: Text('Name A–Z')),
          if (canRank) const PopupMenuItem(value: ContestSort.rank, child: Text('Rank')),
          if (canVotes) const PopupMenuItem(value: ContestSort.votes, child: Text('Most votes')),
        ],
        child: Container(
          height: 48,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.ink200),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.sort_rounded, size: 20, color: AppColors.ink600),
            const SizedBox(width: 4),
            Text(switch (sort) {
              ContestSort.number => 'No.',
              ContestSort.name => 'A–Z',
              ContestSort.rank => 'Rank',
              ContestSort.votes => 'Votes',
            }, style: AppType.body(13, weight: FontWeight.w600, color: AppColors.ink700)),
          ]),
        ),
      ),
    ]);
  }
}

class _HowVotingWorks extends StatelessWidget {
  final Contest contest;
  const _HowVotingWorks({required this.contest});

  @override
  Widget build(BuildContext context) {
    final c = contest, r = c.rules;
    final judged = c.rounds.any((x) => x.judgingEnabled);
    final rules = [
      '${r.allowanceText}${r.votesPerDay != null ? '. Daily votes reset at midnight, Nepal time' : ''}.',
      if (r.maxVotesPerSubmit > 1) 'You can give up to ${r.maxVotesPerSubmit} at once.',
      if (r.contestantCapText != null) r.contestantCapText!,
      if (!r.allowSplit) 'All your votes go to one contestant.',
    ].join(' ');
    Widget item(IconData icon, Color color, String text) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(icon, size: 18, color: color),
            const SizedBox(width: 10),
            Expanded(child: Text(text, style: AppType.body(13.5, color: AppColors.ink700))),
          ]),
        );
    return GroupedSurface(
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          leading: const Icon(Icons.help_outline_rounded, color: AppColors.ink500),
          title: Text('How voting works', style: AppType.body(15, weight: FontWeight.w600)),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
          expandedCrossAxisAlignment: CrossAxisAlignment.start,
          children: [
            item(Icons.verified_user_rounded, AppColors.success, c.methodText),
            item(Icons.how_to_vote_rounded, AppColors.brand, rules),
            if (c.rounds.isNotEmpty)
              item(
                Icons.emoji_events_rounded,
                AppColors.marigold,
                'The contest runs in rounds: ${c.rounds.map((x) => x.name).join(' → ')}.'
                '${judged ? ' In judged rounds, the final score combines the judges\' scores and the public vote.' : ''}',
              ),
            item(Icons.info_outline_rounded, AppColors.ink500, 'Votes from bots or suspicious bursts can be removed by the organizers.'),
            if (c.transparencyNote.isNotEmpty)
              Container(
                width: double.infinity,
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: AppColors.ink100, borderRadius: BorderRadius.circular(12)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('From the organizers', style: AppType.body(13, weight: FontWeight.w600)),
                  const SizedBox(height: 2),
                  Text(c.transparencyNote, style: AppType.body(13, color: AppColors.ink700)),
                ]),
              ),
          ],
        ),
      ),
    );
  }
}
