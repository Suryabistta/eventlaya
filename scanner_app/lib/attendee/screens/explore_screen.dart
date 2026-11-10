import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/auth_provider.dart';
import '../../ui/ui.dart';
import '../models/public_event.dart';
import '../providers/explore_providers.dart';
import '../widgets/attendee_widgets.dart';
import 'event_detail_screen.dart';

/// Explore: search, "Happening now", category filter and upcoming events.
/// Works signed out (public API).

/// Pill value for events taking applications (film submissions, pageants) rather than selling tickets.
const _openCalls = '__open_calls';
class ExploreScreen extends ConsumerStatefulWidget {
  const ExploreScreen({super.key});

  @override
  ConsumerState<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends ConsumerState<ExploreScreen> {
  final _searchCtrl = TextEditingController();
  Timer? _debounce;
  String _search = '';
  String _when = 'upcoming';
  String _category = '';

  ({String when, String search}) get _query => (when: _when, search: _search);

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onSearchChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      if (mounted && v.trim() != _search) setState(() => _search = v.trim());
    });
  }

  Future<void> _refresh() async {
    ref.invalidate(publicEventsProvider(_query));
    ref.invalidate(eventTypesProvider);
    try {
      await ref.read(publicEventsProvider(_query).future);
    } catch (_) {
      // Shown by the error state.
    }
  }

  void _open(PublicEvent e) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => EventDetailScreen(slug: e.slug, preview: e)));
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(publicEventsProvider(_query));
    final all = async.valueOrNull ?? const <PublicEvent>[];
    // Superadmin's event types; until they load (or offline), the types found in the list
    final types = ref.watch(eventTypesProvider).valueOrNull ??
        [
          for (final c in {for (final e in all) if (e.category != null && e.category != 'other') e.category!})
            EventType(c, EventCategories.label(c)),
        ];
    final filtered = _category.isEmpty
        ? all
        : all.where((e) => _category == _openCalls ? e.isOpenCall : e.category == _category).toList();
    final live = _when == 'upcoming' ? filtered.where((e) => e.isLive).toList() : const <PublicEvent>[];
    final rest = _when == 'upcoming' ? filtered.where((e) => !e.isLive).toList() : filtered;
    final bottomPad = MediaQuery.paddingOf(context).bottom;

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
            edgeOffset: MediaQuery.paddingOf(context).top,
            onRefresh: _refresh,
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              slivers: [
                SliverToBoxAdapter(
                  child: _ExploreHero(
                    gutter: gutter,
                    controller: _searchCtrl,
                    onChanged: _onSearchChanged,
                    onClear: () {
                      _searchCtrl.clear();
                      setState(() => _search = '');
                    },
                  ),
                ),
                padded(SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: SegmentedControl<String>(
                      segments: const [Segment('upcoming', 'Upcoming'), Segment('past', 'Past')],
                      selected: _when,
                      onChanged: (v) => setState(() {
                        _when = v;
                        _category = '';
                      }),
                    ),
                  ),
                )),
                SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: FilterPills<String>(
                        padding: EdgeInsets.symmetric(horizontal: gutter),
                        segments: [
                          const Segment('', 'All'),
                          const Segment(_openCalls, 'Open calls'),
                          for (final t in types) Segment(t.slug, t.name),
                        ],
                        selected: _category,
                        onChanged: (v) => setState(() => _category = v),
                      ),
                    ),
                  ),
                if (async.isLoading && all.isEmpty)
                  padded(SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 20),
                      child: AppShimmer(
                        child: Column(children: [
                          for (var i = 0; i < 3; i++) ...[
                            const ShimmerBox(height: 230, radius: AppRadius.xl),
                            const SizedBox(height: 16),
                          ],
                        ]),
                      ),
                    ),
                  ))
                else if (async.hasError && all.isEmpty)
                  padded(SliverFillRemaining(
                    hasScrollBody: false,
                    child: AsyncErrorView(
                      title: "Couldn't load events",
                      error: async.error!,
                      onRetry: () => ref.invalidate(publicEventsProvider(_query)),
                    ),
                  ))
                else if (filtered.isEmpty)
                  padded(SliverFillRemaining(
                    hasScrollBody: false,
                    child: EmptyState(
                      icon: _search.isNotEmpty ? Icons.search_off_rounded : Icons.event_available_outlined,
                      title: _search.isNotEmpty
                          ? 'No events match "$_search"'
                          : _category.isNotEmpty
                              ? 'No ${_when == 'past' ? 'past' : 'upcoming'} events of this type'
                              : (_when == 'past' ? 'No past events' : 'No upcoming events yet'),
                      message: _search.isNotEmpty
                          ? 'Try another name, place or organizer.'
                          : 'New events show up here as organizers publish them. Pull down to refresh.',
                      actionLabel: _search.isNotEmpty ? 'Clear search' : (_category.isNotEmpty ? 'Show all events' : 'Refresh'),
                      actionIcon: _search.isNotEmpty ? Icons.close_rounded : Icons.refresh_rounded,
                      onAction: () {
                        if (_search.isNotEmpty) {
                          _searchCtrl.clear();
                          setState(() => _search = '');
                        } else if (_category.isNotEmpty) {
                          setState(() => _category = '');
                        } else {
                          _refresh();
                        }
                      },
                    ),
                  ))
                else ...[
                  if (live.isNotEmpty) ...[
                    padded(const SliverToBoxAdapter(
                      child: Padding(
                        padding: EdgeInsets.only(top: 20),
                        child: SectionTitle('Happening now'),
                      ),
                    )),
                    SliverToBoxAdapter(
                      child: SizedBox(
                        height: 170,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          padding: EdgeInsets.symmetric(horizontal: gutter),
                          itemCount: live.length,
                          separatorBuilder: (_, __) => const SizedBox(width: 12),
                          itemBuilder: (_, i) => LiveEventTile(event: live[i], onTap: () => _open(live[i])),
                        ),
                      ),
                    ),
                  ],
                  if (rest.isNotEmpty) ...[
                    padded(SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.only(top: 20),
                        child: SectionTitle(_when == 'past' ? 'Past events' : 'Upcoming'),
                      ),
                    )),
                    padded(SliverList.builder(
                      itemCount: rest.length,
                      itemBuilder: (_, i) => EventCard(event: rest[i], onTap: () => _open(rest[i])),
                    )),
                  ],
                ],
                SliverToBoxAdapter(child: SizedBox(height: bottomPad + 24)),
              ],
            ),
          );
        }),
      ),
    );
  }
}

