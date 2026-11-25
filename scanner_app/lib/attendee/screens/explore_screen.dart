import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/auth_provider.dart';
import '../../models/ticket_type_model.dart' show formatRupees;
import '../../providers/modules_provider.dart';
import '../models/marketplace.dart';
import '../attendee_shell.dart';
import '../data/favourites.dart';
import '../providers/marketplace_providers.dart';
import 'vendor_detail_screen.dart';
import 'vendors_screen.dart' show MarketCard;
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
  /// Quick filter: '' · 'today' · 'weekend' · 'free'
  String _quick = '';
  bool _byPrice = false;

  List<PublicEvent> _applyQuick(List<PublicEvent> list) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    var out = switch (_quick) {
      'today' => list.where((e) => e.isLive || e.runsBetween(today, today)).toList(),
      'weekend' => () {
          // The coming Friday–Sunday (or the rest of it, during a weekend)
          final fri = today.weekday == DateTime.saturday || today.weekday == DateTime.sunday
              ? today
              : today.add(Duration(days: (DateTime.friday - today.weekday) % 7));
          final sun = fri.add(Duration(days: (DateTime.sunday - fri.weekday) % 7));
          return list.where((e) => e.runsBetween(fri, sun)).toList();
        }(),
      'free' => list.where((e) => e.lowestPrice == 0).toList(),
      _ => list,
    };
    if (_byPrice) out = [...out]..sort((a, b) => a.lowestPrice.compareTo(b.lowestPrice));
    return out;
  }

  final _listKey = GlobalKey();

  void _scrollToList() {
    final ctx = _listKey.currentContext;
    if (ctx != null) {
      Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 450), curve: Curves.easeOutCubic);
    }
  }

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
    final filtered = _applyQuick(_category.isEmpty
        ? all
        : all.where((e) => _category == _openCalls ? e.isOpenCall : e.category == _category).toList());
    final live = _when == 'upcoming' ? filtered.where((e) => e.isLive).toList() : const <PublicEvent>[];
    final rest = _when == 'upcoming' ? filtered.where((e) => !e.isLive).toList() : filtered;
    final bottomPad = MediaQuery.paddingOf(context).bottom;
    // The home extras (carousel, shortcuts, vendors) show while browsing, not while searching or filtering.
    final showHome = _search.isEmpty && _category.isEmpty && _quick.isEmpty && _when == 'upcoming';
    final featured = all.where((e) => e.isFeatured && !e.isFull).take(6).toList();

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent),
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
                  child: _ExploreHeader(
                    gutter: gutter,
                    controller: _searchCtrl,
                    onChanged: _onSearchChanged,
                    onClear: () => setState(() => _search = ''),
                  ),
                ),
                SliverToBoxAdapter(
                  child: FilterPills<String>(
                    padding: EdgeInsets.symmetric(horizontal: gutter),
                    segments: [
                      const Segment('', 'All'),
                      const Segment(_openCalls, 'Open calls', icon: Icons.campaign_rounded),
                      for (final t in types) Segment(t.slug, t.name, icon: categoryIcon('${t.slug} ${t.name}')),
                    ],
                    selected: _category,
                    onChanged: (v) => setState(() => _category = v),
                  ),
                ),
                if (showHome && featured.isNotEmpty) ...[
                  padded(SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 14),
                      child: SectionTitle('Featured events',
                          trailing: SeeAllButton(onPressed: () => _scrollToList())),
                    ),
                  )),
                  SliverToBoxAdapter(child: _FeaturedCarousel(events: featured, gutter: gutter, onOpen: _open)),
                ],
                if (showHome)
                  padded(SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 18),
                      child: _QuickActions(onEvents: _scrollToList),
                    ),
                  )),
                if (showHome) SliverToBoxAdapter(child: _TrustedVendors(gutter: gutter)),
                padded(SliverToBoxAdapter(
                  key: _listKey,
                  child: Padding(
                    padding: const EdgeInsets.only(top: 18),
                    child: SegmentedControl<String>(
                      segments: const [Segment('upcoming', 'Upcoming'), Segment('past', 'Past')],
                      selected: _when,
                      onChanged: (v) => setState(() {
                        _when = v;
                        _category = '';
                        _quick = '';
                      }),
                    ),
                  ),
                )),
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(children: [
                      Expanded(
                        child: FilterPills<String>(
                          padding: EdgeInsets.only(left: gutter),
                          segments: [
                            const Segment('', 'Any time'),
                            if (_when == 'upcoming') ...const [
                              Segment('today', 'Today', icon: Icons.today_rounded),
                              Segment('weekend', 'This weekend', icon: Icons.weekend_rounded),
                            ],
                            const Segment('free', 'Free', icon: Icons.money_off_rounded),
                          ],
                          selected: _quick,
                          onChanged: (v) {
                            HapticFeedback.selectionClick();
                            setState(() => _quick = v);
                          },
                        ),
                      ),
                      Padding(
                        padding: EdgeInsets.only(left: 4, right: gutter - 8),
                        child: IconButton(
                          tooltip: _byPrice ? 'Sorted by price · tap for date' : 'Sorted by date · tap for price',
                          onPressed: () {
                            HapticFeedback.selectionClick();
                            setState(() => _byPrice = !_byPrice);
                          },
                          icon: Icon(_byPrice ? Icons.sell_outlined : Icons.schedule_rounded,
                              color: _byPrice ? AppColors.brand : AppColors.ink600),
                        ),
                      ),
                    ]),
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
                          : _quick.isNotEmpty
                              ? (_quick == 'today' ? 'Nothing on today' : _quick == 'weekend' ? 'Nothing on this weekend' : 'No free events right now')
                          : _category.isNotEmpty
                              ? 'No ${_when == 'past' ? 'past' : 'upcoming'} events of this type'
                              : (_when == 'past' ? 'No past events' : 'No upcoming events yet'),
                      message: _search.isNotEmpty
                          ? 'Try another name, place or organizer.'
                          : 'New events show up here as organizers publish them. Pull down to refresh.',
                      actionLabel: _search.isNotEmpty
                          ? 'Clear search'
                          : (_category.isNotEmpty || _quick.isNotEmpty ? 'Show all events' : 'Refresh'),
                      actionIcon: _search.isNotEmpty ? Icons.close_rounded : Icons.refresh_rounded,
                      onAction: () {
                        if (_search.isNotEmpty) {
                          _searchCtrl.clear();
                          setState(() => _search = '');
                        } else if (_category.isNotEmpty || _quick.isNotEmpty) {
                          setState(() {
                            _category = '';
                            _quick = '';
                          });
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

/// Index of a shell tab, given which optional tabs are on (see [AttendeeShell]).
int _tabIndex(WidgetRef ref, String tab) {
  final voting = ref.read(moduleEnabledProvider(AppModule.contests));
  final market = ref.read(moduleEnabledProvider(AppModule.marketplace));
  return switch (tab) {
    'voting' => 3,
    'vendors' => voting ? 4 : 3,
    _ => 3 + (voting ? 1 : 0) + (market ? 1 : 0), // profile
  };
}

String _greeting() {
  final h = DateTime.now().hour;
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/// White header: logo, greeting, avatar and search.
class _ExploreHeader extends ConsumerWidget {
  final double gutter;
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  const _ExploreHeader({
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

    return Stack(children: [
      Positioned(top: -90, right: -70, child: _Glow(size: 240, color: AppColors.brand.withValues(alpha: 0.10))),
      Padding(
        padding: EdgeInsets.fromLTRB(gutter, topPad + 14, gutter, 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            ClipRRect(borderRadius: BorderRadius.circular(12), child: const LogoMark(size: 42)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text.rich(
                  TextSpan(children: [
                    TextSpan(text: 'Event', style: AppType.heading(24, weight: FontWeight.w800)),
                    TextSpan(text: 'laya', style: AppType.heading(24, weight: FontWeight.w800, color: AppColors.brand)),
                  ]),
                ),
                const SizedBox(height: 2),
                Text(first.isEmpty ? '${_greeting()} 👋' : '${_greeting()}, $first 👋',
                    maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.body(14, color: AppColors.ink600)),
              ]),
            ),
            Semantics(
              button: true,
              label: user == null ? 'Sign in' : 'Profile',
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: () => AttendeeShell.goTo(context, _tabIndex(ref, 'profile')),
                child: Container(
                  width: 46,
                  height: 46,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: user == null ? AppColors.surface : AppColors.brandTint,
                    border: Border.all(color: Colors.white, width: 2),
                    boxShadow: softShadow,
                  ),
                  child: user == null
                      ? const Icon(Icons.person_outline_rounded, color: AppColors.ink700)
                      : Text(InitialsAvatar.initialsOf(user.fullName),
                          style: AppType.body(15, weight: FontWeight.w700, color: AppColors.brand)),
                ),
              ),
            ),
          ]),
          const SizedBox(height: 18),
          AppSearchField(
            controller: controller,
            onChanged: onChanged,
            onClear: onClear,
            hint: 'Search events, places, organizers…',
          ),
        ]),
      ),
    ]);
  }
}

