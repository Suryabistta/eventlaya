import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../ui/ui.dart';

/// Shared building blocks for vendor and venue pages.

/// Name, verified tick, category, rating and location, with a row of fact chips below.
class ListingTitleCard extends StatelessWidget {
  final String name;
  final bool verified;
  final bool featured;
  final String category;
  final IconData categoryIcon;
  final double? rating;
  final int reviews;
  final String location;
  final List<(IconData, String, String)> facts; // icon, value, label

  const ListingTitleCard({
    super.key,
    required this.name,
    this.verified = false,
    this.featured = false,
    this.category = '',
    this.categoryIcon = Icons.storefront_rounded,
    this.rating,
    this.reviews = 0,
    this.location = '',
    this.facts = const [],
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        boxShadow: softShadow,
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Wrap(spacing: 6, runSpacing: 6, children: [
          if (category.isNotEmpty) _Tag(icon: categoryIcon, label: category),
          if (featured) const _Tag(icon: Icons.star_rounded, label: 'Featured', strong: true),
          if (verified) const _Tag(icon: Icons.verified_rounded, label: 'Verified', color: AppColors.verified),
        ]),
        const SizedBox(height: 10),
        Text(name, style: AppType.heading(25, weight: FontWeight.w800)),
        const SizedBox(height: 8),
        Wrap(spacing: 14, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          if (rating != null && rating! > 0)
            Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.star_rounded, size: 18, color: AppColors.marigold),
              const SizedBox(width: 3),
              Text(rating!.toStringAsFixed(1), style: AppType.body(14, weight: FontWeight.w700)),
              Text(reviews > 0 ? '  ·  $reviews review${reviews == 1 ? '' : 's'}' : '', style: AppType.caption),
            ]),
          if (location.isNotEmpty)
            Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.place_outlined, size: 16, color: AppColors.ink500),
              const SizedBox(width: 3),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 260),
                child: Text(location, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.rowSubtitle),
              ),
            ]),
        ]),
        if (facts.isNotEmpty) ...[
          const SizedBox(height: 16),
          Row(children: [
            for (var i = 0; i < facts.length; i++) ...[
              if (i > 0) const SizedBox(width: 8),
              Expanded(child: FactBox(icon: facts[i].$1, value: facts[i].$2, label: facts[i].$3)),
            ],
          ]),
        ],
      ]),
    );
  }
}

class _Tag extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool strong;
  final Color? color;
  const _Tag({required this.icon, required this.label, this.strong = false, this.color});

  @override
  Widget build(BuildContext context) {
    final fg = strong ? Colors.white : (color ?? AppColors.brand);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: strong ? AppColors.brand : (color ?? AppColors.brand).withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 14, color: fg),
        const SizedBox(width: 5),
        Text(label, style: AppType.body(12, weight: FontWeight.w600, color: fg, height: 1.2)),
      ]),
    );
  }
}

class FactBox extends StatelessWidget {
  final IconData icon;
  final String value;
  final String label;
  const FactBox({super.key, required this.icon, required this.value, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      decoration: BoxDecoration(color: AppColors.ink50, borderRadius: BorderRadius.circular(AppRadius.md)),
      child: Column(children: [
        Icon(icon, size: 20, color: AppColors.brand),
        const SizedBox(height: 6),
        Text(value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppType.body(13.5, weight: FontWeight.w700, height: 1.2)),
        Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.caption),
      ]),
    );
  }
}

/// One round button in an [ActionCircles] row.
class ActionItem {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool primary;
  const ActionItem(this.icon, this.label, this.onTap, {this.primary = false});
}

/// White card with a row of round icon buttons (Inquiry · Call · Directions · Share …).
class ActionCircles extends StatelessWidget {
  final List<ActionItem> items;
  const ActionCircles({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 6),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        boxShadow: softShadow,
      ),
      child: Row(children: [
        for (final it in items)
          Expanded(
            child: Semantics(
              button: true,
              label: it.label,
              excludeSemantics: true,
              child: InkWell(
                borderRadius: BorderRadius.circular(AppRadius.md),
                onTap: () {
                  HapticFeedback.selectionClick();
                  it.onTap();
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Column(children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: it.primary ? AppColors.brand : AppColors.brandTint,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(it.icon, size: 22, color: it.primary ? Colors.white : AppColors.brand),
                    ),
                    const SizedBox(height: 6),
                    Text(it.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppType.body(12.5, weight: FontWeight.w600, color: AppColors.ink800)),
                  ]),
                ),
              ),
            ),
          ),
      ]),
    );
  }
}

