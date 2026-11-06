import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';
import 'vendor_models.dart';

/// Error code from a 409 answer (`request_cancelled`, `slot_unavailable`,
/// `slot_locked`) or a 400 `slot_overlap`, if any.
String? vendorErrorCode(Object e) {
  if (e is! DioException) return null;
  final data = e.response?.data;
  if (data is! Map) return null;
  final code = data['code'];
  if (code is String) return code;
  if (code is List && code.isNotEmpty) return code.first.toString();
  return null;
}

/// Readable message for a failed vendor call, with friendlier copy for the
/// booking conflicts.
String vendorErrorMessage(Object e) {
  if (e is! DioException) return 'Something went wrong. Please try again.';
  final api = ApiClient();
  final data = e.response?.data;
  if (data is Map) {
    final nfe = data['non_field_errors'];
    if (nfe is List && nfe.isNotEmpty) return nfe.first.toString();
  }
  switch (vendorErrorCode(e)) {
    case 'slot_locked':
      return 'This slot has a booking request. Decline it (or wait for the customer to cancel) before changing or '
          'deleting the slot — only the note can change.';
    case 'request_cancelled':
      return 'The customer already cancelled this request.';
    case 'slot_unavailable':
      return 'This slot has been taken by another booking.';
    case 'listing_paused':
      return 'This listing is paused and not taking requests right now.';
  }
  return api.errorMessage(e);
}

/// Business portal API (`/api/marketplace/my/...`, module `marketplace`).
class VendorApi {
  VendorApi([ApiClient? client]) : _api = client ?? ApiClient();
  final ApiClient _api;

