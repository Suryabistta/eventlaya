import 'package:clock/clock.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../models/event_model.dart';
import '../../ui/ui.dart';

/// Plain-language lifecycle copy shared by the home hero, pickers and scanner.
class PhaseCopy {
  PhaseCopy._();

  static Tone tone(EventPhase p) => switch (p) {
        EventPhase.live => Tone.success,
        EventPhase.upcoming => Tone.brand,
        EventPhase.ended => Tone.neutral,
        EventPhase.cancelled => Tone.danger,
        EventPhase.draft => Tone.warning,
      };

  /// "Live", "Today 16:00", "Tomorrow", "In 3 days", "Ended", "Cancelled", "Draft".
  static String label(EventModel e, [DateTime? now]) {
    final t = now ?? clock.now();
    final p = e.phaseAt(t);
    return switch (p) {
      EventPhase.live => 'Live',
      EventPhase.ended => 'Ended',
      EventPhase.cancelled => 'Cancelled',
      EventPhase.draft => 'Draft',
      EventPhase.upcoming => startsIn(e, t, short: true),
    };
  }

  /// When an upcoming event starts: "Today 16:00", "Tomorrow 16:00",
  /// "Starts in 3 days" (or "In 3 days" when [short]), "Starts 2 Nov".
  static String startsIn(EventModel e, DateTime now, {bool short = false}) {
    final start = e.startsAt;
    if (start == null) return 'Upcoming';
    final today = DateTime(now.year, now.month, now.day);
    final days = DateTime(start.year, start.month, start.day).difference(today).inDays;
    final hasTime = e.startTime != null;
    final time = hasTime ? ' ${DateFormat('HH:mm').format(start)}' : '';
    if (days <= 0) return hasTime ? 'Today$time' : 'Today';
    if (days == 1) return short ? 'Tomorrow' : 'Tomorrow$time';
    if (days <= 30) return short ? 'In $days days' : 'Starts in $days days';
    return '${short ? '' : 'Starts '}${DateFormat('d MMM').format(start)}'.trim();
  }

  /// Calm notice for the scanner when the server will refuse scans (or the
  /// event is over), else null.
  static String? scanNotice(EventModel e, [DateTime? now]) {
    final t = now ?? clock.now();
    final day = DateFormat('EEE d MMM');
    switch (e.scanWindowAt(t)) {
      case ScanWindow.cancelled:
        return 'This event was cancelled. Scans will be refused.';
      case ScanWindow.closed:
        return 'This event has ended. Scans will be refused.';
      case ScanWindow.tooEarly:
        final s = e.startDay;
        return s == null
            ? 'This event hasn\'t started yet. Scans will be refused until the day before.'
            : 'Too early to scan. Gates open on ${day.format(DateTime(s.year, s.month, s.day - 1))}.';
      case ScanWindow.open:
        if (e.phaseAt(t) == EventPhase.ended) {
          final last = e.lastDay;
          return last == null
              ? 'This event has ended.'
              : 'This event has ended. Late scans are accepted until ${day.format(DateTime(last.year, last.month, last.day + 1))}.';
        }
        return null;
    }
  }
}

/// Small pill with the event's phase, e.g. "Live" or "In 3 days".
class PhaseBadge extends StatelessWidget {
  final EventModel event;
  const PhaseBadge(this.event, {super.key});

  @override
  Widget build(BuildContext context) {
    final p = event.phase;
    return StatusBadge(PhaseCopy.label(event), tone: PhaseCopy.tone(p), dot: p == EventPhase.live);
  }
}

/// Calm banner telling staff the server will refuse scans for this event.
/// Renders nothing while scanning is open.
class ScanWindowNotice extends StatelessWidget {
  final EventModel event;
  final EdgeInsetsGeometry padding;
  const ScanWindowNotice(this.event, {super.key, this.padding = EdgeInsets.zero});

  @override
  Widget build(BuildContext context) {
    final text = PhaseCopy.scanNotice(event);
    if (text == null) return const SizedBox.shrink();
    final window = event.scanWindow;
    final tone = window == ScanWindow.cancelled ? Tone.danger : Tone.warning;
    final icon = switch (window) {
      ScanWindow.tooEarly => Icons.schedule_rounded,
      ScanWindow.cancelled => Icons.event_busy_rounded,
      _ => Icons.event_available_outlined,
    };
    return Padding(
      padding: padding,
      child: Semantics(
        liveRegion: true,
        child: Container(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          constraints: const BoxConstraints(minHeight: 48),
          decoration: BoxDecoration(
            color: tone.tint,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: tone.color.withValues(alpha: 0.35), width: 0.5),
          ),
          child: Row(
            children: [
              Icon(icon, size: 18, color: tone.strong),
              const SizedBox(width: 8),
              Expanded(
                child: Text(text, style: AppType.body(13, weight: FontWeight.w500, color: AppColors.ink800)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
