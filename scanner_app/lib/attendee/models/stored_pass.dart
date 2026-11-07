import '../../core/media_url.dart';
import '../../models/event_model.dart';
import '../../models/ticket_type_model.dart';
import 'public_event.dart';

/// An attendee's ticket pass, saved on this device so it works offline at the
/// gate. Built from a registration response today; account tickets
/// (`GET /api/me/tickets/`, coming) will map to the same shape.
class StoredPass {
  final String ticketNumber;
  final String qrToken;
  final String attendeeName;
  final String attendeeEmail;
  final String attendeePhone;
  final String ticketTypeName;
  final double price;
  final String? promoCode;
  final String gateNote;

  /// 'valid', 'checked_in', 'checked_out', 'cancelled'.
  final String status;

  final String eventSlug;
  final String eventTitle;
  final String eventVenue;
  final String? startDate;
  final String? startTime;
  final String? endDate;
  final String? endTime;

  /// Event phase from the server when the pass was saved.
  final String? eventPhase;
  final String? eventStatus;
  final String? bannerUrl;
  final DateTime savedAt;

  /// 'device' (registered in this app) or 'account' (from the user's account).
  final String source;

  /// Server id of the ticket (account tickets).
  final String? ticketId;

  /// From `GET /api/me/tickets/`: whether the user may review the event now.
  final bool canReview;
  final String? myReviewId;

  /// Order this ticket was bought in ("ORD-7K2M9Q"); null for older tickets.
  final String? orderReference;

  /// 0 = the buyer's own ticket, 1.. = their guests' (ticket 2, 3…).
  final int guestNumber;

  /// The order's payment: 'free', 'due' (pay at the venue), 'pending', 'paid', 'failed', 'refunded';
  /// null for older tickets.
  final String? paymentStatus;

  /// "Paid online · Khalti · ref 4H7Ah…" / "Pay Rs 500 at the venue".
  final String? paymentLabel;

  /// Seat ("A-12"); empty when there is none or the event hides seats.
  final String seatNumber;

  /// 'vertical' (default) or 'landscape', chosen per event by the organizer.
  final String passLayout;

  bool get isLandscape => passLayout == 'landscape';

  const StoredPass({
    required this.ticketNumber,
    required this.qrToken,
    required this.attendeeName,
    this.attendeeEmail = '',
    this.attendeePhone = '',
    this.ticketTypeName = '',
    this.price = 0,
    this.promoCode,
    this.gateNote = '',
    this.status = 'valid',
    required this.eventSlug,
    required this.eventTitle,
    this.eventVenue = '',
    this.startDate,
    this.startTime,
    this.endDate,
    this.endTime,
    this.eventPhase,
    this.eventStatus,
    this.bannerUrl,
    required this.savedAt,
    this.source = 'device',
    this.ticketId,
    this.canReview = false,
    this.myReviewId,
    this.orderReference,
    this.guestNumber = 0,
    this.paymentStatus,
    this.paymentLabel,
    this.seatNumber = '',
    this.passLayout = 'vertical',
  });

  static String? _payStatus(Object? p) => p is Map ? p['status']?.toString() : null;
  static String? _payLabel(Object? p) {
    final l = p is Map ? p['label']?.toString().trim() : null;
    return (l == null || l.isEmpty) ? null : l;
  }