/// Brand gradient header with greeting and search (matches the organizer home hero).
class _ExploreHero extends ConsumerWidget {
  final double gutter;
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  const _ExploreHero({
    required this.gutter,
    required this.controller,
    required this.onChanged,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final topPad = MediaQuery.paddingOf(context).top;
    final user = ref.watch(authProvider).user;
    final first = (user?.firstName ?? '').trim();
    final white70 = Colors.white.withValues(alpha: 0.78);

    return Container(
      decoration: const BoxDecoration(
        gradient: brandGradient,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(32)),
      ),
      child: Stack(
        children: [
          Positioned(
            top: -60,
            right: -40,
            child: _Glow(size: 200, color: AppColors.marigold.withValues(alpha: 0.28)),
          ),
          Positioned(
            bottom: -80,
            left: -60,
            child: _Glow(size: 220, color: Colors.white.withValues(alpha: 0.10)),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(gutter + 4, topPad + 16, gutter + 4, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    ClipRRect(borderRadius: BorderRadius.circular(10), child: const LogoMark(size: 34)),
                    const SizedBox(width: 10),
                    Text('Eventlaya', style: AppType.heading(18, color: Colors.white)),
                    const Spacer(),
                    if (user != null)
                      Container(
                        width: 36,
                        height: 36,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.white.withValues(alpha: 0.18),
                          border: Border.all(color: Colors.white.withValues(alpha: 0.35)),
                        ),
                        child: Text(InitialsAvatar.initialsOf(user.fullName),
                            style: AppType.body(13, weight: FontWeight.w600, color: Colors.white)),
                      ),
                  ],
                ),
                const SizedBox(height: 22),
                Text(first.isEmpty ? 'Find your next event' : 'Hi $first, what\'s on?',
                    style: AppType.heading(28, weight: FontWeight.w800, color: Colors.white)),
                const SizedBox(height: 4),
                Text('Concerts, conferences, festivals and more near you.',
                    style: AppType.body(14, color: white70)),
                const SizedBox(height: 18),
                _SearchField(controller: controller, onChanged: onChanged, onClear: onClear),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;
  const _SearchField({required this.controller, required this.onChanged, required this.onClear});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: controller,
      builder: (context, value, _) => TextField(
        controller: controller,
        onChanged: onChanged,
        textInputAction: TextInputAction.search,
        style: AppType.body(15),
        decoration: InputDecoration(
          hintText: 'Search events, places, organizers',
          prefixIcon: const Icon(Icons.search_rounded),
          suffixIcon: value.text.isEmpty
              ? null
              : IconButton(tooltip: 'Clear', icon: const Icon(Icons.close_rounded, size: 20), onPressed: onClear),
          fillColor: Colors.white,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.6), width: 2),
          ),
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
