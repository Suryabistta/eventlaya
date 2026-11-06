/// Ticket-type details carried on every ticket (General / Early Bird / VIP…).
///
/// All fields are optional: older servers and offline-queued scans don't
/// send them.
class TicketTypeInfo {
  /// e.g. "Student". Empty for tickets without a type.
  final String name;

  /// The ticket's price (what's collected at the gate when the order is paid at the venue).
  final double price;

  /// Instruction for gate staff, e.g. "Check student ID". May be empty.
  final String gateNote;
  final String? promoCode;

  /// The order's payment status ('free', 'due', 'pending', 'paid', 'failed', 'refunded');
  /// null for older servers / tickets without an order (treated as pay at the venue).
  final String? paymentStatus;

  /// "Paid online · Khalti · ref 4H7Ah…" / "Pay Rs 500 at the venue".
  final String? paymentLabel;

  const TicketTypeInfo({
    this.name = '',
    this.price = 0,
    this.gateNote = '',
    this.promoCode,
    this.paymentStatus,
    this.paymentLabel,
  });

  static const empty = TicketTypeInfo();

  bool get hasName => name.trim().isNotEmpty;
  bool get hasGateNote => gateNote.trim().isNotEmpty;

  /// Money to collect at the gate: a priced ticket whose order is paid at the venue
  /// (not one already paid online).
  bool get hasPriceDue => price > 0 && (paymentStatus == null || paymentStatus == 'due');

  /// How the order was paid, for passes ("Paid online · Khalti · ref …"); null when free / due / unknown.
  String? get paymentNote {
    final l = paymentLabel?.trim();
    if (l == null || l.isEmpty || paymentStatus == 'free' || paymentStatus == 'due') return null;
    return l;
  }

  /// "Rs 250" / "Rs 1,250.50".
  String get priceLabel => formatRupees(price);

  factory TicketTypeInfo.fromTicket(Map? t) {
    if (t == null) return empty;
    final promo = t['promo_code']?.toString();
    final pay = t['payment'] is Map ? t['payment'] as Map : null;
    return TicketTypeInfo(
      name: t['ticket_type_name']?.toString().trim() ?? '',
      price: parseMoney(t['price']),
      gateNote: t['gate_note']?.toString().trim() ?? '',
      promoCode: (promo == null || promo.isEmpty) ? null : promo,
      paymentStatus: pay?['status']?.toString(),
      paymentLabel: pay?['label']?.toString(),
    );
  }
}

/// Per-type sales and attendance from `GET /api/events/<id>/analytics/`.
class TicketTypeStat {
  final String id;
  final String name;
  final double price;

  /// Null = unlimited.
  final int? quantity;
  final int sold;
  final int checkedIn;
  final String availability;
  final bool isHidden;

  const TicketTypeStat({
    required this.id,
    required this.name,
    required this.price,
    required this.quantity,
    required this.sold,
    required this.checkedIn,
    required this.availability,
    required this.isHidden,
  });

  factory TicketTypeStat.fromJson(Map<String, dynamic> j) => TicketTypeStat(
        id: j['id']?.toString() ?? '',
        name: j['name']?.toString() ?? 'Ticket',
        price: parseMoney(j['price']),
        quantity: j['quantity'] == null ? null : int.tryParse(j['quantity'].toString()),
        sold: int.tryParse(j['sold']?.toString() ?? '') ?? 0,
        checkedIn: int.tryParse(j['checked_in']?.toString() ?? '') ?? 0,
        availability: j['availability']?.toString() ?? '',
        isHidden: j['is_hidden'] == true,
      );
}

double parseMoney(dynamic v) {
  if (v == null) return 0;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString()) ?? 0;
}

String formatRupees(double v) {
  final whole = v == v.roundToDouble();
  final s = whole ? v.toStringAsFixed(0) : v.toStringAsFixed(2);
  final parts = s.split('.');
  final digits = parts[0];
  final buf = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buf.write(',');
    buf.write(digits[i]);
  }
  return 'Rs $buf${parts.length > 1 ? '.${parts[1]}' : ''}';
}