  /// From the `ticket` object of `POST /api/forms/events/<slug>/register/`.
  factory StoredPass.fromRegistration(Map<String, dynamic> t, PublicEvent e) {
    final promo = t['promo_code']?.toString();
    return StoredPass(
      ticketNumber: t['ticket_number']?.toString() ?? '',
      qrToken: t['qr_token']?.toString() ?? t['ticket_number']?.toString() ?? '',
      attendeeName: t['attendee_name']?.toString() ?? '',
      attendeeEmail: t['attendee_email']?.toString() ?? '',
      attendeePhone: t['attendee_phone']?.toString() ?? '',
      ticketTypeName: t['ticket_type_name']?.toString() ?? '',
      price: parseMoney(t['price']),
      promoCode: (promo == null || promo.isEmpty) ? null : promo,
      gateNote: t['gate_note']?.toString() ?? '',
      status: t['status']?.toString() ?? 'valid',
      eventSlug: e.slug,
      eventTitle: e.title,
      eventVenue: e.venue,
      startDate: e.base.date,
      startTime: e.base.startTime,
      endDate: e.base.endDate,
      endTime: e.base.endTime,
      eventPhase: e.base.serverPhase,
      eventStatus: e.base.status,
      bannerUrl: e.bannerUrl,
      savedAt: DateTime.now(),
      orderReference: _orderRef(t['order_reference']),
      guestNumber: _int(t['guest_number']),
      paymentStatus: _payStatus(t['payment']),
      paymentLabel: _payLabel(t['payment']),
      seatNumber: t['seat_number']?.toString() ?? '',
      passLayout: t['pass_layout']?.toString() ?? 'vertical',
    );
  }

  static String? _orderRef(Object? v) {
    final s = v?.toString().trim();
    return (s == null || s.isEmpty) ? null : s;
  }

  static int _int(Object? v) => int.tryParse(v?.toString() ?? '') ?? 0;

  /// From one result of `GET /api/me/tickets/` (ticket + nested event).
  factory StoredPass.fromAccount(Map<String, dynamic> t) {
    final e = t['event'] is Map ? Map<String, dynamic>.from(t['event'] as Map) : <String, dynamic>{};
    String? s(Map m, String k) {
      final v = m[k]?.toString();
      return (v == null || v.isEmpty) ? null : v;
    }

    return StoredPass(
      ticketId: s(t, 'id'),
      ticketNumber: s(t, 'ticket_number') ?? '',
      qrToken: s(t, 'qr_token') ?? s(t, 'ticket_number') ?? '',
      attendeeName: s(t, 'attendee_name') ?? '',
      attendeeEmail: s(t, 'attendee_email') ?? '',
      attendeePhone: s(t, 'attendee_phone') ?? '',
      ticketTypeName: s(t, 'ticket_type_name') ?? '',
      price: parseMoney(t['price']),
      promoCode: s(t, 'promo_code'),
      gateNote: s(t, 'gate_note') ?? '',
      status: s(t, 'status') ?? 'valid',
      eventSlug: s(e, 'slug') ?? '',
      eventTitle: s(e, 'title') ?? 'Event',
      eventVenue: s(e, 'location') ?? '',
      startDate: s(e, 'start_date'),
      startTime: s(e, 'start_time'),
      endDate: s(e, 'end_date'),
      endTime: s(e, 'end_time'),
      eventPhase: s(e, 'phase'),
      eventStatus: s(e, 'status'),
      bannerUrl: mediaUrl(e['banner']),
      savedAt: DateTime.now(),
      source: 'account',
      canReview: t['can_review'] == true,
      myReviewId: s(t, 'my_review_id'),
      orderReference: s(t, 'order_reference'),
      guestNumber: _int(t['guest_number']),
      paymentStatus: _payStatus(t['payment']),
      paymentLabel: _payLabel(t['payment']),
      seatNumber: s(t, 'seat_number') ?? '',
      passLayout: s(t, 'pass_layout') ?? 'vertical',
    );
  }

  /// Same pass, keeping where it came from.
  StoredPass withSource(String source) {
    final j = toJson()..['source'] = source;
    return StoredPass.fromJson(j);
  }

