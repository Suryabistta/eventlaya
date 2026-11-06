import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/api_client.dart';
import '../../payments/payment_models.dart';
import '../models/contest.dart';

/// A refused contest call, with the server's machine-readable code
/// (`captcha_required`, `verification_required`, `sign_in_required`,
/// `allowance_used`, `no_split`, `rate_limited`, `not_open`, `closed`,
/// `no_open_round`, `no_public_vote`, `module_disabled`, `pack_limit`…).
class ContestFailure implements Exception {
  final String message;
  final String? code;
  final int? status;

  /// OTP: seconds until a new code may be asked for.
  final int? retryAfter;

  /// allowance_used: what's left.
  final int? freeRemaining;
  final int? credits;

  const ContestFailure(this.message, {this.code, this.status, this.retryAfter, this.freeRemaining, this.credits});

  bool get moduleDisabled => code == 'module_disabled';
  bool get network => code == 'network';

  /// The voter must verify again (expired / foreign voter token).
  bool get needsVerification => code == 'verification_required';

  /// The contest changed under us (closed, round over, contestant out): reload it.
  bool get staleContest =>
      const {'not_open', 'closed', 'no_open_round', 'no_public_vote'}.contains(code) || status == 404 || status == 409;

  static ContestFailure from(Object e) {
    if (e is ContestFailure) return e;
    if (e is! DioException) return const ContestFailure('Something went wrong. Please try again.');
    if (ApiClient.isModuleDisabled(e)) {
      final module = ApiClient.disabledModule(e);
      return ContestFailure(
        module == 'payments' || module == 'paid_votes'
            ? "Buying votes isn't available right now."
            : "Voting isn't available right now.",
        code: 'module_disabled',
        status: 403,
      );
    }
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.sendTimeout ||
        e.type == DioExceptionType.connectionError) {
      return const ContestFailure("No connection. Check your internet and try again.", code: 'network');
    }
    final status = e.response?.statusCode;
    final data = e.response?.data;
    if (data is Map) {
      int? n(Object? v) => v == null ? null : int.tryParse(v.toString());
      final msg = (data['error'] ?? data['detail'] ?? data['message'])?.toString();
      return ContestFailure(
        (msg == null || msg.isEmpty) ? _fallback(status) : msg,
        code: data['code']?.toString() ?? (status == 429 ? 'rate_limited' : null),
        status: status,
        retryAfter: n(data['retry_after']),
        freeRemaining: n(data['free_remaining']),
        credits: n(data['credits']),
      );
    }
    return ContestFailure(_fallback(status), status: status);
  }

  static String _fallback(int? status) => switch (status) {
        404 => "We couldn't find this contest. The link may be old.",
        429 => 'Too many tries. Wait a minute and try again.',
        _ => 'Something went wrong (${status ?? 'no answer'}). Please try again.',
      };

  @override
  String toString() => message;
}

/// Who is voting: exactly the identity fields the server expects.
class VoterIdentity {
  final String? voterToken;
  final String? ticketCode;
  final String? contact;
  final String? deviceId;
  const VoterIdentity({this.voterToken, this.ticketCode, this.contact, this.deviceId});

  Map<String, dynamic> toJson() => {
        if (voterToken != null) 'voter_token': voterToken,
        if (ticketCode != null) 'ticket_code': ticketCode,
        if (contact != null) 'contact': contact,
        if (deviceId != null) 'device_id': deviceId,
      };
}

/// What `POST …/allowance/` returns: the main vote and each public-vote category.
class AllowanceSet {
  final Allowance main;
  final Map<String, Allowance> categories;
  const AllowanceSet(this.main, [this.categories = const {}]);

  Allowance forCategory(String? id) => id == null ? main : (categories[id] ?? main);
}

/// Public contest API (`/api/voting/public/<event>/contests/<contest>/…`). No sign-in needed;
/// the auth header goes along when signed in (account / ticket-on-account voting).
class ContestApi {
  ContestApi([ApiClient? client]) : _api = client ?? ApiClient();
  final ApiClient _api;

