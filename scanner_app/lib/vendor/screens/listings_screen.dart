import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/ticket_type_model.dart' show formatRupees;
import '../../ui/ui.dart';
import '../data/vendor_api.dart';
import '../data/vendor_models.dart';
import '../providers/vendor_providers.dart';
import '../widgets/vendor_widgets.dart';
import 'edit_listing_screen.dart';

/// The owner's venue listings and vendor profiles with approval status,
/// pause / resume (whole listing and per venue space), in-app editing and
/// public links.
class ListingsScreen extends ConsumerWidget {
  const ListingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(myListingsProvider);
    final listings = async.valueOrNull;
    return AppScaffold(
      title: 'Listings',
      automaticBack: false,
      onRefresh: () async {
        ref.invalidate(myListingsProvider);
        try {
          await ref.read(myListingsProvider.future);
        } catch (_) {}
      },
      slivers: [
        if (listings == null && async.hasError)
          SliverFillRemaining(
            hasScrollBody: false,
            child: ErrorState(
              message: vendorErrorMessage(async.error!),
              onRetry: () => ref.invalidate(myListingsProvider),
            ),
          )
        else if (listings == null)
          const SliverToBoxAdapter(child: LoadingList(rows: 3))
        else if (listings.isEmpty)
          const SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.add_business_outlined,
              title: 'No listings yet',
              message: 'Add your venue or service on eventlaya.com → Business → Listings. '
                  'New listings are reviewed by the Eventlaya team before they go live.',
            ),
          )
        else ...[
          SliverList.builder(
            itemCount: listings.length,
            itemBuilder: (context, i) => _ListingCard(listing: listings[i]),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
              child: Text(
                'Photos and venue spaces are changed on eventlaya.com (Business → Listings). '
                'Edits to a listing that needs changes send it back for review.',
                textAlign: TextAlign.center,
                style: AppType.caption,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _ListingCard extends ConsumerWidget {
  final OwnerListing listing;
  const _ListingCard({required this.listing});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = listing;
    final tone = switch (l.status) {
      ListingStatus.approved => Tone.success,
      ListingStatus.rejected => Tone.danger,
      _ => Tone.warning,
    };
    final facts = [
      if (l.typeLabel.isNotEmpty) l.typeLabel,
      if (l.city.isNotEmpty) l.city,
      if (l.capacityMax != null && l.capacityMax! > 0)
        l.capacityMin != null && l.capacityMin! > 0
            ? '${l.capacityMin}–${l.capacityMax} guests'
            : 'Up to ${l.capacityMax} guests',
    ];
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: GroupedSurface(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SizedBox(
            height: 132,
            child: Stack(fit: StackFit.expand, children: [
              if (l.image != null)
                CachedNetworkImage(
                  imageUrl: l.image!,
                  fit: BoxFit.cover,
                  errorWidget: (_, __, ___) => const _ImageFallback(),
                  placeholder: (_, __) => const _ImageFallback(),
                )
              else
                _ImageFallback(
                    icon: l.kind == ListingKind.venue ? Icons.location_city_rounded : Icons.storefront_rounded),
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Colors.transparent, Color(0x99000000)],
                  ),
                ),
              ),
              Positioned(
                left: 12,
                top: 12,
                child: StatusBadge(l.kind == ListingKind.venue ? 'Venue' : 'Service', tone: Tone.neutral, dot: false),
              ),
              Positioned(
                right: 12,
                top: 12,
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  if (l.isPaused) ...[const PausedBadge(), const SizedBox(width: 6)],
                  StatusBadge(ListingStatus.label(l.status), tone: tone),
                ]),
              ),
              Positioned(
                left: 14,
                right: 14,
                bottom: 10,
                child: Text(l.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppType.heading(21, color: Colors.white, weight: FontWeight.w800)),
              ),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (facts.isNotEmpty) InfoLine(Icons.info_outline_rounded, facts.join(' · ')),
              if (l.priceLabel.isNotEmpty) InfoLine(Icons.payments_outlined, l.priceLabel),
              InfoLine(
                Icons.star_rounded,
                l.reviewTotal == 0
                    ? 'No reviews yet'
                    : '${l.rating?.toStringAsFixed(1) ?? '–'} · ${l.reviewTotal} review${l.reviewTotal == 1 ? '' : 's'}',
                color: l.reviewTotal == 0 ? null : AppColors.marigoldDark,
              ),
              if (l.status == ListingStatus.rejected) ...[
                const SizedBox(height: 10),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: AppColors.dangerTint, borderRadius: BorderRadius.circular(10)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('Changes requested',
                        style: AppType.body(13, weight: FontWeight.w600, color: AppColors.danger)),
                    const SizedBox(height: 2),
                    Text(l.reviewNote ?? 'Update the listing on the website and it goes back for review.',
                        style: AppType.body(13, color: AppColors.ink800)),
                  ]),
                ),
              ] else if (l.status == ListingStatus.pending) ...[
                const SizedBox(height: 8),
                Text('The Eventlaya team is reviewing this listing. It becomes public once approved.',
                    style: AppType.caption),
              ],
            ]),
          ),
          _PauseRow(listing: l),
          if (l.kind == ListingKind.venue) _Spaces(listing: l),
          const Divider(height: 1, thickness: 0.5, color: AppColors.separator),
          Row(children: [
            Expanded(
              child: TextButton.icon(
                onPressed: l.isApproved
                    ? () => copyText(context, l.publicUrl, 'Public link')
                    : () => AppToast.info(context, 'The public page is available once the listing is approved'),
                icon: const Icon(Icons.link_rounded, size: 18),
                label: const Text('Copy public link'),
              ),
            ),
            Container(width: 0.5, height: 28, color: AppColors.separator),
            Expanded(
              child: TextButton.icon(
                onPressed: () => openEditListing(context, l),
                icon: const Icon(Icons.edit_outlined, size: 18),
                label: const Text('Edit listing'),
              ),
            ),
          ]),
        ]),
      ),
    );
  }
}

