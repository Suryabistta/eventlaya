import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../ui/ui.dart';
import '../data/contest_api.dart' show ContestFailure;
import '../models/contest_card.dart';
import '../providers/contest_providers.dart';
import '../widgets/attendee_widgets.dart' show AsyncErrorView;
import '../widgets/stage.dart';
import 'contest_screen.dart';

/// Voting tab: every live, upcoming and past contest (pageants, talent shows…), like the website's /voting page.
/// Shown only while the superadmin has the contests module on.
final publicContestsProvider =
    FutureProvider.autoDispose.family<ContestList, ({String when, String search, String city})>((ref, q) {
  return ref.watch(contestApiProvider).publicContests(when: q.when, search: q.search, city: q.city);
});

class VotingScreen extends ConsumerStatefulWidget {
  const VotingScreen({super.key});

  @override
  ConsumerState<VotingScreen> createState() => _VotingScreenState();
}

class _VotingScreenState extends ConsumerState<VotingScreen> {
  final _searchCtrl = TextEditingController();
  Timer? _debounce;
  String _when = 'live';
  String _search = '';
  String _city = '';
  String _type = '';

  ({String when, String search, String city}) get _q => (when: _when, search: _search, city: _city);

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    ref.invalidate(publicContestsProvider(_q));
    try {
      await ref.read(publicContestsProvider(_q).future);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(publicContestsProvider(_q));
    final data = async.valueOrNull;
    final all = data?.results ?? const <ContestCard>[];
    final types = {for (final c in all) if (c.categoryLabel.isNotEmpty) c.categoryLabel}.toList();
    final list = _type.isEmpty ? all : all.where((c) => c.categoryLabel == _type).toList();
    final cities = data?.cities ?? const <String>[];
    int count(String k) => data?.counts[k] ?? 0;

    return AppScaffold(
      title: 'Voting',
      automaticBack: false,
      onRefresh: _refresh,
      slivers: [
        SliverToBoxAdapter(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Vote for your favourite contestants.', style: TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 12),
            SegmentedControl<String>(
              segments: [Segment('live', 'Live', count: count('live')), Segment('upcoming', 'Upcoming', count: count('upcoming')), Segment('past', 'Past', count: count('past'))],
              selected: _when,
              onChanged: (v) => setState(() {
                _when = v;
                _type = '';
              }),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _searchCtrl,
              textInputAction: TextInputAction.search,
              decoration: const InputDecoration(hintText: 'Search contests or contestants', prefixIcon: Icon(Icons.search_rounded)),
              onChanged: (v) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 400), () {
                  if (mounted && v.trim() != _search) setState(() => _search = v.trim());
                });
              },
            ),
            if (cities.length > 1) ...[
              const SizedBox(height: 12),
              FilterPills<String>(
                padding: EdgeInsets.zero,
                segments: [const Segment('', 'All cities'), for (final c in cities) Segment(c, c)],
                selected: _city,
                onChanged: (v) => setState(() => _city = v),
              ),
            ],
            if (types.length > 1) ...[
              const SizedBox(height: 8),
              FilterPills<String>(
                padding: EdgeInsets.zero,
                segments: [const Segment('', 'All contests'), for (final t in types) Segment(t, t)],
                selected: _type,
                onChanged: (v) => setState(() => _type = v),
              ),
            ],
            const SizedBox(height: 16),
          ]),
        ),
        if (async.isLoading && data == null)
          const SliverToBoxAdapter(child: AppShimmer(child: Column(children: [ShimmerBox(height: 320, radius: AppRadius.xl), SizedBox(height: 16), ShimmerBox(height: 320, radius: AppRadius.xl)])))
        else if (async.hasError && data == null)
          SliverFillRemaining(hasScrollBody: false, child: AsyncErrorView(title: "Couldn't load contests", error: async.error!, onRetry: _refresh))
        else if (list.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.emoji_events_outlined,
              title: _when == 'live' ? 'No contests open for voting' : _when == 'upcoming' ? 'No upcoming contests' : 'No past contests',
              message: _search.isNotEmpty || _city.isNotEmpty || _type.isNotEmpty ? 'Try another search or filter.' : 'Check back soon. Pull down to refresh.',
            ),
          )
        else
          SliverList.separated(
            itemCount: list.length,
            separatorBuilder: (_, __) => const SizedBox(height: 16),
            itemBuilder: (_, i) => ContestCardTile(card: list[i]),
          ),
        SliverToBoxAdapter(child: SizedBox(height: MediaQuery.paddingOf(context).bottom + 24)),
      ],
    );
  }
}

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

class ContestCardTile extends StatelessWidget {
  final ContestCard card;
  const ContestCardTile({super.key, required this.card});

