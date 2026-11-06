import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../providers/modules_provider.dart';
import '../../ui/ui.dart';
import '../data/contest_api.dart';
import '../models/contest.dart';
import '../providers/contest_providers.dart';
import '../widgets/contest_widgets.dart';
import 'contest_screen.dart';
import 'photo_viewer.dart';
import 'share_contestant.dart';

/// Opens a contestant's profile.
Future<void> openContestant(BuildContext context, {required Contest contest, required Contestant contestant}) {
  return Navigator.of(context).push(MaterialPageRoute(
    builder: (_) => ContestantScreen(
      eventSlug: contest.eventSlug,
      contestRef: contest.ref,
      contestantRef: contestant.ref,
      previewContest: contest,
      preview: contestant,
    ),
  ));
}

/// Contestant profile: swipeable photo gallery (tap for full screen with pinch zoom), number,
/// standing, bio, public profile fields, social links, award categories, share card and a big
/// Vote button. Refreshes every 20 s.
class ContestantScreen extends ConsumerStatefulWidget {
  final String eventSlug;
  final String contestRef;
  final String contestantRef;
  final Contest? previewContest;
  final Contestant? preview;
  const ContestantScreen({
    super.key,
    required this.eventSlug,
    required this.contestRef,
    required this.contestantRef,
    this.previewContest,
    this.preview,
  });

  @override
  ConsumerState<ContestantScreen> createState() => _ContestantScreenState();
}

