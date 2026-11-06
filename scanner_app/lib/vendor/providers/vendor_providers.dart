import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';
import '../../providers/auth_provider.dart';
import '../../providers/modules_provider.dart';
import '../data/vendor_api.dart';
import '../data/vendor_models.dart';

/// Runs [load]; a 403 `module_disabled` answer switches the module off in the
/// UI (the shell then shows the "turned off" state).
Future<T> _guarded<T>(Ref ref, Future<T> Function() load) async {
  try {
    return await load();
  } catch (e) {
    final slug = ApiClient.disabledModule(e);
    if (slug != null) {
      final current = ref.read(disabledModulesProvider);
      if (!current.contains(slug)) ref.read(disabledModulesProvider.notifier).state = {...current, slug};
    }
    rethrow;
  }
}

/// Whether the marketplace module is on for the signed-in user.
final vendorMarketplaceEnabledProvider =
    Provider<bool>((ref) => ref.watch(moduleEnabledProvider(AppModule.marketplace)));

/// The owner's venue listings and vendor profiles.
final myListingsProvider = FutureProvider<List<OwnerListing>>((ref) {
  ref.watch(authProvider.select((s) => s.user?.id));
  return _guarded(ref, () => ref.watch(vendorApiProvider).myListings());
});

/// All spaces of a venue (paused included).
final venueSpacesProvider = FutureProvider.autoDispose.family<List<OwnerSpace>, String>((ref, venueId) {
  return _guarded(ref, () => ref.watch(vendorApiProvider).venueSpaces(venueId));
});

/// Every venue + service request, newest first.
final vendorRequestsProvider = FutureProvider<List<BookingRequest>>((ref) {
  ref.watch(authProvider.select((s) => s.user?.id));
  return _guarded(ref, () => ref.watch(vendorApiProvider).requests());
});

/// Requests waiting for the owner (new or contacted) — the Requests tab badge.
final pendingRequestCountProvider = Provider<int>((ref) {
  final list = ref.watch(vendorRequestsProvider).valueOrNull ?? const [];
  return list.where((r) => r.status == RequestStatus.pending).length;
});

/// Slots for a listing / date range (calendar months, home counts).
final slotsProvider = FutureProvider.autoDispose.family<List<Slot>, SlotQuery>((ref, q) {
  return _guarded(ref, () => ref.watch(vendorApiProvider).slots(q));
});

/// Home: held and booked slots from today for 60 days.
final upcomingBookingsProvider = FutureProvider.autoDispose<List<Slot>>((ref) {
  final today = dayOf(DateTime.now());
  return _guarded(
    ref,
    () => ref.watch(vendorApiProvider).slots(SlotQuery(
          from: today,
          to: today.add(const Duration(days: 60)),
          status: '${SlotStatus.held},${SlotStatus.booked}',
        )),
  );
});

/// Home: open slots in the next 7 days (today included).
final openSlotsWeekProvider = FutureProvider.autoDispose<int>((ref) async {
  final today = dayOf(DateTime.now());
  final slots = await _guarded(
    ref,
    () => ref.watch(vendorApiProvider).slots(SlotQuery(
          from: today,
          to: today.add(const Duration(days: 6)),
          status: SlotStatus.open,
        )),
  );
  return slots.length;
});

/// The listing / space picked in the Calendar tab (null = first listing).
final calendarTargetProvider = StateProvider<CalendarTarget?>((ref) {
  ref.watch(authProvider.select((s) => s.user?.id));
  return null;
});

/// The calendar's target, falling back to the first listing.
final effectiveCalendarTargetProvider = Provider<CalendarTarget?>((ref) {
  final picked = ref.watch(calendarTargetProvider);
  final listings = ref.watch(myListingsProvider).valueOrNull ?? const <OwnerListing>[];
  if (picked != null && listings.any((l) => l.id == picked.listingId)) return picked;
  if (listings.isEmpty) return null;
  final first = listings.first;
  return CalendarTarget(first.kind, first.id);
});

extension VendorRefresh on WidgetRef {
  /// Refreshes requests, slots and home counts after a change.
  void refreshVendorData() {
    invalidate(vendorRequestsProvider);
    invalidate(slotsProvider);
    invalidate(upcomingBookingsProvider);
    invalidate(openSlotsWeekProvider);
  }
}
