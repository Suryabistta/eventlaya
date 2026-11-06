import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_client.dart';
import 'payment_models.dart';

/// `/api/payments/…` for payers. The intent id is the secret, so these work signed out.
class PaymentApi {
  PaymentApi([ApiClient? client]) : _api = client ?? ApiClient();
  final ApiClient _api;

  static Map<String, dynamic> _map(dynamic d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{};

  /// `GET /api/payments/providers/` → enabled providers (empty when the module is off).
  Future<List<PaymentProviderInfo>> providers() async {
    try {
      final resp = await _api.get('/api/payments/providers/');
      final data = _map(resp.data);
      if (data['enabled'] == false) return const [];
      return [
        if (data['providers'] is List)
          for (final p in data['providers'] as List)
            if (p is Map) PaymentProviderInfo.fromJson(Map<String, dynamic>.from(p)),
      ];
    } on DioException catch (e) {
      if (ApiClient.isModuleDisabled(e)) return const [];
      rethrow;
    }
  }

  /// Status for polling; the server re-checks open intents with the provider.
  Future<PaymentIntent> intent(String id) async {
    final resp = await _api.get('/api/payments/intents/$id/');
    return PaymentIntent.fromJson(_map(resp.data));
  }

  /// `GET /api/payments/mine/`: the signed-in user's payments on every device, newest first.
  Future<List<PaymentRecord>> mine({int limit = 50}) async {
    final resp = await _api.get('/api/payments/mine/', queryParameters: {'limit': limit});
    final data = _map(resp.data);
    return [
      if (data['results'] is List)
        for (final r in data['results'] as List)
          if (r is Map) PaymentRecord.fromAccount(Map<String, dynamic>.from(r)),
    ];
  }

  /// Starts / resumes the checkout of an open intent with [provider].
  Future<PurchaseStart> checkout(String id, String provider) async {
    final resp = await _api.post('/api/payments/intents/$id/checkout/', data: {'provider': provider});
    return PurchaseStart.fromJson(_map(resp.data));
  }
}

/// A payment started on this phone ("My payments" in Profile). The public API
/// has no payer-side list, so the app keeps the ids it started and reads each
/// one's live status from `GET /api/payments/intents/<id>/`.
class PaymentRecord {
  final String id;
  final String purpose;
  final String description;
  final double amount;
  final String? provider;
  final DateTime createdAt;
  final String status;

  /// Where it belongs: the event (tickets) / contest (votes), for links.
  final String? eventSlug;
  final String? contestRef;

  /// From the account (`/api/payments/mine/`), from this phone's history, or both.
  final bool onAccount;
  final bool onPhone;

  /// "2 tickets · Order ORD-7K2M9Q" / "60 votes · Miss Biratnagar 2026" (account rows).
  final String? summary;
  final String? providerTxnId;

  const PaymentRecord({
    required this.id,
    required this.purpose,
    required this.description,
    required this.amount,
    this.provider,
    required this.createdAt,
    this.status = 'pending',
    this.eventSlug,
    this.contestRef,
    this.onAccount = false,
    this.onPhone = true,
    this.summary,
    this.providerTxnId,
  });

  /// A row of `GET /api/payments/mine/`.
  factory PaymentRecord.fromAccount(Map<String, dynamic> j) {
    final s = j['summary'] is Map ? Map<String, dynamic>.from(j['summary'] as Map) : const <String, dynamic>{};
    final event = j['event'] is Map ? Map<String, dynamic>.from(j['event'] as Map) : const <String, dynamic>{};
    final contest = s['contest'] is Map ? Map<String, dynamic>.from(s['contest'] as Map) : const <String, dynamic>{};
    String? summary;
    if (s['type'] == 'ticket_order') {
      final n = int.tryParse(s['ticket_count']?.toString() ?? '');
      summary = [
        if (n != null) '$n ${n == 1 ? 'ticket' : 'tickets'}',
        if (s['order_reference'] != null) 'Order ${s['order_reference']}',
      ].join(' · ');
    } else if (s['type'] == 'vote_pack') {
      summary = [
        if (s['votes'] != null) '${s['votes']} votes',
        if (contest['title'] != null) contest['title'].toString(),
      ].join(' · ');
    }
    return PaymentRecord(
      id: j['id']?.toString() ?? '',
      purpose: j['purpose']?.toString() ?? '',
      description: j['description']?.toString() ?? '',
      amount: double.tryParse(j['amount']?.toString() ?? '') ?? 0,
      provider: j['provider']?.toString(),
      createdAt: DateTime.tryParse(j['created_at']?.toString() ?? '')?.toLocal() ?? DateTime.now(),
      status: j['status']?.toString() ?? 'pending',
      eventSlug: (contest['event_slug'] ?? event['slug'])?.toString(),
      contestRef: contest['slug']?.toString(),
      onAccount: true,
      onPhone: false,
      summary: (summary == null || summary.isEmpty) ? null : summary,
      providerTxnId: j['provider_txn_id']?.toString(),
    );
  }

