import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/marketplace.dart';
import 'explore_providers.dart';

final vendorCategoriesProvider = FutureProvider<List<VendorCategory>>((ref) {
  return ref.watch(attendeeApiProvider).vendorCategories();
});

/// Vendors, optionally filtered by category slug ('' = all).
final vendorsProvider = FutureProvider.family<List<Vendor>, String>((ref, category) {
  return ref.watch(attendeeApiProvider).vendors(category: category);
});

/// Venues, optionally filtered by venue type ('' = all).
final venuesProvider = FutureProvider.family<List<Venue>, String>((ref, type) {
  return ref.watch(attendeeApiProvider).venues(type: type);
});

final vendorDetailProvider = FutureProvider.autoDispose.family<Vendor, String>((ref, id) {
  return ref.watch(attendeeApiProvider).vendor(id);
});

final venueDetailProvider = FutureProvider.autoDispose.family<Venue, String>((ref, id) {
  return ref.watch(attendeeApiProvider).venue(id);
});

/// Packages of a listing: key is ('vendor' | 'venue', id). Empty when the module is off or the call fails.
final packagesProvider = FutureProvider.autoDispose.family<List<ServicePackage>, (String, String)>((ref, key) async {
  final (kind, id) = key;
  try {
    return await ref
        .watch(attendeeApiProvider)
        .packages(vendorId: kind == 'vendor' ? id : null, venueId: kind == 'venue' ? id : null);
  } catch (_) {
    return const [];
  }
});
