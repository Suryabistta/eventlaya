import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../core/api_client.dart';
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

IconData categoryIcon(String? category) => switch (category) {
      'conference' => Icons.mic_external_on_rounded,
      'hackathon' => Icons.code_rounded,
      'concert' => Icons.music_note_rounded,
      'festival' => Icons.celebration_rounded,
      'workshop' => Icons.handyman_rounded,
      'sports' => Icons.sports_soccer_rounded,
      'wedding' => Icons.favorite_rounded,
      'meetup' => Icons.groups_rounded,
      _ => Icons.event_rounded,
    };

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
          Text(label, style: AppType.body(12, weight: FontWeight.w600, color: Colors.white, height: 1.2)),
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

/// Large event card for lists: banner, phase, title, when, where, price.
class EventCard extends StatelessWidget {
  final PublicEvent event;
  final VoidCallback onTap;
  const EventCard({super.key, required this.event, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final e = event;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadius.xl),
              border: Border.all(color: AppColors.ink200.withValues(alpha: 0.7), width: 0.5),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AspectRatio(
                  aspectRatio: 16 / 8,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      NetImage(url: e.bannerUrl, icon: categoryIcon(e.category)),
                      Positioned(left: 12, top: 12, child: EventPhaseChip(e.base)),
                      if (e.category != null && e.category != 'other')
                        Positioned(right: 12, top: 12, child: GlassChip(EventCategories.label(e.category))),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(eventWhen(e.base).toUpperCase(),
                          style: AppType.body(12, weight: FontWeight.w600, color: AppColors.brand, height: 1.2)),
                      const SizedBox(height: 6),
                      Text(e.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.heading(19)),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          const Icon(Icons.place_outlined, size: 15, color: AppColors.ink400),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(e.venue,
                                maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.rowSubtitle),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            e.isFull ? 'Fully booked' : e.priceSummary,
                            style: AppType.body(13,
                                weight: FontWeight.w600, color: e.isFull ? AppColors.ink500 : AppColors.textPrimary),
                          ),
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
    fields: [
      ...ticketTypeFields(p.ticketType),
      if (p.attendeeEmail.isNotEmpty) PassField('Email', p.attendeeEmail),
      if (p.event.startsAt != null) PassField('Date', Fmt.date(p.startDate)),
    ],
  );
}