  static Map<String, dynamic> _m(dynamic d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{};

  static List<Map<String, dynamic>> _list(dynamic d) => [
        if (d is List)
          for (final x in d)
            if (x is Map) Map<String, dynamic>.from(x),
        if (d is Map && d['results'] is List)
          for (final x in d['results'] as List)
            if (x is Map) Map<String, dynamic>.from(x),
      ];

  // --- Listings -------------------------------------------------------------

  /// The owner's listings. Venues carry every space, paused ones included
  /// (`my/listings` only lists active spaces), so the calendar can manage them.
  Future<List<OwnerListing>> myListings() async {
    final data = _m((await _api.get('/api/marketplace/my/listings/')).data);
    final venues = [for (final v in _list(data['venues'])) OwnerListing.venue(v)];
    final withAllSpaces = await Future.wait([
      for (final v in venues) venueSpaces(v.id).then(v.withSpaces, onError: (Object _) => v),
    ]);
    return [
      ...withAllSpaces,
      for (final v in _list(data['vendor_profiles'])) OwnerListing.vendor(v),
    ];
  }

  /// PATCH the owner's listing (`venues/<id>/` or `vendors/<id>/`): details or `is_paused`.
  /// Returns the saved listing as JSON.
  Future<Map<String, dynamic>> updateListing(OwnerListing l, Map<String, dynamic> changes) async {
    final resp = await _api.patch(
      l.kind == ListingKind.venue ? '/api/marketplace/venues/${l.id}/' : '/api/marketplace/vendors/${l.id}/',
      data: changes,
    );
    return _m(resp.data);
  }

  /// Pause / resume the whole listing (hidden from browse, no new requests).
  Future<void> setListingPaused(OwnerListing l, bool paused) => updateListing(l, {'is_paused': paused});

  /// Service categories for the vendor edit form: `[{id, name}]`.
  Future<List<({String id, String name})>> vendorCategories() async {
    final resp = await _api.get('/api/marketplace/categories/');
    return [
      for (final c in _list(resp.data)) (id: c['id']?.toString() ?? '', name: c['name']?.toString() ?? ''),
    ];
  }

  /// Every space of a venue, paused ones included (owner view).
  Future<List<OwnerSpace>> venueSpaces(String venueId) async {
    final resp = await _api.get('/api/marketplace/venues/$venueId/spaces/');
    return [for (final s in _list(resp.data)) OwnerSpace.fromJson(s)];
  }

  /// Pause / resume bookings for one space.
  Future<OwnerSpace> setSpaceActive(String venueId, String spaceId, bool active) async {
    final resp = await _api.patch('/api/marketplace/venues/$venueId/spaces/$spaceId/', data: {'is_active': active});
    return OwnerSpace.fromJson(_m(resp.data));
  }

  // --- Requests -------------------------------------------------------------

  /// Venue and service requests together, newest first.
  Future<List<BookingRequest>> requests() async {
    final results = await Future.wait([
      _api.get(ListingKind.venue.inquiriesPath),
      _api.get(ListingKind.vendor.inquiriesPath),
    ]);
    final list = [
      for (final j in _list(results[0].data)) BookingRequest.fromJson(j, ListingKind.venue),
      for (final j in _list(results[1].data)) BookingRequest.fromJson(j, ListingKind.vendor),
    ];
    list.sort((a, b) => (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
    return list;
  }

  /// `confirm` → booked, `decline` → rejected. 409 `request_cancelled` / `slot_unavailable`.
  Future<BookingRequest> decide(BookingRequest r, {required bool confirm, String? note}) async {
    final resp = await _api.post(
      '${r.kind.inquiriesPath}${r.id}/${confirm ? 'confirm' : 'decline'}/',
      data: {if (note != null && note.trim().isNotEmpty) 'note': note.trim()},
    );
    return BookingRequest.fromJson(_m(resp.data), r.kind);
  }

  Future<BookingRequest> setStatus(BookingRequest r, String status) async {
    final resp = await _api.patch('${r.kind.inquiriesPath}${r.id}/', data: {'status': status});
    return BookingRequest.fromJson(_m(resp.data), r.kind);
  }

  // --- Slots ----------------------------------------------------------------

  Future<List<Slot>> slots(SlotQuery q) async {
    final t = q.target;
    final resp = await _api.get('/api/marketplace/my/slots/', queryParameters: {
      if (t != null) t.kind.key: t.listingId,
      if (t?.spaceId != null) 'space': t!.spaceId,
      'from': apiDate(q.from),
      'to': apiDate(q.to),
      if (q.status != null) 'status': q.status,
    });
    return [for (final s in _list(resp.data)) Slot.fromJson(s)];
  }

  static Map<String, dynamic> _target(CalendarTarget t) => {
        t.kind.key: t.listingId,
        if (t.spaceId != null) 'space': t.spaceId,
      };

  static Map<String, dynamic> _times(String? start, String? end) => {'start_time': start, 'end_time': end};

  Future<Slot> createSlot(
    CalendarTarget t, {
    required DateTime date,
    String? start,
    String? end,
    double? price,
    String note = '',
    String status = SlotStatus.open,
  }) async {
    final resp = await _api.post('/api/marketplace/my/slots/', data: {
      ..._target(t),
      'date': apiDate(date),
      ..._times(start, end),
      if (price != null) 'price': price.toStringAsFixed(2),
      'note': note,
      'status': status,
    });
    return Slot.fromJson(_m(resp.data));
  }

  /// PATCH a slot; held / booked slots only accept `note` (else 409 `slot_locked`).
  Future<Slot> updateSlot(String id, Map<String, dynamic> changes) async {
    final resp = await _api.patch('/api/marketplace/my/slots/$id/', data: changes);
    return Slot.fromJson(_m(resp.data));
  }

  Future<void> deleteSlot(String id) => _api.delete('/api/marketplace/my/slots/$id/');

  /// [weekdays]: 0 = Monday … 6 = Sunday (the API's numbering).
  Future<BulkResult> bulkSlots(
    CalendarTarget t, {
    required DateTime from,
    required DateTime to,
    List<int>? weekdays,
    String? start,
    String? end,
    double? price,
    String note = '',
  }) async {
    final resp = await _api.post('/api/marketplace/my/slots/bulk/', data: {
      ..._target(t),
      'start_date': apiDate(from),
      'end_date': apiDate(to),
      if (weekdays != null && weekdays.isNotEmpty && weekdays.length < 7) 'weekdays': weekdays,
      ..._times(start, end),
      if (price != null) 'price': price.toStringAsFixed(2),
      'note': note,
    });
    final d = _m(resp.data);
    return BulkResult(
      int.tryParse('${d['created']}') ?? 0,
      int.tryParse('${d['skipped']}') ?? 0,
      [
        if (d['skipped_dates'] is List)
          for (final x in d['skipped_dates'] as List) x.toString()
      ],
    );
  }

  Future<BlockResult> blockDates(CalendarTarget t, List<DateTime> dates, {String note = ''}) async {
    final resp = await _api.post('/api/marketplace/my/slots/block/', data: {
      ..._target(t),
      'dates': [for (final d in dates) apiDate(d)],
      'note': note,
    });
    final d = _m(resp.data);
    return BlockResult(
      int.tryParse('${d['created']}') ?? 0,
      int.tryParse('${d['blocked']}') ?? 0,
      d['skipped'] is List ? (d['skipped'] as List).length : 0,
    );
  }
}

final vendorApiProvider = Provider<VendorApi>((ref) => VendorApi());
