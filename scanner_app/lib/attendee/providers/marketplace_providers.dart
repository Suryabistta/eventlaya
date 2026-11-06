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