class _ImageFallback extends StatelessWidget {
  final IconData icon;
  const _ImageFallback({this.icon = Icons.image_outlined});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(colors: [Color(0xFFD63A70), AppColors.brand, Color(0xFF6B1238)]),
      ),
      alignment: Alignment.center,
      child: Icon(icon, size: 40, color: Colors.white.withValues(alpha: 0.5)),
    );
  }
}

/// Whole-listing pause: hidden from browse and search, no new requests
/// (existing requests and slots keep working).
class _PauseRow extends ConsumerStatefulWidget {
  final OwnerListing listing;
  const _PauseRow({required this.listing});

  @override
  ConsumerState<_PauseRow> createState() => _PauseRowState();
}

class _PauseRowState extends ConsumerState<_PauseRow> {
  bool _busy = false;

  Future<void> _toggle(bool taking) async {
    final l = widget.listing;
    if (!taking) {
      final ok = await confirmSheet(
        context,
        title: 'Pause ${l.name}?',
        message: 'It is hidden from browse and search and customers can’t send new requests or book slots. '
            'Existing requests, bookings and your slots are kept. You can resume any time.',
        confirmLabel: 'Pause listing',
        destructive: false,
      );
      if (!ok || !mounted) return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(vendorApiProvider).setListingPaused(l, !taking);
      ref.invalidate(myListingsProvider);
      try {
        await ref.read(myListingsProvider.future);
      } catch (_) {}
      if (mounted) AppToast.success(context, taking ? '${l.name} is taking requests again' : '${l.name} is paused');
    } catch (e) {
      if (mounted) AppToast.error(context, vendorErrorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final paused = widget.listing.isPaused;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 4, 6, 4),
      child: Row(children: [
        Icon(paused ? Icons.pause_circle_outline_rounded : Icons.play_circle_outline_rounded,
            size: 20, color: paused ? AppColors.ink400 : AppColors.success),
        const SizedBox(width: 8),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(paused ? 'Paused' : 'Taking requests', style: AppType.body(14, weight: FontWeight.w600)),
            Text(
              paused ? 'Hidden · no new requests or bookings' : 'Shown in the marketplace',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppType.caption,
            ),
          ]),
        ),
        if (_busy)
          const Padding(
            padding: EdgeInsets.all(14),
            child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
          )
        else
          Tooltip(
            message: paused ? 'Paused — tap to resume' : 'Taking requests — tap to pause',
            child: Switch.adaptive(
              value: !paused,
              activeTrackColor: AppColors.success,
              onChanged: _toggle,
            ),
          ),
      ]),
    );
  }
}

/// Venue spaces with a pause / resume switch (the space's `is_active`).
class _Spaces extends ConsumerStatefulWidget {
  final OwnerListing listing;
  const _Spaces({required this.listing});

  @override
  ConsumerState<_Spaces> createState() => _SpacesState();
}

class _SpacesState extends ConsumerState<_Spaces> {
  final Set<String> _busy = {};

  Future<void> _toggle(OwnerSpace s, bool active) async {
    if (!active) {
      final ok = await confirmSheet(
        context,
        title: 'Pause ${s.name}?',
        message: 'Customers can’t request this space while it is paused. Existing requests are kept.',
        confirmLabel: 'Pause bookings',
        destructive: false,
      );
      if (!ok || !mounted) return;
    }
    setState(() => _busy.add(s.id));
    try {
      await ref.read(vendorApiProvider).setSpaceActive(widget.listing.id, s.id, active);
      if (!mounted) return;
      ref.invalidate(venueSpacesProvider(widget.listing.id));
      ref.invalidate(myListingsProvider);
      AppToast.success(context, active ? '${s.name} is taking bookings again' : '${s.name} is paused');
    } catch (e) {
      if (mounted) AppToast.error(context, vendorErrorMessage(e));
    } finally {
      if (mounted) setState(() => _busy.remove(s.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final spaces = ref.watch(venueSpacesProvider(widget.listing.id)).valueOrNull ?? widget.listing.spaces;
    if (spaces.isEmpty) return const SizedBox(height: 8);
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 8, 6, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Spaces', style: AppType.groupHeader),
        for (final s in spaces)
          Row(children: [
            Icon(Icons.meeting_room_outlined, size: 18, color: s.isActive ? AppColors.ink600 : AppColors.ink300),
            const SizedBox(width: 8),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(s.name,
                    style: AppType.body(14,
                        weight: FontWeight.w500, color: s.isActive ? AppColors.textPrimary : AppColors.ink400)),
                Text(
                  [
                    if (s.type.isNotEmpty) s.type,
                    if (s.capacityLabel.isNotEmpty) s.capacityLabel,
                    if (s.price > 0) '${formatRupees(s.price)}/day',
                    if (!s.isActive) 'Paused',
                  ].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.caption,
                ),
              ]),
            ),
            if (_busy.contains(s.id))
              const Padding(
                padding: EdgeInsets.all(14),
                child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
              )
            else
              Tooltip(
                message: s.isActive ? 'Taking bookings — tap to pause' : 'Paused — tap to resume',
                child: Switch.adaptive(
                  value: s.isActive,
                  activeTrackColor: AppColors.success,
                  onChanged: (v) => _toggle(s, v),
                ),
              ),
          ]),
      ]),
    );
  }
}
