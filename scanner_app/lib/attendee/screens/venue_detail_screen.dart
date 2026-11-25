import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/ticket_type_model.dart';
import '../../ui/ui.dart';
import '../../reviews/review_models.dart';
import '../../reviews/review_widgets.dart';
import '../models/marketplace.dart';
import '../providers/marketplace_providers.dart';
import '../widgets/attendee_widgets.dart';
import '../widgets/listing_widgets.dart';
import '../widgets/gallery_header.dart';
import '../widgets/packages_section.dart';
import 'inquiry_screen.dart';

/// Venue page: photos, capacity, spaces, amenities, rules and "Send inquiry".
class VenueDetailScreen extends ConsumerWidget {
  final String id;
  final Venue? preview;
  const VenueDetailScreen({super.key, required this.id, this.preview});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(venueDetailProvider(id));
    final v = async.valueOrNull ?? preview;
    if (v == null) {
      return Scaffold(
        appBar: AppBar(leading: const BackButton(color: AppColors.brand)),
        body: async.hasError
            ? AsyncErrorView(error: async.error!, onRetry: () => ref.invalidate(venueDetailProvider(id)))
            : const DetailSkeleton(),
      );
    }

    void inquire([VenueSpace? space]) => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => InquiryScreen(venue: v, space: space)),
        );

    return Scaffold(
      backgroundColor: AppColors.background,
      bottomNavigationBar: InquiryBar(
        caption: v.priceFrom > 0 ? 'From, per day' : 'Pricing',
        price: v.priceFrom > 0 ? formatRupees(v.priceFrom) : 'Price on request',
        onInquiry: inquire,
      ),
      body: LayoutBuilder(builder: (context, c) {
        final gutter = AppScaffold.gutterFor(c.maxWidth);
        return RefreshIndicator(
          color: AppColors.brand,
          onRefresh: () async {
            ref.invalidate(venueDetailProvider(id));
            try {
              await ref.read(venueDetailProvider(id).future);
            } catch (_) {}
          },
          child: CustomScrollView(slivers: [
            GalleryHeader(images: v.images, icon: Icons.location_city_rounded, chips: const []),
            SliverPadding(
              padding: EdgeInsets.fromLTRB(gutter, 16, gutter, 28),
              sliver: SliverList.list(children: [
                ListingTitleCard(
                  name: v.name,
                  verified: v.isVerified,
                  featured: v.isFeatured,
                  category: v.typeLabel,
                  categoryIcon: Icons.location_city_rounded,
                  rating: v.rating,
                  reviews: v.reviewCount,
                  location: [v.address, v.city].where((x) => x.isNotEmpty).join(', '),
                  facts: [
                    if (v.capacityLabel.isNotEmpty) (Icons.groups_rounded, v.capacityLabel, 'Capacity'),
                    if (v.spaces.isNotEmpty)
                      (Icons.meeting_room_outlined, '${v.spaces.length}', v.spaces.length == 1 ? 'Space' : 'Spaces'),
                    (Icons.payments_outlined, v.priceFrom > 0 ? formatRupees(v.priceFrom) : 'On request', 'Per day'),
                  ],
                ),
                const SizedBox(height: 14),
                ContactActions(onInquiry: inquire, phone: v.contactPhone, email: v.contactEmail),
                if (v.contactPerson.isNotEmpty)
                  ListingSection(
                    title: 'Contact person',
                    child: Row(children: [
                      const Icon(Icons.person_rounded, color: AppColors.brand),
                      const SizedBox(width: 10),
                      Expanded(child: Text(v.contactPerson, style: AppType.body(15, weight: FontWeight.w600))),
                    ]),
                  ),
                if (v.description.isNotEmpty)
                  ListingSection(
                    title: 'About',
                    child: Text(v.description, style: AppType.body(15, height: 1.6, color: AppColors.ink700)),
                  ),
                if (v.spaces.isNotEmpty)
                  ListingSection(
                    title: 'Spaces',
                    padding: EdgeInsets.zero,
                    child: Column(children: [
                      for (final s in v.spaces)
                        ListRow(
                          title: s.name,
                          subtitle: [if (s.typeLabel.isNotEmpty) s.typeLabel, if (s.capacityLabel.isNotEmpty) s.capacityLabel]
                              .join(' · '),
                          value: s.pricePerDay > 0 ? formatRupees(s.pricePerDay) : null,
                          chevron: true,
                          onTap: () => inquire(s),
                        ),
                    ]),
                  ),
                if (v.amenities.isNotEmpty)
                  ListingSection(
                    title: 'Amenities',
                    child: Wrap(spacing: 8, runSpacing: 8, children: [
                      for (final a in v.amenities) StatusBadge(a, tone: Tone.brand, dot: false),
                    ]),
                  ),
                const SizedBox(height: 8),
                PackagesSection(kind: 'venue', listingId: v.id),
                if (v.rules.isNotEmpty)
                  ListingSection(
                    title: 'Rules & policy',
                    child: Text(v.rules, style: AppType.body(14, color: AppColors.textSecondary, height: 1.5)),
                  ),
                ReviewsSection(target: ReviewTarget.venue(v.id, v.name)),
              ]),
            ),
          ]),
        );
      }),
    );
  }
}