/// Auto-advancing carousel of featured events with page dots.
class _FeaturedCarousel extends StatefulWidget {
  final List<PublicEvent> events;
  final double gutter;
  final ValueChanged<PublicEvent> onOpen;
  const _FeaturedCarousel({required this.events, required this.gutter, required this.onOpen});

  @override
  State<_FeaturedCarousel> createState() => _FeaturedCarouselState();
}

class _FeaturedCarouselState extends State<_FeaturedCarousel> {
  late final PageController _ctrl = PageController(viewportFraction: 1);
  Timer? _timer;
  int _page = 0;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!mounted || !_ctrl.hasClients || widget.events.length < 2) return;
      final next = (_page + 1) % widget.events.length;
      _ctrl.animateToPage(next, duration: const Duration(milliseconds: 550), curve: Curves.easeInOutCubic);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final n = widget.events.length;
    return Column(children: [
      SizedBox(
        height: 214,
        child: PageView.builder(
          controller: _ctrl,
          itemCount: n,
          onPageChanged: (i) => setState(() => _page = i),
          itemBuilder: (_, i) => Padding(
            padding: EdgeInsets.fromLTRB(widget.gutter, 4, widget.gutter, 14),
            child: FeaturedEventCard(event: widget.events[i], onTap: () => widget.onOpen(widget.events[i])),
          ),
        ),
      ),
      if (n > 1)
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          for (var i = 0; i < n; i++)
            AnimatedContainer(
              duration: const Duration(milliseconds: 250),
              margin: const EdgeInsets.symmetric(horizontal: 3),
              width: i == _page ? 22 : 8,
              height: 8,
              decoration: BoxDecoration(
                color: i == _page ? AppColors.brand : AppColors.ink300,
                borderRadius: BorderRadius.circular(99),
              ),
            ),
        ]),
    ]);
  }
}

