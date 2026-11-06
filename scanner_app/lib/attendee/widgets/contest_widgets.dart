import 'dart:async';
import 'package:clock/clock.dart';
import 'package:flutter/material.dart';
import '../../ui/ui.dart';
import '../models/contest.dart';
import 'attendee_widgets.dart';

/// "#07" badge.
class NumberTag extends StatelessWidget {
  final String value;
  final double size;
  final Color background;
  const NumberTag(this.value, {super.key, this.size = 14, this.background = AppColors.ink900});

  @override
  Widget build(BuildContext context) {
    if (value.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: EdgeInsets.symmetric(horizontal: size * 0.55, vertical: size * 0.18),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(size * 0.55)),
      child: Text(
        value,
        textScaler: TextScaler.noScaling,
        style: AppType.heading(size, weight: FontWeight.w800, color: Colors.white).copyWith(
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
    );
  }
}

/// Contestant photo, or their initials on the brand gradient.
class ContestantPhoto extends StatelessWidget {
  final String name;
  final String? url;
  final double radius;
  final double initialsSize;
  const ContestantPhoto({super.key, required this.name, this.url, this.radius = 14, this.initialsSize = 28});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: url == null
          ? DecoratedBox(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [AppColors.brandTint, Color(0xFFF7D3E1)],
                ),
              ),
              child: Center(
                child: Text(
                  InitialsAvatar.initialsOf(name),
                  textScaler: TextScaler.noScaling,
                  style: AppType.heading(initialsSize, weight: FontWeight.w800, color: AppColors.brand),
                ),
              ),
            )
          : NetImage(url: url, icon: Icons.person_rounded),
    );
  }
}

/// Eliminated / withdrawn / winner pill (nothing for active contestants).
class ContestantStatusBadge extends StatelessWidget {
  final Contestant contestant;
  const ContestantStatusBadge(this.contestant, {super.key});

  @override
  Widget build(BuildContext context) {
    final c = contestant;
    return switch (c.status) {
      'winner' => const StatusBadge('Winner', tone: Tone.warning, dot: false),
      'withdrawn' => const StatusBadge('Withdrawn', tone: Tone.danger, dot: false),
      'eliminated' => const StatusBadge('Eliminated', tone: Tone.neutral, dot: false),
      _ => c.inCurrentRound == false ? const StatusBadge('Out', tone: Tone.neutral, dot: false) : const SizedBox.shrink(),
    };
  }
}

/// Ticks every second: "Closes in 3h 12m". Hidden when there's nothing to count down to.
class CountdownText extends StatefulWidget {
  final DateTime? target;
  final String Function(Duration left) label;
  final TextStyle? style;
  final Color? iconColor;
  const CountdownText({super.key, required this.target, required this.label, this.style, this.iconColor});

  @override
  State<CountdownText> createState() => _CountdownTextState();
}

class _CountdownTextState extends State<CountdownText> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.target;
    if (t == null) return const SizedBox.shrink();
    final left = t.difference(clock.now());
    if (left.isNegative) return const SizedBox.shrink();
    final style = widget.style ?? AppType.body(13, weight: FontWeight.w600, color: AppColors.ink700);
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(Icons.schedule_rounded, size: 15, color: widget.iconColor ?? style.color),
      const SizedBox(width: 4),
      Flexible(
        child: Text(
          widget.label(left),
          style: style.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
          overflow: TextOverflow.ellipsis,
        ),
      ),
    ]);
  }
}

/// Status pill for a contest: Open / Opens soon / Closed.
class ContestStatusBadge extends StatelessWidget {
  final Contest contest;
  final bool onDark;
  const ContestStatusBadge(this.contest, {super.key, this.onDark = false});

  @override
  Widget build(BuildContext context) {
    final c = contest;
    if (c.isClosed) return StatusBadge(c.resultsRevealed ? 'Results out' : 'Closed', tone: Tone.neutral, onDark: onDark);
    if (c.isScheduled) return StatusBadge('Opens soon', tone: Tone.warning, onDark: onDark);
    if (!c.acceptingVotes) return StatusBadge('Judging', tone: Tone.brand, onDark: onDark);
    return StatusBadge('Voting open', tone: Tone.success, onDark: onDark);
  }
}

