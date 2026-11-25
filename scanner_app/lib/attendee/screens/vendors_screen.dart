import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/ticket_type_model.dart';
import '../../ui/ui.dart';
import '../models/marketplace.dart';
import '../providers/marketplace_providers.dart';
import '../widgets/attendee_widgets.dart';
import 'vendor_detail_screen.dart';
import 'venue_detail_screen.dart';

/// Marketplace browsing: vendors (by category) and venues (by type).
class VendorsScreen extends ConsumerStatefulWidget {
  const VendorsScreen({super.key});

  @override
  ConsumerState<VendorsScreen> createState() => _VendorsScreenState();
}

class _VendorsScreenState extends ConsumerState<VendorsScreen> {
  bool _venues = false;
  String _category = '';
  String _type = '';
  String _search = '';
  String _city = '';
  bool _cheapFirst = false;

  /// Cities of the loaded vendors or venues, for the city picker.
  List<String> get _cities {
    final cities = _venues
        ? [for (final v in ref.read(venuesProvider(_type)).valueOrNull ?? const <Venue>[]) v.city]
        : [for (final v in ref.read(vendorsProvider(_category)).valueOrNull ?? const <Vendor>[]) v.city];
    return {for (final c in cities) if (c.trim().isNotEmpty) c.trim()}.toList()..sort();
  }

  static String _cityOf(Object v) => (v is Vendor ? v.city : (v as Venue).city).trim();