class _ContestantScreenState extends ConsumerState<ContestantScreen> {
  late String _cref = widget.contestantRef;
  ContestantKey get _key => (slug: widget.eventSlug, ref: widget.contestRef, cref: _cref);
  Timer? _timer;
  final _gallery = PageController();
  int _photo = 0;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (ModalRoute.of(context)?.isCurrent == true) ref.invalidate(contestantProvider(_key));
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _gallery.dispose();
    super.dispose();
  }

  void _goTo(ContestantLink link) {
    setState(() {
      _cref = link.ref;
      _photo = 0;
    });
    if (_gallery.hasClients) _gallery.jumpToPage(0);
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(contestantProvider(_key));
    ref.listen(contestantProvider(_key), (_, next) {
      if (next.hasError) noteModuleDisabled(ref, next.error!);
    });
    final data = async.valueOrNull;
    final contest = data?.contest ?? widget.previewContest;
    final c = data?.contestant ?? (_cref == widget.contestantRef ? widget.preview : null);

    if (contest == null || c == null) {
      return Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(leading: const BackButton(color: AppColors.brand)),
        body: async.hasError ? _error(async.error!) : const Center(child: CircularProgressIndicator()),
      );
    }

    final photos = c.photos;
    final categories = contest.openCategoriesFor(c);
    final reason = contest.closedReason(c);
    final canVote = reason == null && contest.canReceiveVotes(c);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        backgroundColor: AppColors.background,
        bottomNavigationBar: _VoteBar(
          label: c.label,
          canVote: canVote,
          reason: reason ?? (categories.isNotEmpty ? 'Vote in an award category above' : 'Public voting isn\'t open for this contestant'),
          onVote: () => voteFor(context, contest, c),
        ),
        body: LayoutBuilder(builder: (context, constraints) {
          final gutter = AppScaffold.gutterFor(constraints.maxWidth);
          final galleryWidth = constraints.maxWidth > 560 ? 520.0 : constraints.maxWidth;
          return RefreshIndicator(
            color: AppColors.brand,
            onRefresh: () async {
              ref.invalidate(contestantProvider(_key));
              try {
                await ref.read(contestantProvider(_key).future);
              } catch (_) {}
            },
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
              slivers: [
                SliverAppBar(
                  pinned: true,
                  backgroundColor: AppColors.ink950,
                  foregroundColor: Colors.white,
                  expandedHeight: galleryWidth * 5 / 4 - MediaQuery.paddingOf(context).top,
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
                          tooltip: 'Share',
                          icon: const Icon(Icons.ios_share_rounded, size: 20, color: Colors.white),
                          onPressed: () => shareContest(context, contest, contestant: c),
                        ),
                      ),
                    ),
                  ],
                  flexibleSpace: FlexibleSpaceBar(
                    collapseMode: CollapseMode.parallax,
                    background: Center(
                      child: SizedBox(
                        width: galleryWidth,
                        child: _Gallery(
                          contestant: c,
                          photos: photos,
                          controller: _gallery,
                          index: _photo,
                          onChanged: (i) => setState(() => _photo = i),
                          onOpen: (i) => openPhotoViewer(context, photos, initial: i, title: c.label,
                              heroTag: 'contestant-photo-${c.id}'),
                        ),
                      ),
                    ),
                  ),
                ),
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(gutter, 18, gutter, 32),
                  sliver: SliverList.list(children: [
                    Wrap(spacing: 8, runSpacing: 6, children: [
                      NumberTag(c.displayNumber, size: 16, background: AppColors.brand),
                      ContestantStatusBadge(c),
                      if (contest.currentRound != null && c.inCurrentRound == true)
                        StatusBadge('In ${contest.currentRound!.name}', tone: Tone.brand, dot: false),
                    ]),
                    const SizedBox(height: 10),
                    Text(c.name, style: AppType.heading(30, weight: FontWeight.w800)),
                    if (c.subtitle.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(c.subtitle, style: AppType.body(16, color: AppColors.textSecondary)),
                    ],
                    Text(contest.title, style: AppType.body(13, weight: FontWeight.w500, color: AppColors.brand)),
                    if (c.standing != null) ...[const SizedBox(height: 16), _StandingTiles(contestant: c, contest: contest)],
                    if (c.description.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Text(c.description, style: AppType.body(15, height: 1.55)),
                    ],
                    if (c.profile.isNotEmpty) ...[const SizedBox(height: 18), _ProfileGrid(entries: c.profile)],
                    if (c.socialLinks.isNotEmpty) ...[const SizedBox(height: 18), _Socials(links: c.socialLinks)],
                    if (categories.isNotEmpty) ...[
                      const SizedBox(height: 22),
                      GroupedSection(
                        header: 'Also nominated for',
                        separatorInset: 54,
                        children: [
                          for (final cat in categories)
                            ListRow(
                              leading: const RowIcon(Icons.workspace_premium_rounded, background: AppColors.marigold),
                              title: cat.name,
                              subtitle: cat.voteText.isEmpty ? null : cat.voteText,
                              trailing: FilledButton.tonal(
                                onPressed: () => voteFor(context, contest, c, category: cat),
                                child: const Text('Vote'),
                              ),
                            ),
                        ],
                      ),
                    ] else
                      const SizedBox(height: 22),
                    PrimaryButton(
                      label: 'Share ${c.name.split(' ').first}\'s card',
                      icon: Icons.ios_share_rounded,
                      tone: ButtonTone.neutral,
                      tonal: true,
                      onPressed: () => shareContest(context, contest, contestant: c),
                    ),
                    const SizedBox(height: 20),
                    _PrevNext(contestant: c, onTap: _goTo),
                  ]),
                ),
              ],
            ),
          );
        }),
      ),
    );
  }

  Widget _error(Object e) {
    final f = ContestFailure.from(e);
    if (f.moduleDisabled) {
      return const EmptyState(
        icon: Icons.power_settings_new_rounded,
        title: 'Not available right now',
        message: 'Voting is switched off at the moment. Check back later.',
      );
    }
    return ErrorState(
      title: f.status == 404 ? "We couldn't find this contestant" : "Couldn't load this profile",
      message: f.status == 404 ? 'Check the number in the link.' : f.message,
      onRetry: () => ref.invalidate(contestantProvider(_key)),
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

class _Gallery extends StatelessWidget {
  final Contestant contestant;
  final List<String> photos;
  final PageController controller;
  final int index;
  final ValueChanged<int> onChanged;
  final ValueChanged<int> onOpen;
  const _Gallery({
    required this.contestant,
    required this.photos,
    required this.controller,
    required this.index,
    required this.onChanged,
    required this.onOpen,
  });

  @override
  Widget build(BuildContext context) {
    final c = contestant;
    if (photos.isEmpty) {
      return Hero(tag: 'contestant-photo-${c.id}', child: ContestantPhoto(name: c.name, radius: 0, initialsSize: 96));
    }
    return Stack(fit: StackFit.expand, children: [
      PageView.builder(
        controller: controller,
        itemCount: photos.length,
        onPageChanged: onChanged,
        itemBuilder: (_, i) {
          final img = ContestantPhoto(name: c.name, url: photos[i], radius: 0, initialsSize: 96);
          return Semantics(
            button: true,
            label: 'Photo ${i + 1} of ${photos.length}. Open full screen',
            child: GestureDetector(
              onTap: () => onOpen(i),
              child: i == 0 ? Hero(tag: 'contestant-photo-${c.id}', child: img) : img,
            ),
          );
        },
      ),
      const IgnorePointer(
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0x55110D17), Color(0x00110D17), Color(0x00110D17), Color(0x66110D17)],
              stops: [0, 0.25, 0.75, 1],
            ),
          ),
        ),
      ),
      if (photos.length > 1)
        Positioned(
          left: 0,
          right: 0,
          bottom: 14,
          child: IgnorePointer(
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              for (var i = 0; i < photos.length; i++)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: i == index ? 18 : 7,
                  height: 7,
                  decoration: BoxDecoration(
                    color: i == index ? Colors.white : Colors.white54,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
            ]),
          ),
        ),
      Positioned(
        right: 14,
        bottom: 10,
        child: IgnorePointer(
          child: Icon(Icons.zoom_out_map_rounded, color: Colors.white.withValues(alpha: 0.85), size: 20),
        ),
      ),
    ]);
  }
}

class _StandingTiles extends StatelessWidget {
  final Contestant contestant;
  final Contest contest;
  const _StandingTiles({required this.contestant, required this.contest});