/// A tinted notice row: icon, bold title and a line of text.
class ContestNotice extends StatelessWidget {
  final IconData icon;
  final Tone tone;
  final String title;
  final String? body;
  final Widget? trailing;
  const ContestNotice({super.key, required this.icon, required this.tone, required this.title, this.body, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: tone.tint,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: tone.color.withValues(alpha: 0.25), width: 0.5),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 20, color: tone.strong),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: AppType.body(14, weight: FontWeight.w600)),
            if (body != null && body!.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(body!, style: AppType.body(13, color: AppColors.ink700)),
            ],
          ]),
        ),
        if (trailing != null) ...[const SizedBox(width: 8), trailing!],
      ]),
    );
  }
}

/// Grid card: portrait photo with number and rank / winner badges, name, Vote button.
class ContestantCard extends StatelessWidget {
  final Contestant contestant;
  final int? rank;
  final bool canVote;
  final VoidCallback onOpen;
  final VoidCallback? onVote;
  final String voteLabel;
  const ContestantCard({
    super.key,
    required this.contestant,
    required this.onOpen,
    this.rank,
    this.canVote = false,
    this.onVote,
    this.voteLabel = 'Vote',
  });

  @override
  Widget build(BuildContext context) {
    final c = contestant;
    return Opacity(
      opacity: c.isOut ? 0.62 : 1,
      child: GroupedSurface(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          InkWell(
            onTap: onOpen,
            child: AspectRatio(
              aspectRatio: 4 / 5,
              child: Stack(fit: StackFit.expand, children: [
                Hero(tag: 'contestant-photo-${c.id}', child: ContestantPhoto(name: c.name, url: c.photoUrl, radius: 0, initialsSize: 40)),
                Positioned(left: 8, top: 8, child: NumberTag(c.displayNumber, size: 15)),
                if (c.status == 'winner')
                  const Positioned(right: 8, top: 8, child: _Pill(icon: Icons.emoji_events_rounded, label: 'Winner', gold: true))
                else if (rank != null)
                  Positioned(right: 8, top: 8, child: _Pill(label: 'Rank $rank')),
              ]),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(c.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.body(14.5, weight: FontWeight.w600, height: 1.25)),
              if (c.subtitle.isNotEmpty)
                Text(c.subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.caption),
              if (c.isOut || c.status == 'withdrawn') ...[const SizedBox(height: 4), ContestantStatusBadge(c)],
              const SizedBox(height: 8),
              SizedBox(
                height: 38,
                width: double.infinity,
                child: canVote
                    ? FilledButton.icon(
                        onPressed: onVote,
                        icon: const Icon(Icons.how_to_vote_rounded, size: 18),
                        label: Text(voteLabel, style: AppType.body(14, weight: FontWeight.w600, color: Colors.white)),
                        style: FilledButton.styleFrom(
                          backgroundColor: AppColors.brand,
                          padding: EdgeInsets.zero,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                      )
                    : OutlinedButton(
                        onPressed: onOpen,
                        style: OutlinedButton.styleFrom(
                          padding: EdgeInsets.zero,
                          side: const BorderSide(color: AppColors.ink200),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                        child: Text('View profile', style: AppType.body(13.5, weight: FontWeight.w600, color: AppColors.ink700)),
                      ),
              ),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  final IconData? icon;
  final String label;
  final bool gold;
  const _Pill({this.icon, required this.label, this.gold = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: gold ? const Color(0xFFFFC94D) : Colors.white.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 13, color: AppColors.ink900), const SizedBox(width: 3)],
        Text(label, textScaler: TextScaler.noScaling, style: AppType.body(11.5, weight: FontWeight.w700, color: AppColors.ink900)),
      ]),
    );
  }
}

/// One standings row: rank, photo, number + name, and (on "full") votes / score with a bar.
class StandingTile extends StatelessWidget {
  final StandingRow row;
  final Standings standings;
  final int maxVotes;
  final String? placement;
  final VoidCallback? onTap;
  const StandingTile({super.key, required this.row, required this.standings, required this.maxVotes, this.placement, this.onTap});

  @override
  Widget build(BuildContext context) {
    final r = row;
    final full = standings.full && r.votes != null;
    final score = r.finalScore;
    final value = !full ? null : (score != null ? '${score.toStringAsFixed(1)} pts' : '${_n(r.votes!)} · ${r.percentage ?? 0}%');
    final fraction = !full ? 0.0 : (score != null ? score / 100 : (maxVotes == 0 ? 0.0 : r.votes! / maxVotes));
    final top = r.rank == 1;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(children: [
          SizedBox(
            width: 34,
            child: Text(
              r.rank == null ? '–' : '${r.rank}${r.tied ? '=' : ''}',
              textAlign: TextAlign.center,
              style: AppType.heading(20, weight: FontWeight.w800, color: top ? AppColors.brand : AppColors.ink900),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(width: 44, height: 44, child: ContestantPhoto(name: r.name, url: r.photoUrl, radius: 12, initialsSize: 15)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                if (r.displayNumber.isNotEmpty) ...[
                  Text(r.displayNumber, style: AppType.body(13, weight: FontWeight.w600, color: AppColors.ink500)),
                  const SizedBox(width: 6),
                ],
                Expanded(
                  child: Text(r.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.body(15, weight: FontWeight.w600)),
                ),
                if (value != null) ...[
                  const SizedBox(width: 6),
                  Text(value, style: AppType.body(12.5, weight: FontWeight.w500, color: AppColors.ink600)),
                ],
              ]),
              if (placement != null)
                Text(placement!, style: AppType.body(12, weight: FontWeight.w600, color: AppColors.marigoldDark)),
              if (full) ...[
                const SizedBox(height: 6),
                ClipRRect(
                  borderRadius: BorderRadius.circular(99),
                  child: LinearProgressIndicator(
                    value: fraction.clamp(0.0, 1.0),
                    minHeight: 6,
                    color: top ? AppColors.brand : AppColors.ink300,
                    backgroundColor: AppColors.ink100,
                  ),
                ),
              ],
            ]),
          ),
        ]),
      ),
    );
  }

  static String _n(int v) {
    final s = v.toString();
    final b = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 == 0) b.write(',');
      b.write(s[i]);
    }
    return b.toString();
  }
}

