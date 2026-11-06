import 'dart:ui';
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
            : const Center(child: CircularProgressIndicator()),
      );
    }

    void inquire([VenueSpace? space]) => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => InquiryScreen(venue: v, space: space)),
        );

    return Scaffold(
      backgroundColor: AppColors.background,
      bottomNavigationBar: ClipRect(
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
          child: Container(
            decoration: BoxDecoration(
              color: AppColors.ink50.withValues(alpha: 0.9),
              border: const Border(top: BorderSide(color: AppColors.separator, width: 0.5)),
            ),
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                child: Row(children: [
                  Expanded(
                    child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(v.priceFrom > 0 ? 'From ${formatRupees(v.priceFrom)}' : 'Price on request',
                          style: AppType.heading(18)),
                      Text(v.priceFrom > 0 ? 'per day' : 'Ask the venue', style: AppType.caption),
                    ]),
                  ),
                  PrimaryButton(label: 'Send inquiry', icon: Icons.send_rounded, expand: false, onPressed: inquire),
                ]),
              ),
            ),
          ),
        ),
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
            GalleryHeader(
              images: v.images,
              icon: Icons.location_city_rounded,
              chips: [if (v.typeLabel.isNotEmpty) GlassChip(v.typeLabel)],
            ),
            SliverPadding(
              padding: EdgeInsets.fromLTRB(gutter, 20, gutter, 24),
              sliver: SliverList.list(children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Flexible(child: Text(v.name, style: AppType.heading(26, weight: FontWeight.w800))),
                      if (v.isVerified) ...[
                        const SizedBox(width: 6),
                        const Icon(Icons.verified_rounded, color: AppColors.success, size: 22),
                      ],
                    ]),
                    const SizedBox(height: 6),
                    Row(children: [
                      if (v.rating != null && v.rating! > 0) ...[
                        RatingLabel(rating: v.rating!, reviews: v.reviewCount),
                        const SizedBox(width: 10),
                      ],
                      Expanded(
                        child: Text([v.address, v.city].where((x) => x.isNotEmpty).join(', '),
                            maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.rowSubtitle),
                      ),
                    ]),
                  ]),
                ),
                const SizedBox(height: 20),
                GroupedSection(
                  separatorInset: 58,
                  children: [
                    if (v.capacityLabel.isNotEmpty)
                      ListRow(
                        leading: const RowIcon(Icons.groups_rounded, background: AppColors.marigold),
                        title: v.capacityLabel,
                        subtitle: 'Capacity',
                      ),
                    if (v.contactPerson.isNotEmpty)
                      ListRow(
                        leading: const RowIcon(Icons.person_rounded, background: AppColors.ink600),
                        title: v.contactPerson,
                        subtitle: 'Contact person',
                      ),
                    if (v.contactPhone.isNotEmpty)
                      ListRow(
                        leading: const RowIcon(Icons.call_rounded),
                        title: v.contactPhone,
                        subtitle: 'Phone · tap to copy',
                        onTap: () {
                          Clipboard.setData(ClipboardData(text: v.contactPhone));
                          AppToast.success(context, 'Phone number copied');
                        },
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
                if (v.spaces.isNotEmpty)
                  GroupedSection(
                    header: 'Spaces',
                    children: [
                      for (final s in v.spaces)
                        ListRow(
                          title: s.name,
                          subtitle: [if (s.typeLabel.isNotEmpty) s.typeLabel, if (s.capacityLabel.isNotEmpty) s.capacityLabel]
                              .join(' · '),
                          value: s.pricePerDay > 0 ? formatRupees(s.pricePerDay) : null,
                          chevron: true,
                          onTap: () => inquire(s),
                        ),
                    ],
                  ),
                if (v.amenities.isNotEmpty)
                  GroupedSection(
                    header: 'Amenities',
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(14),
                        child: Wrap(spacing: 8, runSpacing: 8, children: [
                          for (final a in v.amenities) StatusBadge(a, tone: Tone.neutral, dot: false),
                        ]),
                      ),
                    ],
                  ),
                if (v.rules.isNotEmpty)
                  GroupedSection(
                    header: 'Rules & policy',
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(16),
                        child: Text(v.rules, style: AppType.body(14, color: AppColors.textSecondary, height: 1.5)),
                      ),
                    ],
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