  @override
  Widget build(BuildContext context) {
    final s = contestant.standing!;
    final full = contestant.standingLevel == 'full';
    Widget tile(String label, String value, {bool dark = false}) => Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: dark ? AppColors.ink900 : AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: dark ? null : Border.all(color: AppColors.ink200),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label.toUpperCase(),
                style: AppType.body(11, weight: FontWeight.w600, color: dark ? AppColors.ink300 : AppColors.ink500)
                    .copyWith(letterSpacing: 0.8)),
            Text(value,
                style: AppType.heading(26, weight: FontWeight.w800, color: dark ? Colors.white : AppColors.ink900)
                    .copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
          ]),
        );
    final placement = contest.isClosed ? contest.placementTitle(s.rank) : null;
    return Semantics(
      liveRegion: true,
      child: Wrap(spacing: 10, runSpacing: 10, children: [
        if (s.rank != null) tile(placement ?? 'Rank', '${s.rank}${s.tied ? '=' : ''}', dark: true),
        if (full && s.votes != null) tile('Votes', '${s.votes}'),
        if (full && s.finalScore != null) tile('Score', s.finalScore!.toStringAsFixed(1)),
      ]),
    );
  }
}

class _ProfileGrid extends StatelessWidget {
  final List<ProfileEntry> entries;
  const _ProfileGrid({required this.entries});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      final w = (c.maxWidth - 10) / 2;
      return Wrap(spacing: 10, runSpacing: 10, children: [
        for (final e in entries)
          SizedBox(
            width: w,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.ink200),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(e.label, style: AppType.caption),
                Text(e.value, style: AppType.body(14.5, weight: FontWeight.w600)),
              ]),
            ),
          ),
      ]);
    });
  }
}

class _Socials extends StatelessWidget {
  final Map<String, String> links;
  const _Socials({required this.links});

  static const _labels = {
    'facebook': ('Facebook', Icons.facebook_rounded),
    'instagram': ('Instagram', Icons.camera_alt_outlined),
    'tiktok': ('TikTok', Icons.music_note_rounded),
    'youtube': ('YouTube', Icons.smart_display_outlined),
    'x': ('X', Icons.alternate_email_rounded),
    'website': ('Website', Icons.language_rounded),
  };

  @override
  Widget build(BuildContext context) {
    return Wrap(spacing: 8, runSpacing: 8, children: [
      for (final e in links.entries)
        ActionChip(
          avatar: Icon(_labels[e.key]?.$2 ?? Icons.link_rounded, size: 18, color: AppColors.ink700),
          label: Text(_labels[e.key]?.$1 ?? e.key, style: AppType.body(13.5, weight: FontWeight.w600)),
          side: const BorderSide(color: AppColors.ink200),
          backgroundColor: AppColors.surface,
          onPressed: () {
            final uri = Uri.tryParse(e.value.startsWith('http') ? e.value : 'https://${e.value}');
            if (uri != null) launchUrl(uri, mode: LaunchMode.externalApplication);
          },
        ),
    ]);
  }
}

class _PrevNext extends StatelessWidget {
  final Contestant contestant;
  final ValueChanged<ContestantLink> onTap;
  const _PrevNext({required this.contestant, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final p = contestant.previous, n = contestant.next;
    if (p == null && n == null) return const SizedBox.shrink();
    Widget link(ContestantLink l, bool next) => Expanded(
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () => onTap(l),
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                mainAxisAlignment: next ? MainAxisAlignment.end : MainAxisAlignment.start,
                children: [
                  if (!next) const Icon(Icons.chevron_left_rounded, color: AppColors.ink500),
                  Flexible(
                    child: Text('${l.displayNumber} ${l.name}'.trim(),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textAlign: next ? TextAlign.end : TextAlign.start,
                        style: AppType.body(13.5, weight: FontWeight.w600, color: AppColors.ink600)),
                  ),
                  if (next) const Icon(Icons.chevron_right_rounded, color: AppColors.ink500),
                ],
              ),
            ),
          ),
        );
    return Row(children: [
      if (p != null) link(p, false) else const Spacer(),
      if (n != null) link(n, true) else const Spacer(),
    ]);
  }
}

class _VoteBar extends StatelessWidget {
  final String label;
  final bool canVote;
  final String reason;
  final VoidCallback onVote;
  const _VoteBar({required this.label, required this.canVote, required this.reason, required this.onVote});

  @override
  Widget build(BuildContext context) {
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.ink50.withValues(alpha: 0.92),
            border: const Border(top: BorderSide(color: AppColors.separator, width: 0.5)),
          ),
          child: SafeArea(
            top: false,
            child: LayoutBuilder(builder: (context, c) {
              final gutter = AppScaffold.gutterFor(c.maxWidth);
              return Padding(
                padding: EdgeInsets.fromLTRB(gutter, 12, gutter, 12),
                child: canVote
                    ? SizedBox(
                        height: 56,
                        child: PrimaryButton(label: 'Vote for $label', icon: Icons.how_to_vote_rounded, onPressed: onVote),
                      )
                    : Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Text(reason, textAlign: TextAlign.center,
                            style: AppType.body(14, weight: FontWeight.w500, color: AppColors.ink600)),
                      ),
              );
            }),
          ),
        ),
      ),
    );
  }
}