/// Compact contest row for the event page's voting card (on a dark background).
class ContestTeaser extends StatelessWidget {
  final Contest contest;
  final VoidCallback onTap;
  const ContestTeaser({super.key, required this.contest, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = contest;
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              width: 56,
              height: 56,
              child: c.coverUrl == null
                  ? const DecoratedBox(
                      decoration: BoxDecoration(gradient: brandGradient),
                      child: Icon(Icons.emoji_events_rounded, color: Colors.white),
                    )
                  : NetImage(url: c.coverUrl, icon: Icons.emoji_events_rounded),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(c.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.body(15, weight: FontWeight.w600, color: Colors.white)),
              const SizedBox(height: 2),
              Wrap(spacing: 8, runSpacing: 2, crossAxisAlignment: WrapCrossAlignment.center, children: [
                ContestStatusBadge(c, onDark: true),
                if (c.currentRound != null)
                  Text(c.currentRound!.name, style: AppType.body(12, color: AppColors.ink300)),
                CountdownText(
                  target: c.countdownTarget,
                  label: (l) => c.isScheduled ? 'Opens in ${countdownText(l)}' : 'Closes in ${countdownText(l)}',
                  style: AppType.body(12, weight: FontWeight.w500, color: AppColors.ink300),
                ),
              ]),
            ]),
          ),
          const Icon(Icons.chevron_right_rounded, color: Colors.white),
        ]),
      ),
    );
  }
}
