import 'package:dio/dio.dart';
import '../../core/api_client.dart';
import '../../payments/payment_models.dart';
import '../models/contest.dart';
import '../models/marketplace.dart';
import '../models/poll.dart';
import '../models/public_event.dart';
import '../models/stored_pass.dart';

/// Turns any error into a short, user-facing sentence. Module-disabled
/// responses become "This feature is currently unavailable."
String friendlyError(Object e) {
  if (e is DioException) return ApiClient().errorMessage(e);
  if (e is ApiFailure) return e.message;
  return 'Something went wrong. Please try again.';
}

class ApiFailure implements Exception {
  final String message;
  const ApiFailure(this.message);
  @override
  String toString() => message;
}

/// Result of `POST /api/forms/events/<slug>/register/`.
class RegistrationResult {
  /// The buyer's own ticket.
  final Map<String, dynamic> ticket;

  /// Every pass: the buyer's first, then their guests'. For an already
  /// registered email, all the tickets that email has for the event.
  final List<Map<String, dynamic>> tickets;
  final bool alreadyRegistered;
  final String message;

  /// "ORD-7K2M9Q" for a new order.
  final String? orderReference;

  /// What the order costs (server's figure); null when unknown.
  final double? orderTotal;

  /// Online payment: the tickets are held and there are no passes until the
  /// payment is confirmed. Run this checkout (see payments/payment_result_screen.dart).
  final PurchaseStart? payment;

  const RegistrationResult({
    required this.ticket,
    required this.tickets,
    required this.alreadyRegistered,
    required this.message,
    this.orderReference,
    this.orderTotal,
    this.payment,
  });

  bool get paymentRequired => payment != null;
}

/// Everything voting on an event page: quick polls and contests
/// (`GET /api/voting/public/<slug>/` lists both; contests have `kind: "contest"`).
class EventVoting {
  final List<Poll> polls;
  final List<Contest> contests;
  const EventVoting({this.polls = const [], this.contests = const []});

  bool get isEmpty => polls.isEmpty && contests.isEmpty;
}

/// One line of a multi-ticket registration.
class TicketOrderItem {
  final String ticketTypeId;
  final int quantity;

  /// Names for this line's guest tickets (blank → the server names them).
  final List<String> guestNames;
  const TicketOrderItem(this.ticketTypeId, this.quantity, [this.guestNames = const []]);

  Map<String, dynamic> toJson() => {
        'ticket_type_id': ticketTypeId,
        'quantity': quantity,
        if (guestNames.isNotEmpty) 'guest_names': guestNames,
      };
}

/// Result of a public vote.
class VoteResult {
  final String message;
  final Poll? poll;
  const VoteResult(this.message, this.poll);
}

/// Every attendee-facing API call. All of these work without signing in;
/// the auth header is added automatically when the user is signed in.
class AttendeeApi {
  AttendeeApi([ApiClient? client]) : _api = client ?? ApiClient();
  final ApiClient _api;

  static List _list(dynamic data) {
    if (data is List) return data;
    if (data is Map && data['results'] is List) return data['results'] as List; // paginated servers
    return const [];
  }

