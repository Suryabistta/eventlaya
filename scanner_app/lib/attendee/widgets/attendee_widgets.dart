import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/api_client.dart';
import '../../core/bs_date.dart';
import '../../models/event_model.dart';
import '../../screens/common/event_phase.dart';
import '../../screens/common/format.dart';
import '../../screens/common/passes.dart' show ticketTypeFields;
import '../../ui/ui.dart';
import '../data/attendee_api.dart';
import '../models/public_event.dart';
import '../models/stored_pass.dart';

/// Brand gradient used for heroes and image placeholders.
const brandGradient = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFFD63A70), AppColors.brand, Color(0xFF6B1238)],
  stops: [0, 0.45, 1],
);

/// "Sat 12 Apr · 16:00" (or with an end day for multi-day events).
String eventWhen(EventModel e) {
  final start = e.startsAt;
  if (start == null) return 'Date to be announced';
  final day = DateFormat('EEE d MMM');
  final last = e.lastDay;
  final multi = last != null && e.startDay != null && last.isAfter(e.startDay!);
  final time = e.startTime != null ? ' · ${DateFormat('HH:mm').format(start)}' : '';
  return multi ? '${day.format(start)} – ${day.format(last)}' : '${day.format(start)}$time';
}

IconData categoryIcon(String? category) {
  final c = (category ?? '').toLowerCase();
  bool has(List<String> k) => k.any(c.contains);
  if (has(['conference', 'seminar', 'summit'])) return Icons.mic_external_on_rounded;
  if (has(['hackathon', 'tech', 'code'])) return Icons.code_rounded;
  if (has(['concert', 'music', 'dj'])) return Icons.music_note_rounded;
  if (has(['festival', 'party', 'celebrat'])) return Icons.celebration_rounded;
  if (has(['workshop', 'training'])) return Icons.handyman_rounded;
  if (has(['sport', 'marathon', 'run', 'game', 'tournament'])) return Icons.emoji_events_rounded;
  if (has(['wedding'])) return Icons.favorite_rounded;
  if (has(['meetup', 'network', 'community'])) return Icons.groups_rounded;
  if (has(['educat', 'school', 'class', 'course'])) return Icons.school_rounded;
  if (has(['cultur', 'theat', 'drama', 'art'])) return Icons.theater_comedy_rounded;
  if (has(['film', 'movie', 'cinema'])) return Icons.movie_rounded;
  if (has(['pageant', 'beauty', 'fashion'])) return Icons.auto_awesome_rounded;
  if (has(['food', 'cater'])) return Icons.restaurant_rounded;
  return Icons.event_rounded;
}

/// Icon for a marketplace vendor category, chosen by its name.
IconData vendorCategoryIcon(String name) {
  final c = name.toLowerCase();
  bool has(List<String> k) => k.any(c.contains);
  if (has(['photo', 'video', 'camera'])) return Icons.photo_camera_rounded;
  if (has(['sound', 'audio', 'dj', 'music', 'band'])) return Icons.speaker_rounded;
  if (has(['light', 'stage'])) return Icons.light_rounded;
  if (has(['decor', 'flower', 'floral'])) return Icons.local_florist_rounded;
  if (has(['cater', 'food', 'cake', 'bak'])) return Icons.restaurant_rounded;
  if (has(['venue', 'hall', 'palace', 'resort'])) return Icons.location_city_rounded;
  if (has(['makeup', 'beauty', 'salon', 'mehendi'])) return Icons.brush_rounded;
  if (has(['transport', 'car', 'bus'])) return Icons.directions_car_rounded;
  if (has(['print', 'card', 'invit'])) return Icons.print_rounded;
  if (has(['tent', 'rental'])) return Icons.festival_rounded;
  return Icons.storefront_rounded;
}

/// Rounded white search field with a soft shadow.
class AppSearchField extends StatelessWidget {
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback? onClear;
  final String hint;
  const AppSearchField({super.key, required this.controller, required this.onChanged, this.onClear, required this.hint});

  @override
  Widget build(BuildContext context) {
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(99),
      borderSide: BorderSide(color: AppColors.ink200.withValues(alpha: 0.8)),
    );
    return DecoratedBox(
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(99), boxShadow: softShadow),
      child: ValueListenableBuilder<TextEditingValue>(
        valueListenable: controller,
        builder: (context, value, _) => TextField(
          controller: controller,
          onChanged: onChanged,
          textInputAction: TextInputAction.search,
          style: AppType.body(15),
          decoration: InputDecoration(
            hintText: hint,
            prefixIcon: const Padding(
              padding: EdgeInsets.only(left: 8),
              child: Icon(Icons.search_rounded, color: AppColors.ink700),
            ),
            suffixIcon: value.text.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Clear',
                    icon: const Icon(Icons.close_rounded, size: 20),
                    onPressed: () {
                      controller.clear();
                      onChanged('');
                      onClear?.call();
                    },
                  ),
            fillColor: Colors.white,
            contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 15),
            border: border,
            enabledBorder: border,
            focusedBorder: border.copyWith(borderSide: const BorderSide(color: AppColors.brand, width: 1.4)),
          ),
        ),
      ),
    );
  }
}

