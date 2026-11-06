import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/ticket_type_model.dart';
import '../../ui/ui.dart';
import '../../reviews/review_models.dart';
import '../../reviews/review_widgets.dart';
import '../models/marketplace.dart';
import '../providers/marketplace_providers.dart';
import '../widgets/attendee_widgets.dart';
import '../widgets/gallery_header.dart';
import 'inquiry_screen.dart';
import 'vendors_screen.dart' show RatingLabel;

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
            : const Center(child: CircularProgressIndicator()),
      );
    }

    void copy(String label, String value) {
      Clipboard.setData(ClipboardData(text: value));
      AppToast.success(context, '$label copied');
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      body: LayoutBuilder(builder: (context, c) {
        final gutter = AppScaffold.gutterFor(c.maxWidth);
        return CustomScrollView(slivers: [
          GalleryHeader(
            images: v.images,
            icon: Icons.storefront_rounded,
            chips: [if (v.categoryName.isNotEmpty) GlassChip(v.categoryName)],
          ),
          SliverPadding(
            padding: EdgeInsets.fromLTRB(gutter, 20, gutter, MediaQuery.paddingOf(context).bottom + 24),
            sliver: SliverList.list(children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Flexible(child: Text(v.businessName, style: AppType.heading(26, weight: FontWeight.w800))),
                    if (v.isVerified) ...[
                      const SizedBox(width: 6),
                      const Icon(Icons.verified_rounded, color: AppColors.success, size: 22),
                    ],
                  ]),
                  const SizedBox(height: 6),
                  Row(children: [
                    if (v.rating != null && v.rating! > 0) ...[
                      RatingLabel(rating: v.rating!, reviews: v.reviewTotal),
                      const SizedBox(width: 10),
                    ],
                    if (v.city.isNotEmpty) Text(v.city, style: AppType.rowSubtitle),
                  ]),
                ]),
              ),
              const SizedBox(height: 20),
              GroupedSection(
                separatorInset: 58,
                children: [
                  if (v.startingPrice > 0)
                    ListRow(
                      leading: const RowIcon(Icons.payments_outlined, background: AppColors.ink600),
                      title: 'From ${formatRupees(v.startingPrice)}',
                      subtitle: 'Starting price',
                    ),
                  if (v.address.isNotEmpty || v.city.isNotEmpty)
                    ListRow(
                      leading: const RowIcon(Icons.place_rounded, background: AppColors.success),
                      title: [v.address, v.city].where((x) => x.isNotEmpty).join(', '),
                    ),
                ],
              ),
              if (v.description.isNotEmpty)
                GroupedSection(
                  header: 'About',
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(v.description, style: AppType.body(15, height: 1.55)),
                    ),
                  ],
                ),
              GroupedSection(
                header: 'Get in touch',
                footer: 'Tap a number or email to copy it.',
                separatorInset: 58,
                children: [
                  ListRow(
                    leading: const RowIcon(Icons.forum_rounded, background: AppColors.success),
                    title: 'Send inquiry',
                    subtitle: 'Ask about availability and prices',
                    chevron: true,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => InquiryScreen.vendor(vendor: v)),
                    ),
                  ),
                  if (v.phone.isNotEmpty)
                    ListRow(
                      leading: const RowIcon(Icons.call_rounded),
                      title: v.phone,
                      subtitle: 'Phone',
                      trailing: const Icon(Icons.copy_rounded, size: 18, color: AppColors.ink400),
                      onTap: () => copy('Phone number', v.phone),
                    ),
                  if (v.email.isNotEmpty)
                    ListRow(
                      leading: const RowIcon(Icons.mail_rounded, background: AppColors.ink500),
                      title: v.email,
                      subtitle: 'Email',
                      trailing: const Icon(Icons.copy_rounded, size: 18, color: AppColors.ink400),
                      onTap: () => copy('Email', v.email),
                    ),
                ],
              ),
              ReviewsSection(target: ReviewTarget.vendor(v.id, v.businessName)),
            ]),
          ),
        ]);
      }),
    );
  }
}
