import 'package:clock/clock.dart';

/// Where an event is in its lifecycle. Computed by the server in Nepal time.
enum EventPhase { draft, upcoming, live, ended, cancelled }

class EventModel {
  final String id;
  final String title;
  final String slug;

  /// Start date, "2026-11-02".
  final String? date;
  final String venue;
  final int capacity;
  final String? description;
  final String? coverImageUrl;

  /// 'draft' / 'published' / 'ongoing' / 'completed' / 'cancelled'.
  final String? status;

  /// Phase as sent by the server ('upcoming', 'live'…); null on older servers.
  final String? serverPhase;
  final String? startTime;
  final String? endDate;
  final String? endTime;
  final bool registrationOpen;
  final String? registrationClosedReason;

  EventModel({
    required this.id,
    required this.title,
    required this.slug,
    this.date,
    required this.venue,
    required this.capacity,
    this.description,
    this.coverImageUrl,
    this.status,
    this.serverPhase,
    this.startTime,
    this.endDate,
    this.endTime,
    this.registrationOpen = true,
    this.registrationClosedReason,
  });

  factory EventModel.fromJson(Map<String, dynamic> json) {
    String? str(String k) {
      final v = json[k]?.toString().trim();
      return (v == null || v.isEmpty) ? null : v;
    }

    return EventModel(
      id: json['id']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      date: str('start_date') ?? str('date'),
      venue: json['location']?.toString() ?? json['venue']?.toString() ?? 'Main Venue',
      capacity: (json['capacity'] is int)
          ? json['capacity'] as int
          : int.tryParse(json['capacity']?.toString() ?? '0') ?? 0,
      description: json['description']?.toString(),
      coverImageUrl: json['banner']?.toString() ?? json['cover_image']?.toString(),
      status: str('status'),
      serverPhase: str('phase'),
      startTime: str('start_time'),
      endDate: str('end_date'),
      endTime: str('end_time'),
      registrationOpen: json['registration_open'] != false,
      registrationClosedReason: str('registration_closed_reason'),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'slug': slug,
        'date': date,
        'venue': venue,
        'capacity': capacity,
        'description': description,
        'status': status,
        'phase': serverPhase,
        'start_time': startTime,
        'end_date': endDate,
        'end_time': endTime,
        'registration_open': registrationOpen,
        'registration_closed_reason': registrationClosedReason,
      };

  static DateTime? _day(String? iso) {
    final d = iso == null ? null : DateTime.tryParse(iso);
    return d == null ? null : DateTime(d.year, d.month, d.day);
  }

  static DateTime _at(DateTime day, String? time) {
    final p = (time ?? '').split(':');
    final h = int.tryParse(p.isNotEmpty ? p[0] : '') ?? 0;
    final m = int.tryParse(p.length > 1 ? p[1] : '') ?? 0;
    return DateTime(day.year, day.month, day.day, h, m);
  }

  /// First day of the event (local date), if known.
  DateTime? get startDay => _day(date);

  /// Last day of the event (local date), if known.
  DateTime? get lastDay => _day(endDate) ?? startDay;

  /// Start date and time, local.
  DateTime? get startsAt {
    final d = startDay;
    return d == null ? null : _at(d, startTime);
  }

  /// End of the event; without an end time, midnight after its last day.
  DateTime? get endsAt {
    final d = lastDay;
    if (d == null) return null;
    return endTime == null ? DateTime(d.year, d.month, d.day + 1) : _at(d, endTime);
  }

  /// Current phase: the server's value, moved forward by the clock so a
  /// long-open app still sees upcoming → live → ended. Older servers without
  /// `phase` fall back to status and dates.
  EventPhase phaseAt(DateTime now) {
    final base = switch (serverPhase) {
      'draft' => EventPhase.draft,
      'cancelled' => EventPhase.cancelled,
      'ended' => EventPhase.ended,
      'live' => EventPhase.live,
      'upcoming' => EventPhase.upcoming,
      _ => switch (status) {
          'draft' => EventPhase.draft,
          'cancelled' => EventPhase.cancelled,
          'completed' => EventPhase.ended,
          'ongoing' => EventPhase.live,
          _ => EventPhase.upcoming,
        },
    };
    if (base != EventPhase.upcoming && base != EventPhase.live) return base;
    final end = endsAt, start = startsAt;
    if (end != null && !now.isBefore(end)) return EventPhase.ended;
    if (base == EventPhase.upcoming && start != null && !now.isBefore(start)) return EventPhase.live;
    // Legacy servers: no status hint and no start date means we can't tell.
    if (serverPhase == null && start == null) return EventPhase.live;
    return base;
  }

  EventPhase get phase => phaseAt(clock.now());

  /// Whether the server will refuse gate scans today, mirroring its rules:
  /// cancelled; more than a day before the start date; or more than a day
  /// after the last day (or marked completed).
  ScanWindow scanWindowAt(DateTime now) {
    final today = DateTime(now.year, now.month, now.day);
    if (phaseAt(now) == EventPhase.cancelled) return ScanWindow.cancelled;
    final start = startDay, last = lastDay;
    if (start != null && today.isBefore(DateTime(start.year, start.month, start.day - 1))) {
      return ScanWindow.tooEarly;
    }
    if (status == 'completed' || (last != null && today.isAfter(DateTime(last.year, last.month, last.day + 1)))) {
      return ScanWindow.closed;
    }
    return ScanWindow.open;
  }

  ScanWindow get scanWindow => scanWindowAt(clock.now());

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is EventModel && runtimeType == other.runtimeType && id == other.id;

  @override
  int get hashCode => id.hashCode;
}

enum ScanWindow { open, tooEarly, closed, cancelled }

/// Orders events live → upcoming (soonest first) → draft → ended/cancelled (most recent first).
List<EventModel> sortEventsByPhase(List<EventModel> events, [DateTime? now]) {
  final t = now ?? clock.now();
  int rank(EventModel e) => switch (e.phaseAt(t)) {
        EventPhase.live => 0,
        EventPhase.upcoming => 1,
        EventPhase.draft => 2,
        EventPhase.ended => 3,
        EventPhase.cancelled => 4,
      };
  final far = DateTime(9999);
  final sorted = [...events];
  sorted.sort((a, b) {
    final r = rank(a).compareTo(rank(b));
    if (r != 0) return r;
    final sa = a.startsAt ?? far, sb = b.startsAt ?? far;
    // Past events: most recent first. Others: soonest first.
    return rank(a) >= 3 ? sb.compareTo(sa) : sa.compareTo(sb);
  });
  return sorted;
}

/// The event to open by default: live, else the next upcoming, else the most recent.
EventModel? defaultEvent(List<EventModel> events) {
  if (events.isEmpty) return null;
  final sorted = sortEventsByPhase(events);
  final now = clock.now();
  final firstActive = sorted.where((e) {
    final p = e.phaseAt(now);
    return p == EventPhase.live || p == EventPhase.upcoming;
  }).firstOrNull;
  if (firstActive != null) return firstActive;
  // Most recent past event (ended before cancelled/draft is fine here).
  final past = sorted.where((e) => e.phaseAt(now) == EventPhase.ended).firstOrNull;
  return past ?? sorted.first;
}