/// Network image with a branded placeholder while loading / on error / when
/// there is no URL.
class NetImage extends StatelessWidget {
  final String? url;
  final IconData icon;
  final BoxFit fit;
  const NetImage({super.key, required this.url, this.icon = Icons.event_rounded, this.fit = BoxFit.cover});

  @override
  Widget build(BuildContext context) {
    final placeholder = _Placeholder(icon: icon);
    if (url == null || url!.isEmpty) return placeholder;
    return CachedNetworkImage(
      imageUrl: url!,
      fit: fit,
      fadeInDuration: const Duration(milliseconds: 200),
      placeholder: (_, __) => placeholder,
      errorWidget: (_, __, ___) => placeholder,
    );
  }
}

class _Placeholder extends StatelessWidget {
  final IconData icon;
  const _Placeholder({required this.icon});

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(gradient: brandGradient),
      child: Center(child: Icon(icon, size: 40, color: Colors.white.withValues(alpha: 0.55))),
    );
  }
}

/// Shows an API error: "currently unavailable" when the server switched the
/// feature off, otherwise a retryable error.
class AsyncErrorView extends StatelessWidget {
  final Object error;
  final VoidCallback onRetry;
  final String title;
  const AsyncErrorView({super.key, required this.error, required this.onRetry, this.title = "Couldn't load this"});

  @override
  Widget build(BuildContext context) {
    if (ApiClient.isModuleDisabled(error)) {
      return const EmptyState(
        icon: Icons.power_settings_new_rounded,
        title: 'Not available right now',
        message: ApiClient.moduleDisabledMessage,
      );
    }
    return ErrorState(title: title, message: friendlyError(error), onRetry: onRetry);
  }
}

/// Pill on top of images: phase or category.
class GlassChip extends StatelessWidget {
  final String label;
  final Color? dot;
  const GlassChip(this.label, {super.key, this.dot});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.ink950.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: Colors.white.withValues(alpha: 0.18), width: 0.5),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot != null) ...[
            Container(width: 7, height: 7, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppType.body(12, weight: FontWeight.w600, color: Colors.white, height: 1.2)),
          ),
        ],
      ),
    );
  }
}

/// Phase pill for event images ("Live", "Tomorrow", "Ended"…).
class EventPhaseChip extends StatelessWidget {
  final EventModel event;
  const EventPhaseChip(this.event, {super.key});

  @override
  Widget build(BuildContext context) {
    final p = event.phase;
    final dot = switch (p) {
      EventPhase.live => const Color(0xFF4ADE80),
      EventPhase.upcoming => const Color(0xFFFCD34D),
      EventPhase.cancelled => const Color(0xFFF87171),
      _ => AppColors.ink300,
    };
    return GlassChip(PhaseCopy.label(event), dot: dot);
  }
}

/// What the card's price line says: same order as the website's cards
/// (apply first, then a scheduled opening).
String eventCta(PublicEvent e) => e.externalRegisterUrl != null
    ? 'Register'
    : e.applyFirst
        ? e.applyLabel
        : e.registrationOpensLater
            ? 'Opens ${BsDate.format('d MMM', e.registrationOpens!)}'
            : e.isFull
                ? 'Fully booked'
                : e.priceLabel;

/// Large event card for lists: banner, phase, title, when, where, price and a "View details" button.
class EventCard extends StatelessWidget {
  final PublicEvent event;
  final VoidCallback onTap;
  const EventCard({super.key, required this.event, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final e = event;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: DecoratedBox(
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(AppRadius.xl), boxShadow: softShadow),
        child: Material(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.xl),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(AppRadius.lg),
                    child: AspectRatio(
                      aspectRatio: 16 / 8,
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          NetImage(url: e.bannerUrl, icon: categoryIcon(e.category)),
                          Positioned(left: 10, top: 10, child: EventPhaseChip(e.base)),
                          if (e.category != null && e.category != 'other')
                            Positioned(right: 10, top: 10, child: GlassChip(e.categoryLabel)),
                          if (e.isFeatured && e.phase != EventPhase.ended && e.phase != EventPhase.cancelled)
                            const Positioned(left: 10, bottom: 10, child: FeaturedBadge()),
                        ],
                      ),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(e.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.heading(19)),
                      const SizedBox(height: 8),
                      IconLine(icon: Icons.calendar_month_outlined, text: eventWhen(e.base)),
                      const SizedBox(height: 4),
                      IconLine(icon: Icons.place_outlined, text: e.venue),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              eventCta(e),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppType.body(14.5,
                                  weight: FontWeight.w700, color: e.isFull ? AppColors.ink500 : AppColors.brand),
                            ),
                          ),
                          const SizedBox(width: 8),
                          PillButton(label: 'View details', onPressed: onTap, dense: true),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Icon + one line of muted text (date, place).