/// Opens [uri] in another app; when none can, copies [fallback] instead.
Future<void> openOrCopy(BuildContext context, Uri uri, String fallback, String what) async {
  var ok = false;
  try {
    ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {}
  if (!ok && context.mounted) {
    Clipboard.setData(ClipboardData(text: fallback));
    AppToast.success(context, '$what copied');
  }
}

/// Phone digits for tel: / WhatsApp links.
String phoneDigits(String p) => p.replaceAll(RegExp(r'[^0-9+]'), '');

/// WhatsApp needs the country code: Nepali 10-digit mobiles get 977.
String whatsappNumber(String phone) {
  final p = phoneDigits(phone);
  return p.startsWith('+') ? p.substring(1) : (p.length == 10 ? '977$p' : p);
}

/// Quick-contact buttons for vendors and venues: Inquiry · Call · WhatsApp · Email (only the ones with data).
class ContactActions extends StatelessWidget {
  final VoidCallback onInquiry;
  final String phone;
  final String email;
  const ContactActions({super.key, required this.onInquiry, this.phone = '', this.email = ''});

  @override
  Widget build(BuildContext context) {
    final p = phoneDigits(phone);
    return ActionCircles(items: [
      ActionItem(Icons.forum_rounded, 'Inquiry', onInquiry, primary: true),
      if (p.isNotEmpty)
        ActionItem(Icons.call_rounded, 'Call', () => openOrCopy(context, Uri(scheme: 'tel', path: p), phone, 'Phone number')),
      if (p.isNotEmpty)
        ActionItem(Icons.chat_rounded, 'WhatsApp',
            () => openOrCopy(context, Uri.parse('https://wa.me/${whatsappNumber(phone)}'), phone, 'Phone number')),
      if (email.isNotEmpty)
        ActionItem(Icons.mail_rounded, 'Email', () => openOrCopy(context, Uri(scheme: 'mailto', path: email), email, 'Email')),
    ]);
  }
}

/// Section card with a title, for the listing pages.
class ListingSection extends StatelessWidget {
  final String title;
  final Widget child;
  final EdgeInsetsGeometry padding;
  const ListingSection({super.key, required this.title, required this.child, this.padding = const EdgeInsets.all(16)});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 18),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 0, 4, 10),
          child: Text(title, style: AppType.heading(19)),
        ),
        Container(
          width: double.infinity,
          padding: padding,
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadius.lg + 2),
            boxShadow: softShadow,
          ),
          child: child,
        ),
      ]),
    );
  }
}

/// Sticky bottom bar: price on the left, a big "Send inquiry" button on the right.
class InquiryBar extends StatelessWidget {
  final String price;
  final String caption;
  final VoidCallback onInquiry;
  const InquiryBar({super.key, required this.price, required this.caption, required this.onInquiry});

  @override
  Widget build(BuildContext context) {
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: Container(
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.92),
            boxShadow: [BoxShadow(color: AppColors.ink900.withValues(alpha: 0.08), blurRadius: 20, offset: const Offset(0, -4))],
          ),
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 16, 12),
              child: Row(children: [
                Expanded(
                  child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(caption, style: AppType.caption),
                    Text(price,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppType.heading(19, color: AppColors.brand)),
                  ]),
                ),
                const SizedBox(width: 12),
                DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(99),
                    boxShadow: [
                      BoxShadow(color: AppColors.brand.withValues(alpha: 0.35), blurRadius: 14, offset: const Offset(0, 5)),
                    ],
                  ),
                  child: FilledButton.icon(
                    onPressed: onInquiry,
                    icon: const Icon(Icons.send_rounded, size: 19),
                    label: const Text('Send inquiry'),
                    style: FilledButton.styleFrom(
                      shape: const StadiumBorder(),
                      padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
                      textStyle: AppType.body(15, weight: FontWeight.w600),
                    ),
                  ),
                ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

/// Grey outline of a detail page (banner, title card, buttons, sections) while it loads.
class DetailSkeleton extends StatelessWidget {
  const DetailSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return AppShimmer(
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: const [
          ShimmerBox(height: 260, radius: 0),
          Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              ShimmerBox(height: 150, radius: AppRadius.xl),
              SizedBox(height: 14),
              ShimmerBox(height: 96, radius: AppRadius.xl),
              SizedBox(height: 24),
              ShimmerBox(height: 18, width: 120),
              SizedBox(height: 12),
              ShimmerBox(height: 110, radius: AppRadius.lg),
            ]),
          ),
        ],
      ),
    );
  }
}