  Future<void> _pickCity() async {
    final cities = _cities;
    final picked = await showAppSheet<String>(
      context,
      builder: (ctx) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Text('City', style: AppType.heading(19)),
        ),
        for (final c in ['', ...cities])
          ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 4),
            leading: Icon(c.isEmpty ? Icons.public_rounded : Icons.place_outlined, color: AppColors.brand),
            title: Text(c.isEmpty ? 'All cities' : c, style: AppType.body(15, weight: FontWeight.w500)),
            trailing: c == _city ? const Icon(Icons.check_rounded, color: AppColors.brand) : null,
            onTap: () => Navigator.of(ctx).pop(c),
          ),
      ]),
    );
    if (picked != null && mounted) setState(() => _city = picked);
  }

  Widget _filterBar(double gutter) {
    Widget chip(IconData icon, String label, bool on, VoidCallback onTap, {bool menu = false}) => Material(
          color: on ? AppColors.brandTint : AppColors.surface,
          shape: StadiumBorder(side: BorderSide(color: on ? AppColors.brand : AppColors.ink200)),
          child: InkWell(
            customBorder: const StadiumBorder(),
            onTap: () {
              HapticFeedback.selectionClick();
              onTap();
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(icon, size: 16, color: on ? AppColors.brand : AppColors.ink700),
                const SizedBox(width: 6),
                Text(label, style: AppType.body(13, weight: FontWeight.w600, color: on ? AppColors.brand : AppColors.ink700)),
                if (menu) Icon(Icons.expand_more_rounded, size: 18, color: on ? AppColors.brand : AppColors.ink700),
              ]),
            ),
          ),
        );
    return Padding(
      padding: EdgeInsets.fromLTRB(gutter, 2, gutter, 4),
      child: Row(children: [
        chip(Icons.place_outlined, _city.isEmpty ? 'All cities' : _city, _city.isNotEmpty, _pickCity, menu: true),
        const SizedBox(width: 8),
        chip(Icons.sell_outlined, 'Lowest price', _cheapFirst, () => setState(() => _cheapFirst = !_cheapFirst)),
      ]),
    );
  }
  final _searchCtrl = TextEditingController();

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      if (_venues) {
        ref.invalidate(venuesProvider(_type));
        await ref.read(venuesProvider(_type).future);
      } else {
        ref.invalidate(vendorCategoriesProvider);
        ref.invalidate(vendorsProvider(_category));
        await ref.read(vendorsProvider(_category).future);
      }
    } catch (_) {
      // Shown by the error state.
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Vendors',
      onRefresh: _refresh,
      padded: false,
      slivers: [
        SliverLayoutBuilder(builder: (context, c) {
          final gutter = AppScaffold.gutterFor(c.crossAxisExtent);
          return SliverToBoxAdapter(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Padding(
                padding: EdgeInsets.fromLTRB(gutter, 0, gutter, 12),
                child: AppSearchField(
                  controller: _searchCtrl,
                  hint: _venues ? 'Search venues, cities…' : 'Search vendors, services, cities…',
                  onChanged: (v) => setState(() => _search = v),
                ),
              ),
              Padding(
                padding: EdgeInsets.symmetric(horizontal: gutter),
                child: SegmentedControl<bool>(
                  segments: const [Segment(false, 'Vendors'), Segment(true, 'Venues')],
                  selected: _venues,
                  onChanged: (v) => setState(() => _venues = v),
                ),
              ),
              const SizedBox(height: 6),
              _venues ? _typePills(gutter) : _categoryPills(gutter),
              _filterBar(gutter),
              const SizedBox(height: 10),
            ]),
          );
        }),
        SliverLayoutBuilder(builder: (context, c) {
          final gutter = AppScaffold.gutterFor(c.crossAxisExtent);
          return SliverPadding(
            padding: EdgeInsets.symmetric(horizontal: gutter),
            sliver: _venues ? _venueList() : _vendorList(),
          );
        }),
      ],
    );
  }

  List<T> _match<T>(List<T> list, String Function(T) text) {
    final q = _search.trim().toLowerCase();
    var out = [
      for (final v in list)
        if ((q.isEmpty || text(v).toLowerCase().contains(q)) &&
            (_city.isEmpty || _cityOf(v as Object) == _city))
          v,
    ];
    if (_cheapFirst) {
      // Listings without a public price go last
      double price(T v) {
        final p = v is Vendor ? (v.hidePrice ? 0.0 : v.startingPrice) : (v as Venue).priceFrom;
        return p > 0 ? p : double.infinity;
      }
      out.sort((a, b) => price(a).compareTo(price(b)));
    }
    return out;
  }

  Widget _noMatch() => SliverToBoxAdapter(
        child: EmptyState(
          icon: Icons.search_off_rounded,
          title: _search.trim().isEmpty ? 'Nothing in $_city yet' : 'Nothing matches "${_search.trim()}"',
          message: 'Try another name, category or city.',
          actionLabel: 'Clear filters',
          actionIcon: Icons.close_rounded,
          onAction: () {
            _searchCtrl.clear();
            setState(() {
              _search = '';
              _city = '';
            });
          },
        ),
      );

  /// Two columns on phones, more on wider screens.
  Widget _grid({required int itemCount, required NullableIndexedWidgetBuilder itemBuilder}) {
    return SliverGrid.builder(
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 240,
        mainAxisExtent: MarketCard.extent,
        crossAxisSpacing: 12,
        mainAxisSpacing: 14,
      ),
      itemCount: itemCount,
      itemBuilder: itemBuilder,
    );
  }

  Widget _categoryPills(double gutter) {
    final cats = ref.watch(vendorCategoriesProvider).valueOrNull ?? const <VendorCategory>[];
    if (cats.isEmpty) return const SizedBox.shrink();
    return FilterPills<String>(
      padding: EdgeInsets.symmetric(horizontal: gutter),
      segments: [
        const Segment('', 'All'),
        for (final c in cats)
          if (c.vendorsCount > 0) Segment(c.slug, c.name, icon: vendorCategoryIcon(c.name)),
      ],
      selected: _category,
      onChanged: (v) => setState(() => _category = v),
    );
  }

  Widget _typePills(double gutter) {
    return FilterPills<String>(
      padding: EdgeInsets.symmetric(horizontal: gutter),
      segments: [
        const Segment('', 'All'),
        for (final e in Venue.types.entries) Segment(e.key, e.value, icon: Icons.location_city_rounded),
      ],
      selected: _type,
      onChanged: (v) => setState(() => _type = v),
    );
  }

  Widget _vendorList() {
    final async = ref.watch(vendorsProvider(_category));
    final list = async.valueOrNull;
    if (list == null) {
      return SliverToBoxAdapter(
        child: async.hasError
            ? AsyncErrorView(
                title: "Couldn't load vendors",
                error: async.error!,
                onRetry: () => ref.invalidate(vendorsProvider(_category)),
              )
            : const LoadingList(rows: 4),
      );
    }
    if (list.isEmpty) {
      return SliverToBoxAdapter(
        child: EmptyState(
          icon: Icons.storefront_outlined,
          title: _category.isEmpty ? 'No vendors yet' : 'No vendors in this category',
          message: 'Sound, photo, decoration and catering businesses show up here once they are listed.',
          actionLabel: _category.isEmpty ? null : 'Show all',
          onAction: _category.isEmpty ? null : () => setState(() => _category = ''),
        ),
      );
    }
    final shown = _match(list, (v) => '${v.businessName} ${v.categoryName} ${v.city}');
    if (shown.isEmpty) return _noMatch();
    return _grid(
      itemCount: shown.length,
      itemBuilder: (context, i) {
        final v = shown[i];
        return MarketCard(
          imageUrl: v.images.firstOrNull,
          icon: Icons.storefront_rounded,
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
        );
      },
    );
  }

  Widget _venueList() {
    final async = ref.watch(venuesProvider(_type));
    final list = async.valueOrNull;
    if (list == null) {
      return SliverToBoxAdapter(
        child: async.hasError
            ? AsyncErrorView(
                title: "Couldn't load venues",
                error: async.error!,
                onRetry: () => ref.invalidate(venuesProvider(_type)),
              )
            : const LoadingList(rows: 4),
      );
    }
    if (list.isEmpty) {
      return SliverToBoxAdapter(
        child: EmptyState(
          icon: Icons.location_city_outlined,
          title: _type.isEmpty ? 'No venues yet' : 'No venues of this type',
          message: 'Party palaces, halls and resorts show up here once they are listed.',
          actionLabel: _type.isEmpty ? null : 'Show all',
          onAction: _type.isEmpty ? null : () => setState(() => _type = ''),
        ),
      );
    }
    final shown = _match(list, (v) => '${v.name} ${v.typeLabel} ${v.city}');
    if (shown.isEmpty) return _noMatch();
    return _grid(
      itemCount: shown.length,
      itemBuilder: (context, i) {
        final v = shown[i];
        return MarketCard(
          imageUrl: v.images.firstOrNull,
          icon: Icons.location_city_rounded,
          title: v.name,
          subtitle: v.typeLabel,
          city: v.city,
          detail: v.capacityLabel.isEmpty ? null : v.capacityLabel,
          rating: v.rating,
          reviews: v.reviewCount,
          price: v.priceFrom > 0 ? '${formatRupees(v.priceFrom)}/day' : null,
          verified: v.isVerified,
          featured: v.isFeatured,
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => VenueDetailScreen(id: v.id, preview: v)),
          ),
        );
      },
    );
  }
}