  /// Account history and this phone's, one row per payment (account data wins, both flags kept), newest first.
  static List<PaymentRecord> merge(List<PaymentRecord> account, List<PaymentRecord> phone) {
    final byId = <String, PaymentRecord>{for (final a in account) a.id: a};
    for (final p in phone) {
      final a = byId[p.id];
      byId[p.id] = a == null
          ? p
          : PaymentRecord(
              id: a.id,
              purpose: a.purpose,
              description: a.description.isEmpty ? p.description : a.description,
              amount: a.amount,
              provider: a.provider ?? p.provider,
              createdAt: a.createdAt,
              status: a.status,
              eventSlug: a.eventSlug ?? p.eventSlug,
              contestRef: a.contestRef ?? p.contestRef,
              onAccount: true,
              onPhone: true,
              summary: a.summary,
              providerTxnId: a.providerTxnId,
            );
    }
    return byId.values.toList()..sort((x, y) => y.createdAt.compareTo(x.createdAt));
  }

  factory PaymentRecord.fromJson(Map<String, dynamic> j) => PaymentRecord(
        id: j['id']?.toString() ?? '',
        purpose: j['purpose']?.toString() ?? '',
        description: j['description']?.toString() ?? '',
        amount: double.tryParse(j['amount']?.toString() ?? '') ?? 0,
        provider: j['provider']?.toString(),
        createdAt: DateTime.tryParse(j['created_at']?.toString() ?? '') ?? DateTime.now(),
        status: j['status']?.toString() ?? 'pending',
        eventSlug: j['event_slug']?.toString(),
        contestRef: j['contest_ref']?.toString(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'purpose': purpose,
        'description': description,
        'amount': amount,
        'provider': provider,
        'created_at': createdAt.toIso8601String(),
        'status': status,
        'event_slug': eventSlug,
        'contest_ref': contestRef,
      };

  PaymentRecord withStatus(String s) => PaymentRecord.fromJson(toJson()..['status'] = s);
}

class PaymentHistory {
  PaymentHistory._();
  static const _key = 'payment_history_v1';
  static const _max = 50;

  static Future<List<PaymentRecord>> load() async {
    try {
      final raw = (await SharedPreferences.getInstance()).getString(_key);
      final list = raw == null ? null : jsonDecode(raw);
      if (list is! List) return [];
      return [for (final j in list) if (j is Map) PaymentRecord.fromJson(Map<String, dynamic>.from(j))];
    } catch (e) {
      debugPrint('PaymentHistory.load: $e');
      return [];
    }
  }

  static Future<void> _save(List<PaymentRecord> list) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_key, jsonEncode([for (final r in list.take(_max)) r.toJson()]));
  }

  /// Adds (newest first) or updates a record.
  static Future<void> upsert(PaymentRecord r) async {
    final all = await load();
    final i = all.indexWhere((x) => x.id == r.id);
    if (i >= 0) {
      all[i] = r;
    } else {
      all.insert(0, r);
    }
    await _save(all);
  }

  static Future<void> updateStatus(String id, String status) async {
    final all = await load();
    final i = all.indexWhere((x) => x.id == id);
    if (i < 0 || all[i].status == status) return;
    all[i] = all[i].withStatus(status);
    await _save(all);
  }

  /// Records [start] when it begins.
  static Future<void> record(PurchaseStart start, {String? eventSlug, String? contestRef}) {
    final p = start.payment;
    return upsert(PaymentRecord(
      id: p.id,
      purpose: p.purpose,
      description: p.description,
      amount: p.amount,
      provider: p.provider,
      createdAt: p.createdAt ?? DateTime.now(),
      status: p.status,
      eventSlug: eventSlug,
      contestRef: contestRef,
    ));
  }
}