class IconLine extends StatelessWidget {
  final IconData icon;
  final String text;
  final int maxLines;
  const IconLine({super.key, required this.icon, required this.text, this.maxLines = 1});

  @override
  Widget build(BuildContext context) {
    if (text.trim().isEmpty) return const SizedBox.shrink();
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(
        padding: const EdgeInsets.only(top: 1),
        child: Icon(icon, size: 16, color: AppColors.ink500),
      ),
      const SizedBox(width: 6),
      Expanded(
        child: Text(text, maxLines: maxLines, overflow: TextOverflow.ellipsis, style: AppType.rowSubtitle),
      ),
    ]);
  }
}

/// Solid "★ Featured" badge for images.
class FeaturedBadge extends StatelessWidget {
  const FeaturedBadge({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(color: AppColors.brand, borderRadius: BorderRadius.circular(99)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.star_rounded, size: 14, color: Colors.white),
        const SizedBox(width: 4),
        Text('Featured', style: AppType.body(11.5, weight: FontWeight.w600, color: Colors.white, height: 1.2)),
      ]),
    );
  }
}

/// Wide card for the Explore "Featured events" carousel: image left, details and button right.
class FeaturedEventCard extends StatelessWidget {
  final PublicEvent event;
  final VoidCallback onTap;
  const FeaturedEventCard({super.key, required this.event, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final e = event;
    return DecoratedBox(
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(AppRadius.xl), boxShadow: softShadow),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Expanded(
                flex: 10,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(AppRadius.lg),
                  child: Stack(fit: StackFit.expand, children: [
                    NetImage(url: e.bannerUrl, icon: categoryIcon(e.category)),
                    Positioned(
                      left: 8,
                      top: 8,
                      child: e.isLive ? const GlassChip('Live now', dot: Color(0xFF4ADE80)) : const FeaturedBadge(),
                    ),
                  ]),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                flex: 11,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(0, 6, 4, 4),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(e.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.heading(17)),
                    const SizedBox(height: 8),
                    IconLine(icon: Icons.calendar_month_outlined, text: eventWhen(e.base)),
                    const SizedBox(height: 4),
                    IconLine(icon: Icons.place_outlined, text: e.venue, maxLines: 2),
                    const Spacer(),
                    Text(eventCta(e),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppType.body(13.5, weight: FontWeight.w700, color: AppColors.brand)),
                    const SizedBox(height: 8),
                    PillButton(label: 'View details', onPressed: onTap, dense: true),
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

/// Compact card for the horizontal "Happening now" row.
class LiveEventTile extends StatelessWidget {
  final PublicEvent event;
  final VoidCallback onTap;
  const LiveEventTile({super.key, required this.event, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 260,
      child: Material(
        color: AppColors.ink900,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Stack(
            fit: StackFit.expand,
            children: [
              NetImage(url: event.bannerUrl, icon: categoryIcon(event.category)),
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Color(0x00000000), Color(0xCC110D17)],
                    stops: [0.25, 1],
                  ),
                ),
              ),
              const Positioned(left: 12, top: 12, child: GlassChip('Live now', dot: Color(0xFF4ADE80))),
              Positioned(
                left: 14,
                right: 14,
                bottom: 12,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(event.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppType.heading(17, color: Colors.white)),
                    const SizedBox(height: 2),
                    Text(event.venue,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppType.body(12, color: Colors.white.withValues(alpha: 0.8))),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The signature ticket pass for a saved pass.
TicketPass passWidget(StoredPass p, {Color notchColor = AppColors.background}) {
  final phase = p.phase;
  final (label, tone) = p.status == 'valid'
      ? switch (phase) {
          EventPhase.live => ('Live now', Tone.success),
          EventPhase.ended => ('Event ended', Tone.neutral),
          EventPhase.cancelled => ('Event cancelled', Tone.danger),
          _ => ('Registered', Tone.brand),
        }
      : (TicketStatus.label(p.status), TicketStatus.tone(p.status));
  return TicketPass(
    eventTitle: p.eventTitle,
    eventSubtitle: [if (p.eventVenue.isNotEmpty) p.eventVenue, eventWhen(p.event)].join(' · '),
    attendeeName: p.attendeeName.isEmpty ? 'Attendee' : p.attendeeName,
    ticketCode: p.ticketNumber,
    qrData: p.qrToken,
    statusLabel: label,
    statusTone: tone,
    notchColor: notchColor,
    landscape: p.isLandscape,
    fields: [
      if (p.bibNumber.isNotEmpty && p.bibNumber != 'null') PassField('Bib', p.bibNumber),
      if (p.seatNumber.isNotEmpty) PassField('Seat', p.seatNumber),
      ...ticketTypeFields(p.ticketType),
      if (p.attendeeEmail.isNotEmpty) PassField('Email', p.attendeeEmail),
      if (p.event.startsAt != null) PassField('Date', Fmt.date(p.startDate)),
    ],
  );
}
