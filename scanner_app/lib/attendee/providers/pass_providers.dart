import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/event_model.dart';
import '../../providers/auth_provider.dart';
import '../data/pass_store.dart';
import '../models/stored_pass.dart';
import 'explore_providers.dart';

/// All passes for the Tickets tab and My Pass: those saved on this device,
/// merged with the signed-in account's tickets once `GET /api/me/tickets/`
/// exists (see [PassesNotifier.refresh]).
class PassesNotifier extends StateNotifier<AsyncValue<List<StoredPass>>> {
  PassesNotifier(this._ref) : super(const AsyncValue.loading()) {
    refresh();
  }

  final Ref _ref;

  /// Loads passes saved on this phone, then (signed in with a verified
  /// email) the account's tickets from `GET /api/me/tickets/`, merged into
  /// the local store so they also open offline. Signed out: the account's
  /// tickets are removed from this phone; device passes stay.
  Future<void> refresh() async {
    final user = _ref.read(authProvider).user;
    if (user == null) {
      final local = await PassStore.removeAccountPasses();
      if (mounted) state = AsyncValue.data(local);
      return;
    }
    final local = await PassStore.load();
    if (mounted) state = AsyncValue.data(local);
    // Tickets are linked to the account only once the email is verified.
    if (!user.emailVerified) return;
    try {
      final remote = await _ref.read(attendeeApiProvider).myTickets();
      final merged = await PassStore.replaceAccountPasses(remote);
      if (mounted) state = AsyncValue.data(merged);
    } catch (e) {
      debugPrint('PassesNotifier.refresh (account tickets): $e');
    }
  }

  Future<void> save(StoredPass pass) => saveAll([pass]);

  /// Saves every pass of a registration (buyer's and guests').
  Future<void> saveAll(List<StoredPass> passes) async {
    final all = await PassStore.upsertAll(passes);
    if (mounted) state = AsyncValue.data(all);
  }

  Future<void> remove(StoredPass pass) async {
    final all = await PassStore.remove(pass.key);
    if (mounted) state = AsyncValue.data(all);
  }
}

final passesProvider = StateNotifierProvider<PassesNotifier, AsyncValue<List<StoredPass>>>((ref) {
  ref.watch(authProvider.select((s) => s.user?.id)); // reload account tickets on sign in / out
  return PassesNotifier(ref);
});

final _far = DateTime(9999);

/// Within one event: passes of the same order together, in the order they
/// were saved, the buyer's first and then guests (ticket 2, 3…).
List<StoredPass> _sortWithinEvents(List<StoredPass> list, int Function(StoredPass a, StoredPass b) byEvent) {
  final firstSeen = <String, int>{};
  for (var i = 0; i < list.length; i++) {
    firstSeen.putIfAbsent(list[i].groupKey, () => i);
  }
  final sorted = [...list];
  sorted.sort((a, b) {
    final e = byEvent(a, b);
    if (e != 0) return e;
    final s = a.eventSlug.compareTo(b.eventSlug);
    if (s != 0) return s;
    final g = firstSeen[a.groupKey]!.compareTo(firstSeen[b.groupKey]!);
    if (g != 0) return g;
    return a.guestNumber.compareTo(b.guestNumber);
  });
  return sorted;
}

/// Live and upcoming passes, soonest first (live ones on top). Several
/// passes for one event follow each other, the buyer's first.
final upcomingPassesProvider = Provider<List<StoredPass>>((ref) {
  final all = ref.watch(passesProvider).valueOrNull ?? const [];
  return _sortWithinEvents(all.where((p) => !p.isPast).toList(), (a, b) {
    final la = a.phase == EventPhase.live ? 0 : 1, lb = b.phase == EventPhase.live ? 0 : 1;
    if (la != lb) return la.compareTo(lb);
    return (a.event.startsAt ?? _far).compareTo(b.event.startsAt ?? _far);
  });
});

/// Ended / cancelled passes, most recent first.
final pastPassesProvider = Provider<List<StoredPass>>((ref) {
  final all = ref.watch(passesProvider).valueOrNull ?? const [];
  return _sortWithinEvents(
    all.where((p) => p.isPast).toList(),
    (a, b) => (b.event.startsAt ?? DateTime(0)).compareTo(a.event.startsAt ?? DateTime(0)),
  );
});

/// The pass for the event happening now, else the next one. Null when none.
final nextPassProvider = Provider<StoredPass?>((ref) {
  final list = ref.watch(upcomingPassesProvider);
  return list.isEmpty ? null : list.first;
});

/// Every saved (not cancelled) pass for an event, the buyer's own first and
/// then their guests', grouped by order.
final passesForEventProvider = Provider.family<List<StoredPass>, String>((ref, slug) {
  final all = ref.watch(passesProvider).valueOrNull ?? const [];
  final list = all.where((p) => p.eventSlug == slug && p.status != 'cancelled').toList();
  return _sortWithinEvents(list, (a, b) => 0);
});

/// The saved pass for an event (by slug): the buyer's own when there are
/// several. Used for "You're going" and to vote with your ticket.
final passForEventProvider = Provider.family<StoredPass?, String>((ref, slug) {
  return ref.watch(passesForEventProvider(slug)).firstOrNull;
});

/// Signed in but the email isn't verified: account tickets can't be shown yet.
final needsEmailVerificationProvider = Provider<bool>((ref) {
  final user = ref.watch(authProvider).user;
  return user != null && !user.emailVerified;
});