/// Vertical card for vendors and venues: photo, name, category, city, rating, price and a "View" button.
class MarketCard extends StatelessWidget {
  final String? imageUrl;
  final IconData icon;
  final String title;
  final String subtitle;
  final String city;
  final String? detail;
  final double? rating;
  final int reviews;
  final String? price;
  final bool verified;
  final bool featured;
  final VoidCallback onTap;

  /// Height the card needs in a grid.
  static const double extent = 268;

  const MarketCard({
    super.key,
    required this.imageUrl,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.city = '',
    this.detail,
    this.rating,
    this.reviews = 0,
    this.price,
    this.verified = false,
    this.featured = false,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(AppRadius.lg + 2), boxShadow: softShadow),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg + 2),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(6),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SizedBox(
                height: 118,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  child: Stack(fit: StackFit.expand, children: [
                    NetImage(url: imageUrl, icon: icon),
                    if (featured) const Positioned(left: 6, top: 6, child: FeaturedBadge()),
                  ]),
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(6, 10, 6, 4),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Flexible(
                        child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.heading(15.5)),
                      ),
                      if (verified) ...[
                        const SizedBox(width: 4),
                        const Icon(Icons.verified_rounded, size: 15, color: AppColors.verified),
                      ],
                    ]),
                    if (subtitle.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.caption),
                    ],
                    if (detail != null)
                      Text(detail!, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.caption),
                    const SizedBox(height: 4),
                    Row(children: [
                      if (city.isNotEmpty)
                        Expanded(child: IconLine(icon: Icons.place_outlined, text: city))
                      else
                        const Spacer(),
                      if (rating != null && rating! > 0) RatingLabel(rating: rating!, reviews: reviews),
                    ]),
                    const Spacer(),
                    Text(price ?? 'Ask for price',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppType.body(13,
                            weight: FontWeight.w700, color: price == null ? AppColors.ink500 : AppColors.brand)),
                    const SizedBox(height: 6),
                    SizedBox(
                      width: double.infinity,
                      child: PillButton(label: 'View details', onPressed: onTap, dense: true),
                    ),
                  ]),
                ),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

/// "★ 4.8 (12)" — the average of real reviews (the server falls back to a
/// platform-set rating for listings without reviews).
class RatingLabel extends StatelessWidget {
  final double rating;
  final int reviews;
  const RatingLabel({super.key, required this.rating, this.reviews = 0});

  @override
  Widget build(BuildContext context) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.star_rounded, size: 16, color: AppColors.marigold),
      const SizedBox(width: 2),
      Text(rating.toStringAsFixed(1), style: AppType.body(13, weight: FontWeight.w600)),
      if (reviews > 0) Text(' ($reviews)', style: AppType.caption),
    ]);
  }
}
