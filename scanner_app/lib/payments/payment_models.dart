import '../models/ticket_type_model.dart';

/// Online payments (Khalti / eSewa / test), backend `apps/payments`, docs/payments.md.

String? _s(Object? v) {
  final t = v?.toString().trim();
  return (t == null || t.isEmpty) ? null : t;
}

Map<String, dynamic> _m(Object? v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

class PaymentProviderInfo {
  /// 'khalti', 'esewa' or 'test'.
  final String id;
  final String name;
  final bool sandbox;
  const PaymentProviderInfo({required this.id, required this.name, this.sandbox = false});

  factory PaymentProviderInfo.fromJson(Map<String, dynamic> j) => PaymentProviderInfo(
        id: j['id']?.toString() ?? '',
        name: _s(j['name']) ?? providerName(j['id']?.toString()),
        sandbox: j['sandbox'] == true,
      );

  /// Khalti only takes Rs 10 or more.
  bool accepts(double amount) => !(id == 'khalti' && amount < 10);
}

String providerName(String? id) => switch (id) {
      'khalti' => 'Khalti',
      'esewa' => 'eSewa',
      'test' => 'Test payment',
      'venue' => 'At the venue',
      _ => id ?? 'Online',
    };

/// What an event's registration may offer (`payment_options` on the public event).
class PaymentOptions {
  /// 'venue', 'online' or 'both'.
  final String mode;
  final bool online;
  final bool venue;
  final List<PaymentProviderInfo> providers;
  final int? holdMinutes;

  const PaymentOptions({this.mode = 'venue', this.online = false, this.venue = true, this.providers = const [], this.holdMinutes});

  static const venueOnly = PaymentOptions();

  factory PaymentOptions.fromJson(Map<String, dynamic> j) => PaymentOptions(
        mode: _s(j['mode']) ?? 'venue',
        online: j['online'] == true,
        venue: j['venue'] != false,
        providers: [
          if (j['providers'] is List)
            for (final p in j['providers'] as List)
              if (p is Map) PaymentProviderInfo.fromJson(Map<String, dynamic>.from(p)),
        ],
        holdMinutes: int.tryParse(j['hold_minutes']?.toString() ?? ''),
      );

  /// "Pay online or at the venue" (short, for bars).
  String get shortNote => !online ? 'Pay at the venue' : (venue ? 'Pay online or at the venue' : 'Pay online');

  /// "Pay online with Khalti or eSewa, or at the venue."
  String get note {
    if (!online) return 'Pay at the venue';
    final names = providers.where((p) => p.id != 'test').map((p) => p.name).toList();
    final via = names.isEmpty ? 'online' : names.join(' or ');
    return venue ? 'Pay online with $via, or at the venue' : 'Pay online with $via';
  }
}

/// Where to send the buyer: a page, or a signed form to POST (eSewa).
class Checkout {
  final String? redirectUrl;
  final String? formAction;
  final String method;
  final Map<String, String> fields;
  const Checkout({this.redirectUrl, this.formAction, this.method = 'POST', this.fields = const {}});

  factory Checkout.fromJson(Map<String, dynamic> j) => Checkout(
        redirectUrl: _s(j['redirect_url']),
        formAction: _s(j['form_action']),
        method: _s(j['method']) ?? 'POST',
        fields: {for (final e in _m(j['fields']).entries) e.key: e.value?.toString() ?? ''},
      );

  bool get isForm => redirectUrl == null && formAction != null;
  bool get isValid => redirectUrl != null || formAction != null;

  /// An application/x-www-form-urlencoded body for the form POST.
  String get formBody => fields.entries.map((e) => '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}').join('&');
}

/// `GET /api/payments/intents/<id>/` (whoever holds the id may read it).
class PaymentIntent {
  final String id;

  /// 'ticket_order', 'vote_pack'…
  final String purpose;
  final String reference;
  final String description;

  /// 'created', 'pending', 'paid', 'failed', 'cancelled', 'expired' or 'refunded'.
  final String status;
  final double amount;
  final String? provider;
  final String? providerName;
  final String? providerTxnId;
  final DateTime? createdAt;
  final DateTime? expiresAt;
  final DateTime? paidAt;
  final bool fulfilled;
  final String? failureReason;

  /// The purpose's own data (ticket orders: order + passes once paid; vote packs: purchase + credits).
  final Map<String, dynamic>? result;

  const PaymentIntent({
    required this.id,
    this.purpose = '',
    this.reference = '',
    this.description = '',
    this.status = 'created',
    this.amount = 0,
    this.provider,
    this.providerName,
    this.providerTxnId,
    this.createdAt,
    this.expiresAt,
    this.paidAt,
    this.fulfilled = false,
    this.failureReason,
    this.result,
  });

  factory PaymentIntent.fromJson(Map<String, dynamic> j) => PaymentIntent(
        id: j['id']?.toString() ?? '',
        purpose: _s(j['purpose']) ?? '',
        reference: _s(j['reference']) ?? '',
        description: _s(j['description']) ?? '',
        status: _s(j['status']) ?? 'created',
        amount: parseMoney(j['amount']),
        provider: _s(j['provider']),
        providerName: _s(j['provider_name']),
        providerTxnId: _s(j['provider_txn_id']),
        createdAt: DateTime.tryParse(j['created_at']?.toString() ?? '')?.toLocal(),
        expiresAt: DateTime.tryParse(j['expires_at']?.toString() ?? '')?.toLocal(),
        paidAt: DateTime.tryParse(j['paid_at']?.toString() ?? '')?.toLocal(),
        fulfilled: j['fulfilled'] == true,
        failureReason: _s(j['failure_reason']),
        result: j['result'] is Map ? Map<String, dynamic>.from(j['result'] as Map) : null,
      );

  bool get isOpen => status == 'created' || status == 'pending';
  bool get isPaid => status == 'paid';

  /// Paid and what was bought has been delivered (passes issued / votes credited).
  bool get isDone => isPaid && fulfilled;

  bool get isFailed => status == 'failed' || status == 'cancelled' || status == 'expired';

  String get amountLabel => formatRupees(amount);

  String get statusLabel => switch (status) {
        'paid' => 'Paid',
        'pending' || 'created' => 'Awaiting payment',
        'failed' => 'Payment failed',
        'cancelled' => 'Cancelled',
        'expired' => 'Expired',
        'refunded' => 'Refunded',
        _ => status,
      };
}

/// Answer of a call that starts a payment (registration or a vote pack).
class PurchaseStart {
  final PaymentIntent payment;
  final Checkout checkout;

  /// Vote packs: `purchase` ({id, status, label, votes, bonus_votes, total_votes, amount…}).
  final Map<String, dynamic>? purchase;
  const PurchaseStart({required this.payment, required this.checkout, this.purchase});

  factory PurchaseStart.fromJson(Map<String, dynamic> j) => PurchaseStart(
        payment: PaymentIntent.fromJson(_m(j['payment'])),
        checkout: Checkout.fromJson(_m(j['checkout'])),
        purchase: j['purchase'] is Map ? _m(j['purchase']) : null,
      );
}

/// How a ticket order was / will be paid (`payment` on every pass).
class TicketPayment {
  /// 'venue', 'online' or 'free'.
  final String method;

  /// 'free', 'due', 'pending', 'paid', 'failed' or 'refunded'.
  final String status;
  final String? provider;
  final String? reference;
  final double amount;

  /// "Paid online · Khalti · ref 4H7Ah…" / "Pay Rs 500 at the venue".
  final String label;
  const TicketPayment({this.method = 'venue', this.status = 'due', this.provider, this.reference, this.amount = 0, this.label = ''});

  static TicketPayment? maybe(Object? v) {
    if (v is! Map) return null;
    final j = Map<String, dynamic>.from(v);
    return TicketPayment(
      method: _s(j['method']) ?? 'venue',
      status: _s(j['status']) ?? 'due',
      provider: _s(j['provider']),
      reference: _s(j['reference']),
      amount: parseMoney(j['amount']),
      label: _s(j['label']) ?? '',
    );
  }

  bool get paid => status == 'paid' || status == 'free';
  bool get due => status == 'due';
}