  static Map<String, dynamic> _map(dynamic data) =>
      data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};

  // ── Events ─────────────────────────────────────────────────────────────

  /// `GET /api/events/public/?when=upcoming|past&search=` (plain list today).
  Future<List<PublicEvent>> events({String when = 'upcoming', String? search}) async {
    final resp = await _api.get('/api/events/public/', queryParameters: {
      'when': when,
      if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
    });
    return [for (final e in _list(resp.data)) if (e is Map) PublicEvent.fromJson(Map<String, dynamic>.from(e))];
  }

  /// `GET /api/events/public/<slug>/` → `{event, form}`.
  Future<EventDetail> event(String slug) async {
    final resp = await _api.get('/api/events/public/$slug/');
    final data = _map(resp.data);
    final form = data['form'] is Map ? FormSchema.fromJson(_map(data['form'])) : null;
    return EventDetail(PublicEvent.fromJson(_map(data['event']), detailed: true), form);
  }

  /// `POST /api/events/public/<slug>/promo/` `{code}`.
  Future<PromoResult> checkPromo(String slug, String code) async {
    try {
      final resp = await _api.post('/api/events/public/$slug/promo/', data: {'code': code.trim()});
      final data = _map(resp.data);
      if (data['valid'] != true) throw ApiFailure(data['error']?.toString() ?? "That code isn't valid.");
      return PromoResult(
        code: data['code']?.toString() ?? code.trim(),
        label: data['label']?.toString() ?? 'Code applied',
        ticketTypes: [for (final t in _list(data['ticket_types'])) if (t is Map) PublicTicketType.fromJson(_map(t))],
      );
    } on DioException catch (e) {
      final data = e.response?.data;
      if (data is Map && data['valid'] == false && data['error'] != null) throw ApiFailure(data['error'].toString());
      rethrow;
    }
  }

  /// `POST /api/forms/events/<slug>/register/`. Public: works signed out.
  ///
  /// [items] buys several tickets (one pass each); without it, [ticketTypeId]
  /// (or the event's only ticket) gives one pass. [additional] gets more
  /// tickets for an email that already has some, instead of returning them.
  Future<RegistrationResult> register(
    String slug, {
    required String name,
    required String email,
    String phone = '',
    String? ticketTypeId,
    List<TicketOrderItem>? items,
    String? promoCode,
    bool additional = false,
    Map<String, dynamic> answers = const {},
    String? payOnlineWith,
    String? returnUrl,
  }) async {
    final resp = await _api.post('/api/forms/events/$slug/register/', data: {
      if (payOnlineWith != null) ...{
        'payment_method': 'online',
        'provider': payOnlineWith,
        'return_url': returnUrl ?? 'https://eventlaya.com/e/$slug/register',
      } else
        'payment_method': 'venue',
      'name': name,
      'email': email,
      'phone': phone,
      if (items != null && items.isNotEmpty)
        'items': [for (final i in items) i.toJson()]
      else if (ticketTypeId != null)
        'ticket_type_id': ticketTypeId,
      if (promoCode != null && promoCode.isNotEmpty) 'promo_code': promoCode,
      if (additional) 'additional': true,
      'answers': answers,
    });
    final data = _map(resp.data);
    final order = data['order'] is Map ? _map(data['order']) : const <String, dynamic>{};
    if (data['payment_required'] == true) {
      final start = PurchaseStart.fromJson(data);
      if (!start.checkout.isValid) throw const ApiFailure("The payment couldn't be started. Please try again.");
      return RegistrationResult(
        ticket: const {},
        tickets: const [],
        alreadyRegistered: false,
        message: data['message']?.toString() ?? '',
        orderReference: order['reference']?.toString(),
        orderTotal: order['total'] == null ? null : double.tryParse(order['total'].toString()),
        payment: start,
      );
    }
    if (data['ticket'] is! Map) throw const ApiFailure('The server did not return a ticket. Please try again.');
    final ticket = _map(data['ticket']);
    final tickets = [for (final t in _list(data['tickets'])) if (t is Map) _map(t)];
    return RegistrationResult(
      ticket: ticket,
      tickets: tickets.isEmpty ? [ticket] : tickets,
      alreadyRegistered: data['already_registered'] == true,
      message: data['message']?.toString() ?? '',
      orderReference: order['reference']?.toString(),
      orderTotal: order['total'] == null ? null : double.tryParse(order['total'].toString()),
    );
  }

  /// `GET /api/me/tickets/?when=all` — the signed-in user's tickets on every
  /// device (only tickets linked after the email was verified).
  Future<List<StoredPass>> myTickets() async {
    final resp = await _api.get('/api/me/tickets/', queryParameters: {'when': 'all'});
    return [
      for (final t in _list(_map(resp.data)['results']))
        if (t is Map) StoredPass.fromAccount(_map(t)),
    ];
  }

  /// `GET /api/me/inquiries/?kind=venue|vendor` (both when null).
  Future<List<Map<String, dynamic>>> myInquiries({String? kind}) async {
    final resp = await _api.get('/api/me/inquiries/', queryParameters: {if (kind != null) 'kind': kind});
    return [for (final i in _list(_map(resp.data)['results'])) if (i is Map) _map(i)];
  }

  /// `GET /api/events/passes/<qr_token>/` — one pass by its secret token (the emailed /ticket/<token> link).
  Future<StoredPass> publicPass(String token) async {
    final resp = await _api.get('/api/events/passes/${Uri.encodeComponent(token)}/');
    final data = _map(resp.data);
    if (data['ticket'] is! Map) throw const ApiFailure("We couldn't find that pass.");
    return StoredPass.fromAccount({..._map(data['ticket']), 'event': _map(data['event'])}).withSource('device');
  }

  // ── Voting ─────────────────────────────────────────────────────────────

  /// `GET /api/voting/public/<slug>/` → quick polls and contests shown on the event page.
  Future<EventVoting> voting(String slug) async {
    final resp = await _api.get('/api/voting/public/$slug/');
    final polls = <Poll>[], contests = <Contest>[];
    for (final p in _list(_map(resp.data)['polls'])) {
      if (p is! Map) continue;
      final m = _map(p);
      if (m['kind'] == 'contest') {
        contests.add(Contest.fromJson(m));
      } else {
        polls.add(Poll.fromJson(m));
      }
    }
    return EventVoting(polls: polls, contests: contests);
  }

  /// Quick polls shown on the event page (contests left out).
  Future<List<Poll>> polls(String slug) async => (await voting(slug)).polls;

  /// `GET /api/voting/public/<slug>/<uuid>/`: a quick poll, or a contest when the id is one.
  Future<({Poll? poll, Contest? contest})> pollOrContest(String slug, String id) async {
    final resp = await _api.get('/api/voting/public/$slug/$id/');
    final data = _map(resp.data);
    if (data['kind'] == 'contest') return (poll: null, contest: Contest.fromJson(data));
    return (poll: Poll.fromJson(data), contest: null);
  }

  /// `GET /api/voting/public/<slug>/<poll_id>/`.
  Future<Poll> poll(String slug, String pollId) async {
    final resp = await _api.get('/api/voting/public/$slug/$pollId/');
    return Poll.fromJson(_map(resp.data));
  }

  /// `POST /api/voting/public/<slug>/<poll_id>/vote/`. Identify the voter by
  /// the poll's vote mode: [ticketCode] (pass QR token or ticket number),
  /// [contact] (phone / email) or [deviceId].
  ///
  /// Signed in with `viewer.can_vote_with_account`: send none of the
  /// identifiers — the server uses the account's ticket / verified email.
  Future<VoteResult> vote(
    String slug,
    String pollId, {
    required List<String> candidateIds,
    String? ticketCode,
    String? contact,
    String? deviceId,
  }) async {
    final resp = await _api.post('/api/voting/public/$slug/$pollId/vote/', data: {
      'candidate_ids': candidateIds,
      if (ticketCode != null) 'ticket_code': ticketCode,
      if (contact != null) 'contact': contact,
      if (deviceId != null) 'device_id': deviceId,
    });
    final data = _map(resp.data);
    return VoteResult(
      data['message']?.toString() ?? 'Your vote is in.',
      data['poll'] is Map ? Poll.fromJson(_map(data['poll'])) : null,
    );
  }

  // ── Marketplace ────────────────────────────────────────────────────────

  Future<List<VendorCategory>> vendorCategories() async {
    final resp = await _api.get('/api/marketplace/categories/');
    return [for (final c in _list(resp.data)) if (c is Map) VendorCategory.fromJson(_map(c))];
  }

  Future<List<Vendor>> vendors({String? category}) async {
    final resp = await _api.get('/api/marketplace/vendors/', queryParameters: {
      if (category != null && category.isNotEmpty) 'category': category,
    });
    return [for (final v in _list(resp.data)) if (v is Map) Vendor.fromJson(_map(v))];
  }

  Future<Vendor> vendor(String id) async {
    final resp = await _api.get('/api/marketplace/vendors/$id/');
    return Vendor.fromJson(_map(resp.data));
  }

  Future<List<Venue>> venues({String? type, String? search}) async {
    final resp = await _api.get('/api/marketplace/venues/', queryParameters: {
      if (type != null && type.isNotEmpty) 'type': type,
      if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
    });
    return [for (final v in _list(resp.data)) if (v is Map) Venue.fromJson(_map(v))];
  }

  /// `GET /api/marketplace/packages/?vendor=<id>` or `?venue=<id>`: active packages of a live listing.
  Future<List<ServicePackage>> packages({String? vendorId, String? venueId}) async {
    final resp = await _api.get('/api/marketplace/packages/', queryParameters: {
      if (vendorId != null) 'vendor': vendorId,
      if (venueId != null) 'venue': venueId,
    });
    return [for (final p in _list(resp.data)) if (p is Map) ServicePackage.fromJson(_map(p))];
  }

  Future<Venue> venue(String id) async {
    final resp = await _api.get('/api/marketplace/venues/$id/');
    return Venue.fromJson(_map(resp.data));
  }

  /// `POST /api/marketplace/venues/<id>/inquiries/` (public).
  Future<void> sendVenueInquiry(
    String venueId, {
    required String name,
    required String email,
    required String phone,
    required String eventType,
    required DateTime eventDate,
    required int guestCount,
    String budget = '',
    required String message,
    String? spaceId,
  }) async {
    final d = eventDate;
    await _api.post('/api/marketplace/venues/$venueId/inquiries/', data: {
      'sender_name': name,
      'sender_email': email,
      'sender_phone': phone,
      'event_type': eventType,
      'event_date': '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}',
      'guest_count': guestCount,
      'budget_range': budget,
      'message': message,
      if (spaceId != null) 'space': spaceId,
    });
  }

  /// `POST /api/marketplace/vendors/<id>/inquiries/` (public; signed-in
  /// users are linked to the inquiry so it shows in "My inquiries").
  Future<void> sendVendorInquiry(
    String vendorId, {
    required String name,
    required String email,
    required String phone,
    required String message,
    String eventType = '',
    DateTime? eventDate,
    String budget = '',
  }) async {
    await _api.post('/api/marketplace/vendors/$vendorId/inquiries/', data: {
      'sender_name': name,
      'sender_email': email,
      'sender_phone': phone,
      'message': message,
      if (eventType.isNotEmpty) 'event_type': eventType,
      if (eventDate != null) 'event_date': _ymd(eventDate),
      if (budget.isNotEmpty) 'budget_range': budget,
    });
  }

  static String _ymd(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}