  factory StoredPass.fromJson(Map<String, dynamic> j) {
    String? s(String k) {
      final v = j[k]?.toString();
      return (v == null || v.isEmpty) ? null : v;
    }

    return StoredPass(
      ticketNumber: s('ticket_number') ?? '',
      qrToken: s('qr_token') ?? s('ticket_number') ?? '',
      attendeeName: s('attendee_name') ?? '',
      attendeeEmail: s('attendee_email') ?? '',
      attendeePhone: s('attendee_phone') ?? '',
      ticketTypeName: s('ticket_type_name') ?? '',
      price: parseMoney(j['price']),
      promoCode: s('promo_code'),
      gateNote: s('gate_note') ?? '',
      status: s('status') ?? 'valid',
      eventSlug: s('event_slug') ?? '',
      eventTitle: s('event_title') ?? 'Event',
      eventVenue: s('event_venue') ?? '',
      startDate: s('start_date'),
      startTime: s('start_time'),
      endDate: s('end_date'),
      endTime: s('end_time'),
      eventPhase: s('event_phase'),
      eventStatus: s('event_status'),
      bannerUrl: s('banner_url'),
      savedAt: DateTime.tryParse(s('saved_at') ?? '') ?? DateTime.now(),
      source: s('source') ?? 'device',
      ticketId: s('ticket_id'),
      canReview: j['can_review'] == true,
      myReviewId: s('my_review_id'),
      orderReference: s('order_reference'),
      guestNumber: _int(j['guest_number']),
      paymentStatus: s('payment_status'),
      paymentLabel: s('payment_label'),
      seatNumber: s('seat_number') ?? '',
      passLayout: s('pass_layout') ?? 'vertical',
    );
  }

  Map<String, dynamic> toJson() => {
        'ticket_number': ticketNumber,
        'qr_token': qrToken,
        'attendee_name': attendeeName,
        'attendee_email': attendeeEmail,
        'attendee_phone': attendeePhone,
        'ticket_type_name': ticketTypeName,
        'price': price,
        'promo_code': promoCode,
        'gate_note': gateNote,
        'status': status,
        'event_slug': eventSlug,
        'event_title': eventTitle,
        'event_venue': eventVenue,
        'start_date': startDate,
        'start_time': startTime,
        'end_date': endDate,
        'end_time': endTime,
        'event_phase': eventPhase,
        'event_status': eventStatus,
        'banner_url': bannerUrl,
        'saved_at': savedAt.toIso8601String(),
        'source': source,
        'ticket_id': ticketId,
        'can_review': canReview,
        'my_review_id': myReviewId,
        'order_reference': orderReference,
        'guest_number': guestNumber,
        'payment_status': paymentStatus,
        'payment_label': paymentLabel,
        'seat_number': seatNumber,
        'pass_layout': passLayout,
      };

  /// Stable identity across sources.
  String get key => ticketNumber.isNotEmpty ? ticketNumber : qrToken;

  /// A guest's ticket in someone's order (not the buyer's own).
  bool get isGuest => guestNumber > 0;

  /// "Guest 2" for guest_number 1 (ticket 2 of the order).
  String get guestLabel => 'Guest ${guestNumber + 1}';

  /// Passes bought together share this; single tickets are their own group.
  String get groupKey => orderReference ?? 'ticket:$key';

  /// The event as a shared model, for phase / date logic.
  EventModel get event => EventModel(
        id: eventSlug,
        title: eventTitle,
        slug: eventSlug,
        date: startDate,
        venue: eventVenue,
        capacity: 0,
        status: eventStatus,
        serverPhase: eventPhase,
        startTime: startTime,
        endDate: endDate,
        endTime: endTime,
      );

  EventPhase get phase => event.phase;

  bool get isCancelled => status == 'cancelled' || phase == EventPhase.cancelled;

  /// Past = the event ended or was cancelled (or the ticket was cancelled).
  bool get isPast => isCancelled || phase == EventPhase.ended;

  TicketTypeInfo get ticketType => TicketTypeInfo(
        name: ticketTypeName,
        price: price,
        gateNote: gateNote,
        promoCode: promoCode,
        paymentStatus: paymentStatus,
        paymentLabel: paymentLabel,
      );
}