/// Shortcut tiles: Events · Tickets · Voting · Saved / Marketplace (only modules that are on).
class _QuickActions extends ConsumerWidget {
  final VoidCallback onEvents;
  const _QuickActions({required this.onEvents});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final voting = ref.watch(moduleEnabledProvider(AppModule.contests));
    final market = ref.watch(moduleEnabledProvider(AppModule.marketplace));
    final saved = ref.watch(moduleEnabledProvider(AppModule.favourites));
    final tiles = <(IconData, String, VoidCallback)>[
      (Icons.event_note_rounded, 'Events', onEvents),
      (Icons.confirmation_number_outlined, 'Tickets', () => AttendeeShell.goTo(context, AttendeeShell.ticketsTab)),
      if (voting) (Icons.how_to_vote_outlined, 'Voting', () => AttendeeShell.goTo(context, _tabIndex(ref, 'voting'))),
      if (saved)
        (
          Icons.favorite_border_rounded,
          'Saved',
          () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SavedEventsScreen())),
        )
      else if (market)
        (Icons.storefront_outlined, 'Vendors', () => AttendeeShell.goTo(context, _tabIndex(ref, 'vendors'))),
    ];
    return Row(children: [
      for (var i = 0; i < tiles.length; i++) ...[
        if (i > 0) const SizedBox(width: 10),
        Expanded(child: _QuickTile(icon: tiles[i].$1, label: tiles[i].$2, onTap: tiles[i].$3)),
      ],
    ]);
  }
}

class _QuickTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _QuickTile({required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(AppRadius.lg), boxShadow: softShadow),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 4),
            child: Column(children: [
              Container(
                width: 42,
                height: 42,
                decoration: const BoxDecoration(color: AppColors.brandTint, shape: BoxShape.circle),
                child: Icon(icon, color: AppColors.brand, size: 22),
              ),
              const SizedBox(height: 8),
              Text(label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.body(12.5, weight: FontWeight.w600, color: AppColors.ink800)),
            ]),
          ),
        ),
      ),
    );
  }
}

/// "Our trusted vendors": verified / featured marketplace vendors (hidden when the module is off or none).
class _TrustedVendors extends ConsumerWidget {
  final double gutter;
  const _TrustedVendors({required this.gutter});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(moduleEnabledProvider(AppModule.marketplace))) return const SizedBox.shrink();
    final all = ref.watch(vendorsProvider('')).valueOrNull ?? const [];
    if (all.isEmpty) return const SizedBox.shrink();
    int score(Vendor v) => (v.isFeatured ? 2 : 0) + (v.isVerified ? 1 : 0);
    final list = [...all]..sort((a, b) => score(b).compareTo(score(a)));
    final shown = list.take(8).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(
        padding: EdgeInsets.fromLTRB(gutter, 18, gutter, 0),
        child: SectionTitle('Our trusted vendors',
            trailing: SeeAllButton(onPressed: () => AttendeeShell.goTo(context, _tabIndex(ref, 'vendors')))),
      ),
      SizedBox(
        height: MarketCard.extent + 16,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: EdgeInsets.fromLTRB(gutter, 0, gutter, 16),
          clipBehavior: Clip.none,
          itemCount: shown.length,
          separatorBuilder: (_, __) => const SizedBox(width: 12),
          itemBuilder: (context, i) {
            final v = shown[i];
            return SizedBox(
              width: 176,
              child: MarketCard(
                imageUrl: v.images.firstOrNull,
                icon: vendorCategoryIcon(v.categoryName),
                title: v.businessName,
                subtitle: v.categoryName,
                city: v.city,
                rating: v.rating,
                reviews: v.reviewTotal,
                price: v.startingPrice > 0 && !v.hidePrice ? 'From ${formatRupees(v.startingPrice)}' : null,
                verified: v.isVerified,
                featured: v.isFeatured,
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => VendorDetailScreen(id: v.id, preview: v)),
                ),
              ),
            );
          },
        ),
      ),
    ]);
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
