import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/ticket_type_model.dart' show formatRupees;
import '../../providers/modules_provider.dart';
import '../../ui/ui.dart';
import '../models/marketplace.dart';
import '../providers/marketplace_providers.dart';
import 'attendee_widgets.dart';

/// A vendor's or venue's packages (module `packages`); nothing when there are none.
/// [kind] is 'vendor' or 'venue'.
class PackagesSection extends ConsumerWidget {
  final String kind;
  final String listingId;
  const PackagesSection({super.key, required this.kind, required this.listingId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(moduleEnabledProvider(AppModule.packages))) return const SizedBox.shrink();
    final packages = ref.watch(packagesProvider((kind, listingId))).valueOrNull ?? const [];
    if (packages.isEmpty) return const SizedBox.shrink();
    return GroupedSection(
      header: 'Packages',
      footer: 'Mention the package in your inquiry. Final prices are confirmed by the business.',
      children: [for (final p in packages) _PackageTile(p)],
    );
  }
}

class _PackageTile extends StatelessWidget {
  final ServicePackage p;
  const _PackageTile(this.p);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (p.imageUrl != null) ...[
          ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.md),
            child: AspectRatio(aspectRatio: 16 / 7, child: NetImage(url: p.imageUrl, icon: Icons.inventory_2_outlined)),
          ),
          const SizedBox(height: 12),
        ],
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Text(p.name, style: AppType.heading(17, weight: FontWeight.w700))),
          if (p.maxGuests != null) Text('Up to ${p.maxGuests}', style: AppType.caption),
        ]),
        const SizedBox(height: 4),
        Text('${formatRupees(p.price)} ${p.priceUnitLabel}'.trim(),
            style: AppType.body(15, weight: FontWeight.w700, color: AppColors.brand)),
        if (p.description.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(p.description, style: AppType.body(14, color: AppColors.textSecondary)),
        ],
        for (final line in p.inclusions)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Icon(Icons.check_rounded, size: 18, color: AppColors.success),
              const SizedBox(width: 6),
              Expanded(child: Text(line, style: AppType.body(14))),
            ]),
          ),
      ]),
    );
  }
}
