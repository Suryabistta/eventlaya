import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/ticket_type_model.dart';
import '../../ui/ui.dart';
import '../../reviews/review_models.dart';
import '../../reviews/review_widgets.dart';
import '../models/marketplace.dart';
import '../providers/marketplace_providers.dart';
import '../widgets/attendee_widgets.dart';
import '../widgets/gallery_header.dart';
import '../widgets/packages_section.dart';
import 'inquiry_screen.dart';
import '../widgets/listing_widgets.dart';

/// Vendor profile: portfolio, details and how to get in touch.
class VendorDetailScreen extends ConsumerWidget {
  final String id;
  final Vendor? preview;
  const VendorDetailScreen({super.key, required this.id, this.preview});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(vendorDetailProvider(id));
    final v = async.valueOrNull ?? preview;
    if (v == null) {
      return Scaffold(
        appBar: AppBar(leading: const BackButton(color: AppColors.brand)),
        body: async.hasError
            ? AsyncErrorView(error: async.error!, onRetry: () => ref.invalidate(vendorDetailProvider(id)))
            : const DetailSkeleton(),
      );
    }

    void inquire() => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => InquiryScreen.vendor(vendor: v)),
        );

    return Scaffold(
      backgroundColor: AppColors.background,
      bottomNavigationBar: InquiryBar(
        caption: v.startingPrice > 0 && !v.hidePrice ? 'Starting from' : 'Pricing',
        price: v.startingPrice > 0 && !v.hidePrice ? formatRupees(v.startingPrice) : 'Price on request',
        onInquiry: inquire,
      ),
      body: LayoutBuilder(builder: (context, c) {
        final gutter = AppScaffold.gutterFor(c.maxWidth);
        return RefreshIndicator(
          color: AppColors.brand,
          onRefresh: () async {
            ref.invalidate(vendorDetailProvider(id));
            try {
              await ref.read(vendorDetailProvider(id).future);
            } catch (_) {}
          },
          child: CustomScrollView(slivers: [
            GalleryHeader(images: v.images, icon: vendorCategoryIcon(v.categoryName), chips: const []),
            SliverPadding(
              padding: EdgeInsets.fromLTRB(gutter, 16, gutter, 28),
              sliver: SliverList.list(children: [
                ListingTitleCard(
                  name: v.businessName,
                  verified: v.isVerified,
                  featured: v.isFeatured,
                  category: v.categoryName,
                  categoryIcon: vendorCategoryIcon(v.categoryName),
                  rating: v.rating,
                  reviews: v.reviewTotal,
                  location: [v.address, v.city].where((x) => x.isNotEmpty).join(', '),
                  facts: [
                    (
                      Icons.payments_outlined,
                      v.startingPrice > 0 && !v.hidePrice ? formatRupees(v.startingPrice) : 'On request',
                      'Price'
                    ),
                    if (v.city.isNotEmpty) (Icons.place_outlined, v.city, 'Based in'),
                    if (v.serviceAreas.isNotEmpty)
                      (Icons.map_outlined, '${v.serviceAreas.length} area${v.serviceAreas.length == 1 ? '' : 's'}', 'Also serves'),
                  ],
                ),
                const SizedBox(height: 14),
                ContactActions(onInquiry: inquire, phone: v.phone, email: v.email),
                if (v.description.isNotEmpty)
                  ListingSection(
                    title: 'About',
                    child: Text(v.description, style: AppType.body(15, height: 1.6, color: AppColors.ink700)),
                  ),
                if (v.serviceAreas.isNotEmpty)
                  ListingSection(
                    title: 'Service areas',
                    child: Wrap(spacing: 8, runSpacing: 8, children: [
                      for (final a in v.serviceAreas) StatusBadge(a, tone: Tone.brand, dot: false),
                    ]),
                  ),
                const SizedBox(height: 8),
                PackagesSection(kind: 'vendor', listingId: v.id),
                ReviewsSection(target: ReviewTarget.vendor(v.id, v.businessName)),
              ]),
            ),
          ]),
        );
      }),
    );
  }
}
