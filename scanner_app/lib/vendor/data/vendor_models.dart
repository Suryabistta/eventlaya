import 'package:intl/intl.dart';
import '../../core/media_url.dart';
import '../../models/ticket_type_model.dart' show formatRupees, parseMoney;

String? _s(Object? v) {
  final t = v?.toString().trim();
  return (t == null || t.isEmpty) ? null : t;
}

int? _int(Object? v) => v == null ? null : int.tryParse(v.toString());

double? _money(Object? v) => v == null ? null : parseMoney(v);

DateTime? _date(Object? v) => DateTime.tryParse(v?.toString() ?? '');

DateTime? _dateTime(Object? v) => DateTime.tryParse(v?.toString() ?? '')?.toLocal();

/// Midnight of [d] (local), for comparing calendar days.
DateTime dayOf(DateTime d) => DateTime(d.year, d.month, d.day);

/// `YYYY-MM-DD` as the API expects.
String apiDate(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

/// "Full day" or "09:00 – 13:00".
String slotTimeLabel(String? start, String? end) => (start == null || end == null) ? 'Full day' : '$start – $end';

/// Venue listing or service vendor profile.
enum ListingKind { venue, vendor }

extension ListingKindX on ListingKind {
  /// Query / body key (`venue` or `vendor`).
  String get key => this == ListingKind.venue ? 'venue' : 'vendor';
  String get label => this == ListingKind.venue ? 'Venue' : 'Service';

  /// Owner inquiry endpoints.
  String get inquiriesPath =>
      this == ListingKind.venue ? '/api/marketplace/my/inquiries/' : '/api/marketplace/my/vendor-inquiries/';

  static ListingKind parse(Object? v) => v?.toString() == 'vendor' ? ListingKind.vendor : ListingKind.venue;
}

/// Booking request / inquiry status.
class RequestStatus {
  RequestStatus._();
  static const pending = 'pending';
  static const contacted = 'contacted';
  static const booked = 'booked';
  static const rejected = 'rejected';
  static const cancelled = 'cancelled';

  /// Statuses that still hold the slot and wait for the owner.
  static bool isOpen(String s) => s == pending || s == contacted;

  static String label(String s) => switch (s) {
        pending => 'New',
        contacted => 'Contacted',
        booked => 'Booked',
        rejected => 'Declined',
        cancelled => 'Cancelled',
        _ => s.isEmpty ? 'Unknown' : s[0].toUpperCase() + s.substring(1),
      };
}

/// Availability slot status.
class SlotStatus {
  SlotStatus._();
  static const open = 'open';
  static const held = 'held';
  static const booked = 'booked';
  static const blocked = 'blocked';

  static String label(String s) => switch (s) {
        open => 'Open',
        held => 'Requested',
        booked => 'Booked',
        blocked => 'Blocked',
        _ => s,
      };

  /// Held / booked slots belong to a request: only the note can change.
  static bool isLocked(String s) => s == held || s == booked;
}

/// The slot a booking request points at (`slot` on an inquiry).
class SlotSummary {
  final String id;
  final DateTime? date;
  final String? startTime;
  final String? endTime;
  final bool isFullDay;
  final String? spaceId;
  final String? spaceName;
  final double? price;
  final String status;

  const SlotSummary({
    required this.id,
    this.date,
    this.startTime,
    this.endTime,
    this.isFullDay = true,
    this.spaceId,
    this.spaceName,
    this.price,
    this.status = SlotStatus.open,
  });

  String get timeLabel => slotTimeLabel(startTime, endTime);

  factory SlotSummary.fromJson(Map<String, dynamic> j) => SlotSummary(
        id: j['id']?.toString() ?? '',
        date: _date(j['date']),
        startTime: _s(j['start_time']),
        endTime: _s(j['end_time']),
        isFullDay: j['is_full_day'] == true || j['start_time'] == null,
        spaceId: _s(j['space_id']),
        spaceName: _s(j['space_name']),
        price: _money(j['price']),
        status: _s(j['status']) ?? SlotStatus.open,
      );
}

/// A venue inquiry or vendor inquiry as the owner sees it. With [slot] it is a
/// booking request for that slot.
class BookingRequest {
  final ListingKind kind;
  final String id;
  final String listingId;
  final String listingName;
  final String? spaceName;
  final String senderName;
  final String? senderEmail;
  final String? senderPhone;
  final String? eventType;
  final DateTime? eventDate;
  final int? guestCount;
  final String? budgetRange;
  final String message;
  final String status;
  final SlotSummary? slot;
  final String? ownerNote;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const BookingRequest({
    required this.kind,
    required this.id,
    this.listingId = '',
    this.listingName = '',
    this.spaceName,
    this.senderName = 'Customer',
    this.senderEmail,
    this.senderPhone,
    this.eventType,
    this.eventDate,
    this.guestCount,
    this.budgetRange,
    this.message = '',
    this.status = RequestStatus.pending,
    this.slot,
    this.ownerNote,
    this.createdAt,
    this.updatedAt,
  });

  bool get isBooking => slot != null;

  /// True when this copy is newer than [other] (local update not yet refetched).
  bool updatedAfter(BookingRequest other) =>
      updatedAt != null && other.updatedAt != null && updatedAt!.isAfter(other.updatedAt!);
  bool get isOpen => RequestStatus.isOpen(status);

  /// The day asked for: the slot's date, else the inquiry's event date.
  DateTime? get day => slot?.date ?? eventDate;

  factory BookingRequest.fromJson(Map<String, dynamic> j, ListingKind kind) {
    final slot = j['slot'] is Map ? SlotSummary.fromJson(Map<String, dynamic>.from(j['slot'] as Map)) : null;
    return BookingRequest(
      kind: kind,
      id: j['id']?.toString() ?? '',
      listingId: (kind == ListingKind.venue ? j['venue'] : j['vendor'])?.toString() ?? '',
      listingName: _s(kind == ListingKind.venue ? j['venue_name'] : j['vendor_name']) ?? '',
      spaceName: slot?.spaceName ?? _s(j['space_name']),
      senderName: _s(j['sender_name']) ?? 'Customer',
      senderEmail: _s(j['sender_email']),
      senderPhone: _s(j['sender_phone']),
      eventType: _s(j['event_type']),
      eventDate: _date(j['event_date']),
      guestCount: _int(j['guest_count']),
      budgetRange: _s(j['budget_range']),
      message: _s(j['message']) ?? '',
      status: _s(j['status']) ?? RequestStatus.pending,
      slot: slot,
      ownerNote: _s(j['owner_note']),
      createdAt: _dateTime(j['created_at']),
      updatedAt: _dateTime(j['updated_at']),
    );
  }
}

/// The request holding a held / booked slot (`request` on an owner slot).
class SlotRequest {
  final String id;
  final ListingKind kind;
  final String status;
  final String senderName;
  final String? senderEmail;
  final String? senderPhone;
  final String? eventType;
  final int? guestCount;
  final String? budgetRange;
  final String message;
  final String? ownerNote;
  final DateTime? createdAt;

  const SlotRequest({
    required this.id,
    required this.kind,
    required this.status,
    this.senderName = 'Customer',
    this.senderEmail,
    this.senderPhone,
    this.eventType,
    this.guestCount,
    this.budgetRange,
    this.message = '',
    this.ownerNote,
    this.createdAt,
  });

  factory SlotRequest.fromJson(Map<String, dynamic> j) => SlotRequest(
        id: j['id']?.toString() ?? '',
        kind: ListingKindX.parse(j['kind']),
        status: _s(j['status']) ?? RequestStatus.pending,
        senderName: _s(j['sender_name']) ?? 'Customer',
        senderEmail: _s(j['sender_email']),
        senderPhone: _s(j['sender_phone']),
        eventType: _s(j['event_type']),
        guestCount: _int(j['guest_count']),
        budgetRange: _s(j['budget_range']),
        message: _s(j['message']) ?? '',
        ownerNote: _s(j['owner_note']),
        createdAt: _dateTime(j['created_at']),
      );
}

/// An availability slot of one of the owner's listings.
class Slot {
  final String id;
  final ListingKind kind;
  final String listingId;
  final String listingName;
  final String? spaceId;
  final String? spaceName;
  final DateTime date;
  final String? startTime;
  final String? endTime;
  final bool isFullDay;
  final double? price;
  final double? effectivePrice;
  final String note;
  final String status;
  final SlotRequest? request;

  const Slot({
    required this.id,
    required this.kind,
    required this.listingId,
    this.listingName = '',
    this.spaceId,
    this.spaceName,
    required this.date,
    this.startTime,
    this.endTime,
    this.isFullDay = true,
    this.price,
    this.effectivePrice,
    this.note = '',
    this.status = SlotStatus.open,
    this.request,
  });

  String get timeLabel => slotTimeLabel(startTime, endTime);
  bool get isLocked => SlotStatus.isLocked(status);

  /// Sort key: full day first, then by start time.
  String get sortKey => '${apiDate(date)} ${startTime ?? '00:00'}';

  /// The holding request as a [BookingRequest] (for confirm / decline).
  BookingRequest? toRequest() {
    final r = request;
    if (r == null) return null;
    return BookingRequest(
      kind: kind,
      id: r.id,
      listingId: listingId,
      listingName: listingName,
      spaceName: spaceName,
      senderName: r.senderName,
      senderEmail: r.senderEmail,
      senderPhone: r.senderPhone,
      eventType: r.eventType,
      eventDate: date,
      guestCount: r.guestCount,
      budgetRange: r.budgetRange,
      message: r.message,
      status: r.status,
      ownerNote: r.ownerNote,
      createdAt: r.createdAt,
      slot: SlotSummary(
        id: id,
        date: date,
        startTime: startTime,
        endTime: endTime,
        isFullDay: isFullDay,
        spaceId: spaceId,
        spaceName: spaceName,
        price: effectivePrice,
        status: status,
      ),
    );
  }

  factory Slot.fromJson(Map<String, dynamic> j) {
    final kind = ListingKindX.parse(j['kind'] ?? (j['venue'] != null ? 'venue' : 'vendor'));
    return Slot(
      id: j['id']?.toString() ?? '',
      kind: kind,
      listingId: (kind == ListingKind.venue ? j['venue'] : j['vendor'])?.toString() ?? '',
      listingName: _s(j['listing_name']) ?? '',
      spaceId: _s(j['space']),
      spaceName: _s(j['space_name']),
      date: _date(j['date']) ?? DateTime.now(),
      startTime: _s(j['start_time']),
      endTime: _s(j['end_time']),
      isFullDay: j['is_full_day'] == true || j['start_time'] == null,
      price: _money(j['price']),
      effectivePrice: _money(j['effective_price']),
      note: _s(j['note']) ?? '',
      status: _s(j['status']) ?? SlotStatus.open,
      request: j['request'] is Map ? SlotRequest.fromJson(Map<String, dynamic>.from(j['request'] as Map)) : null,
    );
  }
}

/// Listing approval status.
class ListingStatus {
  ListingStatus._();
  static const pending = 'pending';
  static const approved = 'approved';
  static const rejected = 'rejected';

  static String label(String s) => switch (s) {
        approved => 'Live',
        rejected => 'Changes needed',
        _ => 'Waiting for approval',
      };
}

/// A hall / lawn inside a venue.
class OwnerSpace {
  final String id;
  final String name;
  final String type;
  final int seated;
  final int? standing;
  final double price;
  final bool isActive;

  const OwnerSpace({
    required this.id,
    required this.name,
    this.type = '',
    this.seated = 0,
    this.standing,
    this.price = 0,
    this.isActive = true,
  });

  String get capacityLabel => [
        if (seated > 0) '$seated seated',
        if ((standing ?? 0) > 0) '$standing standing',
      ].join(' · ');

  factory OwnerSpace.fromJson(Map<String, dynamic> j) => OwnerSpace(
        id: j['id']?.toString() ?? '',
        name: _s(j['name']) ?? 'Space',
        type: _s(j['space_type_display']) ?? _s(j['space_type']) ?? '',
        seated: _int(j['capacity_seated']) ?? 0,
        standing: _int(j['capacity_standing']),
        price: parseMoney(j['price_per_day']),
        isActive: j['is_active'] != false,
      );
}

/// One of the signed-in owner's venue listings or vendor profiles.
class OwnerListing {
  final ListingKind kind;
  final String id;
  final String name;
  final String? slug;

  /// Venue type or vendor category.
  final String typeLabel;
  final String city;
  final String? address;
  final String? phone;
  final String? email;
  final String status;
  final String? reviewNote;
  final String? image;
  final double? priceFrom;
  final int? capacityMin;
  final int? capacityMax;
  final double? rating;
  final int reviewTotal;
  final int inquiriesCount;
  final List<OwnerSpace> spaces;

  /// Paused by the owner: hidden from the directory, not taking new requests.
  final bool isPaused;

  /// The listing as the API sent it (the edit form starts from it).
  final Map<String, dynamic> json;

  const OwnerListing({
    required this.kind,
    required this.id,
    required this.name,
    this.slug,
    this.typeLabel = '',
    this.city = '',
    this.address,
    this.phone,
    this.email,
    this.status = ListingStatus.pending,
    this.reviewNote,
    this.image,
    this.priceFrom,
    this.capacityMin,
    this.capacityMax,
    this.rating,
    this.reviewTotal = 0,
    this.inquiriesCount = 0,
    this.spaces = const [],
    this.isPaused = false,
    this.json = const {},
  });

  bool get isApproved => status == ListingStatus.approved;

  OwnerListing withSpaces(List<OwnerSpace> all) => OwnerListing(
        kind: kind,
        id: id,
        name: name,
        slug: slug,
        typeLabel: typeLabel,
        city: city,
        address: address,
        phone: phone,
        email: email,
        status: status,
        reviewNote: reviewNote,
        image: image,
        priceFrom: priceFrom,
        capacityMin: capacityMin,
        capacityMax: capacityMax,
        rating: rating,
        reviewTotal: reviewTotal,
        inquiriesCount: inquiriesCount,
        spaces: all,
        isPaused: isPaused,
        json: json,
      );

  /// Public page on the website (`/marketplace/venues/<slug>`, `/marketplace/vendors/<id>`).
  String get publicUrl => kind == ListingKind.venue
      ? 'https://eventlaya.com/marketplace/venues/${slug ?? id}'
      : 'https://eventlaya.com/marketplace/vendors/$id';

  /// Edit page in the web business portal.
  String get editUrl => kind == ListingKind.venue
      ? 'https://eventlaya.com/app/listings/venues/${slug ?? id}/edit'
      : 'https://eventlaya.com/app/listings/vendor/$id/edit';

  String get priceLabel {
    final p = priceFrom;
    if (p == null || p <= 0) return '';
    return kind == ListingKind.venue ? 'From ${formatRupees(p)} / day' : 'From ${formatRupees(p)}';
  }

  factory OwnerListing.venue(Map<String, dynamic> j) => OwnerListing(
        kind: ListingKind.venue,
        id: j['id']?.toString() ?? '',
        name: _s(j['name']) ?? 'Venue',
        slug: _s(j['slug']),
        typeLabel: _s(j['venue_type_display']) ?? '',
        city: _s(j['city']) ?? '',
        address: _s(j['address']),
        phone: _s(j['contact_phone']),
        email: _s(j['contact_email']),
        status: _s(j['listing_status']) ?? ListingStatus.pending,
        reviewNote: _s(j['review_note']),
        image: (j['images'] is List && (j['images'] as List).isNotEmpty) ? mediaUrl((j['images'] as List).first) : null,
        priceFrom: _money(j['price_from'] ?? j['price_per_day']),
        capacityMin: _int(j['capacity_min']),
        capacityMax: _int(j['capacity_max']),
        rating: j['review_average'] == null ? null : double.tryParse(j['review_average'].toString()),
        reviewTotal: _int(j['review_total']) ?? 0,
        inquiriesCount: _int(j['inquiries_count']) ?? 0,
        spaces: [
          if (j['spaces'] is List)
            for (final s in j['spaces'] as List)
              if (s is Map) OwnerSpace.fromJson(Map<String, dynamic>.from(s)),
        ],
        isPaused: j['is_paused'] == true,
        json: j,
      );

  factory OwnerListing.vendor(Map<String, dynamic> j) => OwnerListing(
        kind: ListingKind.vendor,
        id: j['id']?.toString() ?? '',
        name: _s(j['business_name']) ?? 'My business',
        typeLabel: _s(j['category_name']) ?? '',
        city: _s(j['city']) ?? '',
        address: _s(j['address']),
        phone: _s(j['phone']),
        email: _s(j['email']),
        status: _s(j['listing_status']) ?? ListingStatus.pending,
        reviewNote: _s(j['review_note']),
        image: (j['portfolio_images'] is List && (j['portfolio_images'] as List).isNotEmpty)
            ? mediaUrl((j['portfolio_images'] as List).first)
            : null,
        priceFrom: _money(j['starting_price']),
        rating: j['review_average'] == null ? null : double.tryParse(j['review_average'].toString()),
        reviewTotal: _int(j['review_total']) ?? 0,
        isPaused: j['is_paused'] == true,
        json: j,
      );
}

/// Which listing (and venue space) the calendar shows.
class CalendarTarget {
  final ListingKind kind;
  final String listingId;

  /// Null = the whole venue (all spaces) / a vendor.
  final String? spaceId;
  const CalendarTarget(this.kind, this.listingId, [this.spaceId]);

  CalendarTarget withSpace(String? id) => CalendarTarget(kind, listingId, id);

  @override
  bool operator ==(Object other) =>
      other is CalendarTarget && other.kind == kind && other.listingId == listingId && other.spaceId == spaceId;

  @override
  int get hashCode => Object.hash(kind, listingId, spaceId);
}

/// Slots for [target] between [from] and [to] (inclusive).
class SlotQuery {
  final CalendarTarget? target;
  final DateTime from;
  final DateTime to;
  final String? status;
  const SlotQuery({this.target, required this.from, required this.to, this.status});

  @override
  bool operator ==(Object other) =>
      other is SlotQuery && other.target == target && other.from == from && other.to == to && other.status == status;

  @override
  int get hashCode => Object.hash(target, from, to, status);
}

/// `POST my/slots/bulk/` result.
class BulkResult {
  final int created;
  final int skipped;
  final List<String> skippedDates;
  const BulkResult(this.created, this.skipped, this.skippedDates);
}

/// `POST my/slots/block/` result.
class BlockResult {
  final int created;
  final int blocked;
  final int skipped;
  const BlockResult(this.created, this.blocked, this.skipped);
}
