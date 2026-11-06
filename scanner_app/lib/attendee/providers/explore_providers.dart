import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/attendee_api.dart';
import '../models/public_event.dart';

final attendeeApiProvider = Provider<AttendeeApi>((ref) => AttendeeApi());

/// Public events for Explore. Key: `(when: 'upcoming' | 'past', search: '')`.
final publicEventsProvider =
    FutureProvider.family<List<PublicEvent>, ({String when, String search})>((ref, q) {
  return ref.watch(attendeeApiProvider).events(when: q.when, search: q.search);
});

/// Event page (event + registration form).
final eventDetailProvider = FutureProvider.autoDispose.family<EventDetail, String>((ref, slug) {
  return ref.watch(attendeeApiProvider).event(slug);
});

/// Quick polls and contests shown on an event page (public voting API).
final eventPollsProvider = FutureProvider.autoDispose.family<EventVoting, String>((ref, slug) {
  return ref.watch(attendeeApiProvider).voting(slug);
});
