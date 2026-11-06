import 'package:flutter/material.dart';
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
                padding: EdgeInsets.symmetric(horizontal: gutter),
                child: SegmentedControl<bool>(
                  segments: const [Segment(false, 'Vendors'), Segment(true, 'Venues')],
                  selected: _venues,
                  onChanged: (v) => setState(() => _venues = v),
                ),
              ),
              const SizedBox(height: 12),
              _venues ? _typePills(gutter) : _categoryPills(gutter),
              const SizedBox(height: 16),
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

  Widget _categoryPills(double gutter) {
    final cats = ref.watch(vendorCategoriesProvider).valueOrNull ?? const <VendorCategory>[];
    if (cats.isEmpty) return const SizedBox.shrink();
    return FilterPills<String>(
      padding: EdgeInsets.symmetric(horizontal: gutter),
      segments: [
        const Segment('', 'All'),
        for (final c in cats) Segment(c.slug, c.name, count: c.vendorsCount > 0 ? c.vendorsCount : null),
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
        for (final e in Venue.types.entries) Segment(e.key, e.value),
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
    return SliverList.builder(
      itemCount: list.length,
      itemBuilder: (context, i) {
        final v = list[i];
        return MarketCard(
          imageUrl: v.images.firstOrNull,
          icon: Icons.storefront_rounded,
          title: v.businessName,
          subtitle: [if (v.categoryName.isNotEmpty) v.categoryName, if (v.city.isNotEmpty) v.city].join(' · '),
          rating: v.rating,
          reviews: v.reviewTotal,
          price: v.startingPrice > 0 ? 'From ${formatRupees(v.startingPrice)}' : null,
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
    return SliverList.builder(
      itemCount: list.length,
      itemBuilder: (context, i) {
        final v = list[i];
        return MarketCard(
          imageUrl: v.images.firstOrNull,
          icon: Icons.location_city_rounded,
          title: v.name,
          subtitle: [if (v.typeLabel.isNotEmpty) v.typeLabel, if (v.city.isNotEmpty) v.city].join(' · '),
          detail: v.capacityLabel.isEmpty ? null : v.capacityLabel,
          rating: v.rating,
          reviews: v.reviewCount,
          price: v.priceFrom > 0 ? 'From ${formatRupees(v.priceFrom)}/day' : null,
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

/// Horizontal card for vendors and venues.
class MarketCard extends StatelessWidget {
  final String? imageUrl;
  final IconData icon;
  final String title;
  final String subtitle;
  final String? detail;
  final double? rating;
  final int reviews;
  final String? price;
  final bool verified;
  final bool featured;
  final VoidCallback onTap;

  const MarketCard({
    super.key,
    required this.imageUrl,
    required this.icon,
    required this.title,
    required this.subtitle,
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
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg + 2),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadius.lg + 2),
              border: Border.all(color: AppColors.ink200.withValues(alpha: 0.7), width: 0.5),
            ),
            padding: const EdgeInsets.all(10),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(AppRadius.md),
                child: SizedBox(width: 92, height: 92, child: NetImage(url: imageUrl, icon: icon)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Flexible(
                      child: Text(title, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.heading(16.5)),
                    ),
                    if (verified) ...[
                      const SizedBox(width: 4),
                      const Icon(Icons.verified_rounded, size: 16, color: AppColors.success),
                    ],
                  ]),
                  if (subtitle.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.rowSubtitle),
                  ],
                  if (detail != null)
                    Text(detail!, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.caption),
                  const SizedBox(height: 8),
                  Row(children: [
                    if (rating != null && rating! > 0) ...[
                      RatingLabel(rating: rating!, reviews: reviews),
                      const SizedBox(width: 10),
                    ],
                    if (featured) const StatusBadge('Featured', tone: Tone.warning, dot: false),
                    const Spacer(),
                    if (price != null)
                      Flexible(
                        child: Text(price!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppType.body(13, weight: FontWeight.w600)),
                      ),
                  ]),
                ]),
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