  static Map<String, dynamic> _map(dynamic d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{};

  String _base(String slug, String ref) => '/api/voting/public/$slug/contests/${Uri.encodeComponent(ref)}/';

  Future<T> _guard<T>(Future<T> Function() run) async {
    try {
      return await run();
    } catch (e) {
      throw ContestFailure.from(e);
    }
  }

  Future<Contest> contest(String slug, String ref) => _guard(() async {
        final resp = await _api.get(_base(slug, ref));
        return Contest.fromJson(_map(resp.data));
      });

  /// `{contest, contestant}` (contestant with gallery, socials, standing, previous / next).
  Future<({Contest contest, Contestant contestant})> contestant(String slug, String ref, String cref) => _guard(() async {
        final resp = await _api.get('${_base(slug, ref)}c/${Uri.encodeComponent(cref)}/');
        final data = _map(resp.data);
        return (contest: Contest.fromJson(_map(data['contest'])), contestant: Contestant.fromJson(_map(data['contestant'])));
      });

  Future<VoteReceipt> vote(
    String slug,
    String ref, {
    required String contestantId,
    String? categoryId,
    int quantity = 1,
    required VoterIdentity identity,
    String? captchaToken,
  }) =>
      _guard(() async {
        final resp = await _api.post('${_base(slug, ref)}vote/', data: {
          ...identity.toJson(),
          'contestant': contestantId,
          if (categoryId != null) 'category': categoryId,
          'quantity': quantity,
          if (captchaToken != null) 'captcha_token': captchaToken,
        });
        return VoteReceipt.fromJson(_map(resp.data));
      });

  /// With [contestantId] each allowance also says how many free votes that contestant can still get
  /// (`contestant_free_remaining`, per-contestant cap included).
  Future<AllowanceSet> allowance(String slug, String ref, VoterIdentity identity, {String? contestantId}) => _guard(() async {
        final resp = await _api.post('${_base(slug, ref)}allowance/', data: {
          ...identity.toJson(),
          if (contestantId != null) 'contestant': contestantId,
        });
        final data = _map(resp.data);
        return AllowanceSet(
          Allowance.fromJson(_map(data['main'])),
          {for (final e in _map(data['categories']).entries) e.key: Allowance.fromJson(_map(e.value))},
        );
      });

  Future<OtpSent> sendCode(String slug, String ref, String destination, {String? captchaToken}) => _guard(() async {
        final resp = await _api.post('${_base(slug, ref)}otp/send/', data: {
          'destination': destination,
          if (captchaToken != null) 'captcha_token': captchaToken,
        });
        return OtpSent.fromJson(_map(resp.data));
      });

  Future<VoterToken> verifyCode(String slug, String ref, String destination, String code) => _guard(() async {
        final resp = await _api.post('${_base(slug, ref)}otp/verify/', data: {'destination': destination, 'code': code});
        final data = _map(resp.data);
        final secs = int.tryParse(data['expires_in']?.toString() ?? '') ?? 12 * 3600;
        return VoterToken(
          token: data['voter_token']?.toString() ?? '',
          destination: data['destination']?.toString() ?? destination,
          expires: DateTime.now().add(Duration(seconds: secs)),
        );
      });

  /// Buys a vote pack — or, with [votes], that many votes at the per-vote price (paid votes,
  /// `apps/voting/vote_payments.py`): `{purchase, payment, checkout}`. The buyer is identified like a voter
  /// ([identity]); [contestantId] attributes the purchase (and casts the votes when the contest has "buy and vote").
  Future<PurchaseStart> buyPack(
    String slug,
    String ref, {
    String? packId,
    int? votes,
    required String provider,
    required VoterIdentity identity,
    String? contestantId,
    String? captchaToken,
    String? returnUrl,
    String? payerName,
    String? payerPhone,
    String? payerEmail,
  }) =>
      _guard(() async {
        final resp = await _api.post('${_base(slug, ref)}buy/', data: {
          ...identity.toJson(),
          if (packId != null) 'pack': packId else 'votes': votes,
          'provider': provider,
          if (contestantId != null) 'contestant': contestantId,
          if (captchaToken != null) 'captcha_token': captchaToken,
          if (returnUrl != null) 'return_url': returnUrl,
          if (payerName != null && payerName.isNotEmpty) 'payer_name': payerName,
          if (payerPhone != null && payerPhone.isNotEmpty) 'payer_phone': payerPhone,
          if (payerEmail != null && payerEmail.isNotEmpty) 'payer_email': payerEmail,
        });
        return PurchaseStart.fromJson(_map(resp.data));
      });
}

/// Voter details remembered on this phone: verified tokens per contest (12 h),
/// the last phone / email typed, and ticket codes typed per event.
class VoterStore {
  VoterStore._();
  static const _tokens = 'contest_voter_tokens_v1';
  static const _contact = 'contest_last_contact_';
  static const _ticket = 'contest_ticket_code_';

  static Future<Map<String, dynamic>> _all() async {
    final p = await SharedPreferences.getInstance();
    try {
      final raw = p.getString(_tokens);
      final m = raw == null ? null : jsonDecode(raw);
      return m is Map ? Map<String, dynamic>.from(m) : {};
    } catch (_) {
      return {};
    }
  }

  static Future<VoterToken?> token(String contestId) async {
    final all = await _all();
    final j = all[contestId];
    if (j is! Map) return null;
    final t = VoterToken.fromJson(Map<String, dynamic>.from(j));
    return t.valid ? t : null;
  }

  static Future<void> saveToken(String contestId, VoterToken? token) async {
    final all = await _all();
    all.removeWhere((_, v) => v is! Map || !VoterToken.fromJson(Map<String, dynamic>.from(v)).valid);
    if (token == null) {
      all.remove(contestId);
    } else {
      all[contestId] = token.toJson();
    }
    final p = await SharedPreferences.getInstance();
    await p.setString(_tokens, jsonEncode(all));
  }

  /// [channel]: 'sms', 'email' or 'contact'.
  static Future<String?> lastContact(String channel) async =>
      (await SharedPreferences.getInstance()).getString('$_contact$channel');

  static Future<void> saveContact(String channel, String value) async =>
      (await SharedPreferences.getInstance()).setString('$_contact$channel', value);

  static Future<String?> ticketCode(String eventSlug) async =>
      (await SharedPreferences.getInstance()).getString('$_ticket$eventSlug');

  static Future<void> saveTicketCode(String eventSlug, String code) async =>
      (await SharedPreferences.getInstance()).setString('$_ticket$eventSlug', code);
}