  void _open(BuildContext context) => Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => ContestScreen(eventSlug: card.eventSlug, contestRef: card.ref),
      ));

  @override
  Widget build(BuildContext context) {
    final c = card;
    final target = c.isLive ? c.closesAt : c.isUpcoming ? c.opensAt : null;
    final day = c.isUpcoming ? c.opensAt : c.closesAt;
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _open(context),
        child: Container(
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(20), border: Border.all(color: AppColors.ink100)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SizedBox(
              height: 170,
              child: Stack(clipBehavior: Clip.none, children: [
                Positioned.fill(child: ContestCover(url: c.coverUrl, seed: c.id)),
                if (c.categoryLabel.isNotEmpty)
                  Positioned(left: 12, top: 12, child: _chip(c.categoryLabel, Colors.black.withValues(alpha: .45), Colors.white)),
                Positioned(
                  right: 12, top: 12,
                  child: _chip(c.isLive ? '● LIVE' : c.isUpcoming ? 'Opens soon' : 'Voting ended', c.isLive ? AppColors.brand : Colors.white, c.isLive ? Colors.white : AppColors.ink800),
                ),
                if (day != null)
                  Positioned(
                    left: 16, bottom: -18,
                    child: Container(
                      width: 48,
                      clipBehavior: Clip.antiAlias,
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10), border: Border.all(color: AppColors.ink100),
                          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: .08), blurRadius: 6)]),
                      child: Column(children: [
                        Container(width: double.infinity, color: AppColors.brand, padding: const EdgeInsets.symmetric(vertical: 2),
                            child: Text(_months[day.month - 1], textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w700))),
                        Text(day.day.toString().padLeft(2, '0'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                        Padding(padding: const EdgeInsets.only(bottom: 2), child: Text(_days[day.weekday - 1], style: const TextStyle(fontSize: 10, color: AppColors.textSecondary))),
                      ]),
                    ),
                  ),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 28, 16, 16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (c.organizerName.isNotEmpty) Text(c.organizerName, style: const TextStyle(color: AppColors.brand, fontSize: 13)),
                Text(c.title, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
                const SizedBox(height: 8),
                _line(Icons.people_outline_rounded, '${c.contestants} ${c.contestants == 1 ? 'contestant' : 'contestants'}'),
                if (c.isUpcoming || c.totalVotes != null) ...[
                  const SizedBox(height: 4),
                  _line(Icons.how_to_vote_outlined, c.isUpcoming ? 'Voting not started' : '${_fmt(c.totalVotes!)} votes'),
                ],
                if (target != null && target.isAfter(DateTime.now())) ...[
                  const SizedBox(height: 12),
                  Text(c.isLive ? 'VOTING ENDS IN' : 'VOTING OPENS IN',
                      style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, letterSpacing: .8, color: AppColors.textTertiary)),
                  const SizedBox(height: 6),
                  CountdownBoxes(target: target),
                ],
                const SizedBox(height: 14),
                if (c.isUpcoming) ...[
                  PrimaryButton(label: 'Notify me', icon: Icons.notifications_active_outlined, tonal: true, onPressed: () => _notify(context)),
                  const SizedBox(height: 8),
                ],
                PrimaryButton(
                  label: c.isLive ? 'Vote now' : c.isUpcoming ? 'See contestants' : 'Voting closed · View results',
                  icon: c.isLive ? Icons.how_to_vote_rounded : null,
                  tone: c.isLive ? ButtonTone.brand : ButtonTone.neutral,
                  tonal: !c.isLive,
                  onPressed: () => _open(context),
                ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  Future<void> _notify(BuildContext context) async {
    final ctrl = TextEditingController();
    await showAppSheet<void>(context, builder: (ctx) => _NotifySheet(card: card, controller: ctrl));
    ctrl.dispose();
  }

  static String _fmt(int n) => n.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');

  Widget _chip(String text, Color bg, Color fg) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(99)),
        child: Text(text, style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.w700)),
      );

  Widget _line(IconData icon, String text) => Row(children: [
        Icon(icon, size: 16, color: AppColors.brand),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: const TextStyle(color: AppColors.ink600, fontSize: 14))),
      ]);
}

/// Phone or email for one "voting is open" message.
class _NotifySheet extends ConsumerStatefulWidget {
  final ContestCard card;
  final TextEditingController controller;
  const _NotifySheet({required this.card, required this.controller});

  @override
  ConsumerState<_NotifySheet> createState() => _NotifySheetState();
}

class _NotifySheetState extends ConsumerState<_NotifySheet> {
  bool _busy = false;
  String? _error;

  Future<void> _send() async {
    final v = widget.controller.text.trim();
    if (v.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final channel = await ref.read(contestApiProvider).remind(widget.card.eventSlug, widget.card.ref, v);
      if (!mounted) return;
      Navigator.of(context).pop();
      AppToast.success(context, 'We\'ll send one ${channel == 'sms' ? 'SMS' : 'email'} when voting opens');
    } catch (e) {
      setState(() => _error = e is ContestFailure ? e.message : 'Couldn\'t save. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          SheetHeader(title: 'Get a message when voting opens', message: widget.card.title),
          TextField(
            controller: widget.controller,
            autofocus: true,
            keyboardType: TextInputType.emailAddress,
            decoration: InputDecoration(labelText: 'Mobile number or email', hintText: '98XXXXXXXX or you@example.com', errorText: _error),
            onSubmitted: (_) => _send(),
          ),
          const SizedBox(height: 8),
          const Text('Only used for this one message.', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
          const SizedBox(height: 16),
          PrimaryButton(label: 'Notify me', loading: _busy, onPressed: _send),
        ],
      );
}
