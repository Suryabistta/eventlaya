import 'dart:math' as math;
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../models/ticket_type_model.dart';
import '../../payments/payment_models.dart';
import '../../payments/payment_result_screen.dart';
import '../../payments/payment_widgets.dart';
import '../../providers/auth_provider.dart';
import '../../providers/modules_provider.dart';
import '../../ui/ui.dart';
import '../data/attendee_api.dart';
import '../models/public_event.dart';
import '../models/stored_pass.dart';
import '../providers/explore_providers.dart';
import '../providers/pass_providers.dart';
import 'pass_view_screen.dart';

final _emailRe = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

/// Registration in two steps when the event sells tickets:
///
/// 1. **Tickets** — − / + for each ticket type (up to the event's per-order
///    limit and what's left), an optional promo code and an order summary.
/// 2. **Your details** — the buyer's name / email / phone, optional names for
///    the extra tickets, and the event's own questions; then submit.
///
/// Every ticket is its own pass and QR. On success all passes are saved on
/// this phone and shown (swipeable). Events without ticket types skip step 1
/// and register one pass as before. Works without an account; signed-in
/// users get name / email prefilled.
class RegisterScreen extends ConsumerStatefulWidget {
  final PublicEvent event;
  final FormSchema? form;

  /// Getting more tickets on top of passes this email already has.
  final bool additional;
  const RegisterScreen({super.key, required this.event, this.form, this.additional = false});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

/// One ticket of the order, in the order the server creates them.
typedef _Line = ({PublicTicketType type, int index});

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _scroll = ScrollController();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _promoCtrl = TextEditingController();
  final Map<String, TextEditingController> _text = {};
  final Map<String, dynamic> _answers = {};
  final Map<String, String> _choiceErrors = {};

  /// Guest name fields, keyed "<ticket type id>#<n-th of that type>".
  final Map<String, TextEditingController> _guestCtrls = {};

  /// Tickets chosen per ticket type id.
  final Map<String, int> _qty = {};

  /// 0 = Tickets, 1 = Your details.
  int _step = 0;

  PromoResult? _promo;

  /// How the buyer pays: an online provider id ('khalti', 'esewa', 'test') or 'venue'.
  String? _payWith;
  bool _checkingPromo = false;
  bool _submitting = false;
  String? _serverError;

  // ── Event & ticket types ───────────────────────────────────────────────

  /// Latest event data (refetched after a "sold out" style error).
  PublicEvent get _event => ref.read(eventDetailProvider(widget.event.slug)).valueOrNull?.event ?? widget.event;

  List<PublicTicketType> get _types => _promo?.ticketTypes ?? _event.ticketTypes;

  /// The event sells ticket types: show the Tickets step.
  /// No step for registration-only events or a single free ticket type (nothing to choose).
  bool get _ticketed =>
      _types.isNotEmpty &&
      !_event.registrationOnly &&
      !(_types.length == 1 && _types.first.price == 0 && _types.first.onSale && _promo == null);

  int get _orderMax => _event.maxTicketsPerOrder;

  int _q(PublicTicketType t) => _qty[t.id] ?? 0;

  int get _total => _types.fold(0, (sum, t) => sum + _q(t));

  List<PublicTicketType> get _chosen => _types.where((t) => _q(t) > 0).toList();

  /// Every ticket in the order; the first is the buyer's.
  List<_Line> get _lines => [
        for (final t in _chosen)
          for (var i = 0; i < _q(t); i++) (type: t, index: i),
      ];

  /// Most of [t] that can be chosen, given the other tickets in the order.
  /// Hidden counts arrive as null, so only the order limit (and the server's
  /// check on submit) applies then.
  int _maxFor(PublicTicketType t) {
    if (!t.onSale || _event.fullyBooked) return 0;
    final others = _total - _q(t);
    var m = _orderMax - others;
    if (t.remaining != null) m = math.min(m, t.remaining!);
    final spots = _event.spotsLeft;
    if (spots != null) m = math.min(m, spots - others);
    return math.max(0, m);
  }

  /// The promo is sent only when it applies to at least one chosen ticket.
  bool get _promoUsed => _promo != null && _chosen.any((t) => t.promoApplies || t.unlocked);

  double get _subtotal => _chosen.fold(0.0, (s, t) => s + _q(t) * t.price);

  double get _due => _chosen.fold(0.0, (s, t) => s + _q(t) * t.due);

  // ── Payment: online (Khalti / eSewa) and/or at the venue ───────────────

  PaymentOptions get _payOpts => _event.paymentOptions;

  /// Online providers this order may use (none when the payments module is off).
  List<PaymentProviderInfo> get _onlineProviders =>
      _payOpts.online && ref.read(moduleEnabledProvider(AppModule.payments)) ? _payOpts.providers : const [];

  List<String> get _onlineOnlyNames => [for (final t in _chosen) if (t.onlineOnly) t.name];

  bool get _venueAllowed => (_payOpts.venue || _onlineProviders.isEmpty) && _onlineOnlyNames.isEmpty;

  List<String> get _payChoices => PaymentMethodPicker.choices(_onlineProviders, _venueAllowed, _due);

  /// The chosen way to pay (first choice by default, like the web), null when nothing is due.
  String? get _payMethod => _due <= 0 ? null : (_payChoices.contains(_payWith) ? _payWith : _payChoices.firstOrNull);

  bool get _payOnline => _payMethod != null && _payMethod != 'venue';

  String get _payName => _onlineProviders.where((p) => p.id == _payMethod).firstOrNull?.name ?? 'online';

  /// Online-only tickets while online payment isn't possible.
  String? get _payBlocked => _due > 0 && _payChoices.isEmpty
      ? '${_onlineOnlyNames.join(', ')} tickets can only be paid online, which isn\'t available right now.'
      : null;

  // ── Form fields ────────────────────────────────────────────────────────

  List<FormFieldSpec> get _fields => widget.form?.fields ?? const [];

  /// Fields that repeat name / email / phone: filled from the details above.
  List<FormFieldSpec> get _mapped => _fields.where((f) => f.builtin != null && !f.isFileUpload).toList();

  /// Event questions asked on this page.
  List<FormFieldSpec> get _questions =>
      _fields.where((f) => f.builtin == null && !f.isFileUpload && !(f.isConsent && f.required)).toList();

  List<FormFieldSpec> get _consents => _fields.where((f) => f.isConsent && f.required).toList();

  /// File uploads can't be answered in the app yet.
  bool get _needsFileUpload => _fields.any((f) => f.isFileUpload && f.required);

  bool get _phoneRequired => _mapped.any((f) => f.builtin == 'phone' && f.required);

  TextEditingController _guestCtrl(_Line l) =>
      _guestCtrls.putIfAbsent('${l.type.id}#${l.index}', () => TextEditingController());

  @override
  void initState() {
    super.initState();
    final user = ref.read(authProvider).user;
    if (user != null) {
      _name.text = '${user.firstName} ${user.lastName}'.trim();
      _email.text = user.email;
      _phone.text = user.phoneNumber ?? '';
    }
    final onSale = widget.event.ticketTypes.where((t) => t.onSale).toList();
    if (onSale.length == 1) _qty[onSale.first.id] = 1;
    _step = widget.event.ticketTypes.isEmpty ? 1 : 0;
    for (final f in _questions) {
      if (!['select', 'radio', 'checkbox', 'date'].contains(f.type)) _text[f.id] = TextEditingController();
    }
  }

  @override
  void dispose() {
    for (final c in [_name, _email, _phone, _promoCtrl, ..._text.values, ..._guestCtrls.values]) {
      c.dispose();
    }
    _scroll.dispose();
    super.dispose();
  }

  void _goToStep(int step) {
    FocusScope.of(context).unfocus();
    setState(() {
      _step = step;
      if (step == 1) _serverError = null;
    });
    if (_scroll.hasClients) _scroll.jumpTo(0);
  }

  void _setQty(PublicTicketType t, int q) {
    HapticFeedback.selectionClick();
    setState(() {
      if (q <= 0) {
        _qty.remove(t.id);
      } else {
        _qty[t.id] = q;
      }
    });
  }

  /// Drops tickets that can no longer be chosen and trims to what's left.
  void _clampQuantities() {
    final ids = {for (final t in _types) t.id: t};
    _qty.removeWhere((id, _) => ids[id] == null || !ids[id]!.onSale);
    for (final t in _types) {
      if (_q(t) == 0) continue;
      final m = _maxFor(t);
      if (_q(t) > m) m <= 0 ? _qty.remove(t.id) : _qty[t.id] = m;
    }
  }

  /// After a "sold out" / "only N left" error: refetch what's available.
  Future<void> _refreshAvailability() async {
    final slug = widget.event.slug;
    ref.invalidate(eventDetailProvider(slug));
    try {
      await ref.read(eventDetailProvider(slug).future);
      if (_promo != null) {
        final fresh = await ref.read(attendeeApiProvider).checkPromo(slug, _promo!.code);
        if (mounted) _promo = fresh;
      }
    } catch (_) {
      // Keep what we have; the server checks again on submit.
    }
    if (mounted) setState(_clampQuantities);
  }

  Future<void> _applyPromo() async {
    final code = _promoCtrl.text.trim();
    if (code.isEmpty) return;
    FocusScope.of(context).unfocus();
    setState(() => _checkingPromo = true);
    try {
      final result = await ref.read(attendeeApiProvider).checkPromo(widget.event.slug, code);
      if (!mounted) return;
      final wasTicketed = _ticketed;
      setState(() {
        _promo = result;
        _clampQuantities();
        if (_total == 0) {
          final best = result.ticketTypes.where((t) => t.onSale && (t.unlocked || t.promoApplies)).firstOrNull;
          if (best != null && _maxFor(best) > 0) _qty[best.id] = 1;
        }
        if (!wasTicketed && _ticketed) _step = 0; // the code unlocked tickets to choose from
      });
      AppToast.success(context, '${result.code}: ${result.label}');
    } catch (e) {
      if (mounted) AppToast.error(context, friendlyError(e));
    } finally {
      if (mounted) setState(() => _checkingPromo = false);
    }
  }

  void _removePromo() {
    setState(() {
      _promo = null;
      _promoCtrl.clear();
      _clampQuantities();
      if (!_ticketed) _step = 1;
    });
  }

  bool _validateExtras() {
    var ok = true;
    _choiceErrors.clear();
    for (final f in _questions) {
      if (!f.required) continue;
      final v = _answers[f.id];
      final empty = v == null || v == '' || (v is List && v.isEmpty);
      if (['select', 'radio', 'checkbox', 'date'].contains(f.type) && empty) {
        _choiceErrors[f.id] = f.type == 'date' ? 'Pick a date.' : 'Choose an option.';
        ok = false;
      }
    }
    for (final f in _consents) {
      if (_answers[f.id] != true) {
        _choiceErrors[f.id] = 'Tick this box to continue.';
        ok = false;
      }
    }
    return ok;
  }

  /// One item per chosen ticket type. Guest names cover the tickets after the
  /// buyer's, flattened in item order; left out entirely when all are blank.
  List<TicketOrderItem> _items() {
    final chosen = _chosen;
    final names = <String, List<String>>{};
    var anyName = false;
    for (var j = 0; j < chosen.length; j++) {
      final t = chosen[j];
      names[t.id] = [
        for (var i = j == 0 ? 1 : 0; i < _q(t); i++) _guestCtrl((type: t, index: i)).text.trim(),
      ];
      anyName = anyName || names[t.id]!.any((n) => n.isNotEmpty);
    }
    return [for (final t in chosen) TicketOrderItem(t.id, _q(t), anyName ? names[t.id]! : const [])];
  }

  Future<void> _submit({bool additional = false}) async {
    FocusScope.of(context).unfocus();
    final fieldsOk = _formKey.currentState?.validate() ?? true;
    final extrasOk = _validateExtras();
    setState(() {});
    if (!fieldsOk || !extrasOk) {
      HapticFeedback.mediumImpact();
      AppToast.error(context, 'Check the highlighted fields');
      return;
    }
    if (_ticketed && _total == 0) {
      _goToStep(0);
      AppToast.error(context, 'Choose at least one ticket');
      return;
    }

    final name = _name.text.trim(), email = _email.text.trim(), phone = _phone.text.trim();
    final answers = <String, dynamic>{..._answers};
    for (final e in _text.entries) {
      if (e.value.text.trim().isNotEmpty) answers[e.key] = e.value.text.trim();
    }
    for (final f in _mapped) {
      answers[f.id] = switch (f.builtin) { 'name' => name, 'email' => email, _ => phone };
    }
    final count = _ticketed ? _total : 1;
    final due = _due;
    if (_payBlocked != null) {
      setState(() => _serverError = _payBlocked);
      AppToast.error(context, _payBlocked!);
      return;
    }
    final payOnline = _payOnline ? _payMethod : null;

    setState(() {
      _submitting = true;
      _serverError = null;
    });
    try {
      final result = await ref.read(attendeeApiProvider).register(
            widget.event.slug,
            name: name,
            email: email,
            phone: phone,
            items: _ticketed ? _items() : null,
            promoCode: _promoUsed ? _promo!.code : null,
            additional: additional || widget.additional,
            answers: answers,
            payOnlineWith: payOnline,
          );
      if (result.paymentRequired) {
        if (mounted) setState(() => _submitting = false);
        await _completePayment(result, email);
        return;
      }
      if (result.registrationOnly) {
        ref.invalidate(eventDetailProvider(widget.event.slug));
        if (!mounted) return;
        setState(() => _submitting = false);
        await showDialog<void>(
          context: context,
          builder: (ctx) => AlertDialog(
            icon: const Icon(Icons.check_circle_rounded, color: AppColors.success, size: 40),
            title: Text(result.alreadyRegistered ? "You're already registered" : "You're registered"),
            content: Text(
              'Registration no. ${result.registrationNumber}. A confirmation was sent to $email. No ticket or pass is needed.',
            ),
            actions: [TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Done'))],
          ),
        );
        if (mounted) Navigator.of(context).pop();
        return;
      }
      final event = _event;
      final passes = [for (final t in result.tickets) StoredPass.fromRegistration(t, event)];
      await ref.read(passesProvider.notifier).saveAll(passes);
      ref.invalidate(eventDetailProvider(widget.event.slug));
      if (!mounted) return;

      if (result.alreadyRegistered) {
        setState(() => _submitting = false);
        final more = await _alreadyRegisteredSheet(email, passes.length, count);
        if (!mounted) return;
        if (more) {
          await _submit(additional: true);
          return;
        }
        Navigator.of(context).pushReplacement(MaterialPageRoute(
          builder: (_) => PassViewScreen(
            passes: passes,
            banner: passes.length > 1
                ? 'You were already registered — your ${passes.length} passes are saved on this phone.'
                : 'You were already registered — your pass is saved on this phone.',
          ),
        ));
        return;
      }

      final total = result.orderTotal ?? due;
      final detail = [
        if (result.orderReference != null) 'Order ${result.orderReference}',
        total > 0 ? 'Pay ${formatRupees(total)} at the venue' : 'Free',
      ].join(' · ');
      AppToast.success(
          context, passes.length > 1 ? "You're registered — ${passes.length} passes" : "You're registered");
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => PassViewScreen(
          passes: passes,
          banner: passes.length > 1
              ? "You're in! ${passes.length == 2 ? 'Both' : 'All ${passes.length}'} passes are saved on this phone and sent to $email."
              : "You're in! Your pass is saved on this phone.",
          bannerDetail: _ticketed ? detail : null,
        ),
      ));
    } catch (e) {
      if (!mounted) return;
      final msg = friendlyError(e);
      final status = e is DioException ? e.response?.statusCode : null;
      final aboutTickets = status == 409 || RegExp(r'ticket|promo|spot|per order', caseSensitive: false).hasMatch(msg);
      setState(() {
        _serverError = msg;
        if (aboutTickets && _ticketed) _step = 0;
      });
      if (_scroll.hasClients) _scroll.jumpTo(0);
      AppToast.error(context, msg);
      if (status == 409) {
        _refreshAvailability();
      } else {
        ref.invalidate(eventDetailProvider(widget.event.slug));
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  /// Tickets are held: pay with Khalti / eSewa, then show the passes (or why not).
  Future<void> _completePayment(RegistrationResult result, String email) async {
    final slug = widget.event.slug;
    final r = await runPayment(
      context,
      start: result.payment!,
      eventSlug: slug,
      doneLabel: 'View my passes',
      offerVenue: _venueAllowed && _payOpts.venue,
    );
    ref.invalidate(eventDetailProvider(slug));
    if (!mounted) return;
    switch (r.next) {
      case PaymentNext.done:
        final data = r.intent?.result ?? const <String, dynamic>{};
        final tickets = [
          if (data['tickets'] is List)
            for (final t in data['tickets'] as List)
              if (t is Map) Map<String, dynamic>.from(t),
        ];
        if (tickets.isEmpty) {
          setState(() => _serverError = data['needs_attention']?.toString() ??
              'Your payment was received. Your passes will be emailed to $email — or find them in Tickets once you sign in.');
          return;
        }
        final passes = [for (final t in tickets) StoredPass.fromRegistration(t, _event)];
        await ref.read(passesProvider.notifier).saveAll(passes);
        if (!mounted) return;
        final order = data['order'] is Map ? Map<String, dynamic>.from(data['order'] as Map) : const <String, dynamic>{};
        final pay = order['payment'] is Map ? (order['payment'] as Map)['label']?.toString() : null;
        AppToast.success(context, 'Payment received — you\'re in!');
        Navigator.of(context).pushReplacement(MaterialPageRoute(
          builder: (_) => PassViewScreen(
            passes: passes,
            banner: passes.length > 1
                ? 'Paid! ${passes.length == 2 ? 'Both' : 'All ${passes.length}'} passes are saved on this phone and sent to $email.'
                : 'Paid! Your pass is saved on this phone and sent to $email.',
            bannerDetail: [if (order['reference'] != null) 'Order ${order['reference']}', if (pay != null) pay].join(' · '),
          ),
        ));
      case PaymentNext.venue:
        setState(() {
          _payWith = 'venue';
          _serverError = "The online payment didn't go through, so nothing was charged. You can pay at the venue instead.";
        });
      case PaymentNext.retry:
        setState(() => _serverError =
            "The payment didn't go through, so nothing was charged. Try again, or choose another way to pay.");
      case PaymentNext.later:
        setState(() => _serverError =
            "We're still waiting for $_payName to confirm your payment. Your tickets stay held for a few minutes; "
            'find the payment in Profile → My payments.');
    }
    if (_scroll.hasClients) _scroll.jumpTo(0);
  }

  /// "You're already registered" → true to get [count] more tickets.
  Future<bool> _alreadyRegisteredSheet(String email, int have, int count) async {
    final result = await showAppSheet<bool>(
      context,
      builder: (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          SheetHeader(
            title: "You're already registered",
            message: '$email already has ${have == 1 ? 'a pass' : '$have passes'} for this event — '
                '${have == 1 ? "it's" : "they're"} saved on this phone now. '
                'Want ${count == 1 ? 'another ticket' : '$count more tickets'} in a new order?',
          ),
          PrimaryButton(
            label: count == 1 ? 'Get another ticket' : 'Get $count more tickets',
            icon: Icons.add_rounded,
            onPressed: () => Navigator.pop(ctx, true),
          ),
          const SizedBox(height: 8),
          PrimaryButton(
            label: have == 1 ? 'View my pass' : 'View my passes',
            tone: ButtonTone.neutral,
            tonal: true,
            onPressed: () => Navigator.pop(ctx, false),
          ),
        ],
      ),
    );
    return result == true;
  }

  // ── Build ──────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    // Rebuild when availability is refetched (or online payments are switched on / off).
    ref.watch(eventDetailProvider(widget.event.slug));
    ref.watch(moduleEnabledProvider(AppModule.payments));
    final e = _event;
    final onTickets = _ticketed && _step == 0;
    return PopScope(
      canPop: !_ticketed || _step == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _goToStep(0);
      },
      child: AppScaffold(
        title: onTickets ? 'Tickets' : (_ticketed ? 'Your details' : 'Register'),
        controller: _scroll,
        bottomBar: onTickets ? _ticketsBar() : _detailsBar(),
        slivers: [
          SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 0, 4, 20),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(e.title, style: AppType.body(15, weight: FontWeight.w500, color: AppColors.ink600)),
                    if (_ticketed)
                      Text(
                        onTickets ? 'Step 1 of 2 · Choose your tickets' : 'Step 2 of 2 · Who is going',
                        style: AppType.caption,
                      ),
                  ]),
                ),
                if (_needsFileUpload)
                  const _Notice(
                    tone: Tone.warning,
                    icon: Icons.upload_file_rounded,
                    text:
                        'This event asks for a file upload, which the app can\'t send yet. Please register on the Eventlaya website.',
                  ),
                if (widget.additional)
                  const _Notice(
                    tone: Tone.brand,
                    icon: Icons.add_circle_outline_rounded,
                    text: "You're getting more tickets on top of your passes for this event. They come as a new order.",
                  ),
                if (_serverError != null)
                  _Notice(tone: Tone.danger, icon: Icons.error_outline_rounded, text: _serverError!),
                if (onTickets) ..._ticketsStep() else _detailsStep(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Step 1: Tickets ────────────────────────────────────────────────────

  List<Widget> _ticketsStep() {
    final atCap = _total >= _orderMax;
    final anyOnSale = _types.any((t) => t.onSale);
    return [
      GroupedSection(
        header: 'Tickets',
        footer: _event.fullyBooked
            ? 'This event is fully booked.'
            : !anyOnSale
                ? 'No tickets are on sale right now.'
                : atCap
                    ? "That's the most for one order ($_orderMax)."
                    : _orderMax == 1
                        ? 'One ticket per order.'
                        : 'Up to $_orderMax tickets per order. Each ticket gets its own pass and QR.',
        children: [for (final t in _types) _ticketRow(t)],
      ),
      if (_event.hasPromoCodes) _promoSection(),
      if (_total > 0) _summarySection(),
    ];
  }

  Widget _ticketRow(PublicTicketType t) {
    final q = _q(t);
    final max = _maxFor(t);
    final dim = !t.onSale;
    final discounted = t.promoApplies && t.discountedPrice != null && t.discountedPrice! < t.price;
    final subtitle = [
      if (t.description.isNotEmpty) t.description,
      if (t.onSale && t.availabilityLabel != null) t.availabilityLabel!,
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Flexible(
                child: Text(t.name,
                    style: AppType.rowTitle.copyWith(color: dim ? AppColors.ink400 : AppColors.textPrimary)),
              ),
              if (t.unlocked) ...[
                const SizedBox(width: 6),
                const StatusBadge('Unlocked', tone: Tone.success, dot: false)
              ],
            ]),
            if (subtitle.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(subtitle, style: AppType.rowSubtitle, maxLines: 2, overflow: TextOverflow.ellipsis),
            ],
            const SizedBox(height: 4),
            Row(children: [
              Text(t.priceLabel, style: AppType.heading(15, color: dim ? AppColors.ink400 : AppColors.textPrimary)),
              if (discounted && t.price > 0) ...[
                const SizedBox(width: 6),
                Text(formatRupees(t.price), style: AppType.caption.copyWith(decoration: TextDecoration.lineThrough)),
              ],
            ]),
          ]),
        ),
        const SizedBox(width: 8),
        if (dim)
          StatusBadge(t.availabilityLabel ?? 'Unavailable', tone: Tone.neutral, dot: false)
        else
          _Stepper(
            value: q,
            onMinus: q > 0 ? () => _setQty(t, q - 1) : null,
            onPlus: q < max ? () => _setQty(t, q + 1) : null,
            label: t.name,
          ),
      ]),
    );
  }

  Widget _promoSection() {
    if (_promo != null) {
      final unused = _total > 0 && !_promoUsed;
      return GroupedSection(
        header: 'Promo code',
        footer: unused ? "${_promo!.code} doesn't apply to the tickets you've chosen." : null,
        children: [
          ListRow(
            leading: RowIcon(Icons.local_offer_rounded, background: unused ? AppColors.ink400 : AppColors.success),
            title: _promo!.code,
            subtitle: _promo!.label,
            trailing: NavTextButton(label: 'Remove', onPressed: _removePromo),
          ),
        ],
      );
    }
    return GroupedSection(
      header: 'Promo code',
      children: [
        Row(children: [
          Expanded(
            child: FieldRow(
              controller: _promoCtrl,
              label: 'Have a code?',
              icon: Icons.local_offer_outlined,
              textCapitalization: TextCapitalization.characters,
              onSubmitted: (_) => _applyPromo(),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: _checkingPromo
                ? const SizedBox(
                    width: 44,
                    child:
                        Center(child: SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))))
                : NavTextButton(label: 'Apply', bold: true, onPressed: _applyPromo),
          ),
        ]),
      ],
    );
  }

  /// "2 × General  Rs 1,000", discount, total. [onEdit] adds a Change link.
  Widget _summarySection({VoidCallback? onEdit}) {
    final discount = _subtotal - _due;
    final due = _due;
    return GroupedSection(
      header: onEdit == null ? 'Order summary' : 'Your tickets',
      headerTrailing: onEdit == null ? null : NavTextButton(label: 'Change', onPressed: onEdit),
      footer: 'Prices are confirmed when you register.',
      children: [
        for (final t in _chosen)
          ListRow(
            title: '${_q(t)} × ${t.name}',
            trailing: Text(
              t.price > 0 ? formatRupees(_q(t) * t.price) : 'Free',
              style: AppType.body(15, color: AppColors.textSecondary),
            ),
          ),
        if (discount > 0)
          ListRow(
            leading: const Icon(Icons.local_offer_rounded, size: 18, color: AppColors.success),
            title: 'Promo ${_promo?.code ?? ''}'.trim(),
            trailing: Text('− ${formatRupees(discount)}',
                style: AppType.body(15, weight: FontWeight.w600, color: AppColors.success)),
          ),
        ListRow(
          title: 'Total',
          titleWidget: Text('Total', style: AppType.heading(16)),
          subtitle: due <= 0
              ? 'Free — no payment needed'
              : _payOnline
                  ? 'Pay ${formatRupees(due)} online with $_payName'
                  : _onlineProviders.isNotEmpty && _onlineOnlyNames.isEmpty && _venueAllowed
                      ? 'Pay ${formatRupees(due)} online or at the venue'
                      : 'Pay ${formatRupees(due)} at the venue',
          trailing: Text(due > 0 ? formatRupees(due) : 'Free', style: AppType.heading(17)),
        ),
      ],
    );
  }

  Widget _ticketsBar() {
    final n = _total;
    final due = _due;
    return Row(children: [
      Expanded(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(n == 0 ? 'No tickets yet' : (due > 0 ? formatRupees(due) : 'Free'), style: AppType.heading(19)),
          Text(
            n == 0
                ? 'Choose at least one'
                : '$n ticket${n == 1 ? '' : 's'}${due > 0 ? ' · ${_onlineProviders.isEmpty ? 'pay at the venue' : (_venueAllowed ? 'pay online or at the venue' : 'pay online')}' : ''}',
            style: AppType.caption,
          ),
        ]),
      ),
      PrimaryButton(
        label: 'Continue',
        expand: false,
        onPressed: n == 0 ? null : () => _goToStep(1),
      ),
    ]);
  }

  // ── Step 2: Your details ───────────────────────────────────────────────

  Widget _detailsStep() {
    final n = _ticketed ? _total : 1;
    final guests = _ticketed ? _lines.skip(1).toList() : const <_Line>[];
    final buyer = _name.text.trim().isEmpty ? 'Your name' : _name.text.trim();
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_ticketed) _summarySection(onEdit: () => _goToStep(0)),
          if (_due > 0 && _onlineProviders.isNotEmpty)
            PaymentMethodPicker(
              providers: _onlineProviders,
              venue: _venueAllowed,
              amount: _due,
              selected: _payMethod,
              onChanged: (v) => setState(() => _payWith = v),
              venueBlockedReason: _onlineOnlyNames.isNotEmpty && _payOpts.venue
                  ? '${_onlineOnlyNames.join(', ')} tickets must be paid online.'
                  : null,
              footer: _payOnline && _payOpts.holdMinutes != null
                  ? 'Your tickets are held for ${_payOpts.holdMinutes} minutes while you pay. '
                      'Passes come once $_payName confirms the payment.'
                  : null,
            ),
          if (_payBlocked != null) _Notice(tone: Tone.danger, icon: Icons.credit_card_off_rounded, text: _payBlocked!),
          if (!_ticketed && _event.hasPromoCodes) _promoSection(),
          GroupedSection(
            header: 'Your details',
            separatorInset: 50,
            footer: n > 1
                ? '${n == 2 ? 'Both' : 'All $n'} passes are sent to this email too.'
                : 'Your pass is sent to this email too.',
            children: [
              FieldRow(
                controller: _name,
                label: 'Full name',
                icon: Icons.person_outline_rounded,
                textCapitalization: TextCapitalization.words,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.name],
                onChanged: guests.isEmpty ? null : (_) => setState(() {}),
                validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your full name' : null,
              ),
              FieldRow(
                controller: _email,
                label: 'Email',
                icon: Icons.mail_outline_rounded,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.email],
                validator: (v) {
                  final s = (v ?? '').trim();
                  if (s.isEmpty) return 'Enter your email';
                  if (!_emailRe.hasMatch(s)) return 'Enter an email like name@example.com';
                  return null;
                },
              ),
              FieldRow(
                controller: _phone,
                label: _phoneRequired ? 'Mobile number' : 'Mobile number (optional)',
                icon: Icons.phone_outlined,
                keyboardType: TextInputType.phone,
                autofillHints: const [AutofillHints.telephoneNumber],
                validator: (v) {
                  final s = (v ?? '').trim();
                  if (_phoneRequired && s.isEmpty) return 'Enter your mobile number';
                  if (s.isNotEmpty && s.replaceAll(RegExp(r'\D'), '').length < 7) {
                    return 'Enter a valid number, e.g. +977 98XXXXXXXX';
                  }
                  return null;
                },
              ),
            ],
          ),
          if (guests.isNotEmpty)
            GroupedSection(
              header: 'Guest names (optional)',
              separatorInset: 50,
              footer: 'Ticket 1${_lines.isEmpty ? '' : ' · ${_lines.first.type.name}'} is yours. '
                  'Leave a name blank and that pass reads "$buyer · Guest 2" and so on.',
              children: [
                for (var i = 0; i < guests.length; i++)
                  FieldRow(
                    controller: _guestCtrl(guests[i]),
                    label: 'Ticket ${i + 2} · ${guests[i].type.name}',
                    hint: '$buyer · Guest ${i + 2}',
                    icon: Icons.person_add_alt_rounded,
                    textCapitalization: TextCapitalization.words,
                    textInputAction: i == guests.length - 1 ? TextInputAction.done : TextInputAction.next,
                  ),
              ],
            ),
          if (_questions.isNotEmpty)
            GroupedSection(
              header: widget.form?.title.isNotEmpty == true ? widget.form!.title : 'Event questions',
              children: [for (final f in _questions) _questionRow(f)],
            ),
          if (_consents.isNotEmpty)
            GroupedSection(
              children: [
                for (final f in _consents)
                  _CheckRow(
                    label: f.label,
                    value: _answers[f.id] == true,
                    error: _choiceErrors[f.id],
                    onChanged: (v) => setState(() {
                      _answers[f.id] = v;
                      _choiceErrors.remove(f.id);
                    }),
                  ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _detailsBar() {
    final e = _event;
    final String price;
    final String caption;
    if (_ticketed) {
      price = _due > 0 ? formatRupees(_due) : 'Free';
      caption = _due <= 0 ? 'No payment needed' : (_payOnline ? 'Pay online · $_payName' : 'Pay at the venue');
    } else {
      price = e.priceSummary;
      caption = 'No payment needed';
    }
    return Row(children: [
      Expanded(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(price, style: AppType.heading(19)),
          Text(caption, style: AppType.caption),
        ]),
      ),
      PrimaryButton(
        label: _payOnline ? 'Pay ${formatRupees(_due)}' : 'Register',
        icon: _payOnline ? Icons.lock_rounded : null,
        expand: false,
        loading: _submitting,
        onPressed: _needsFileUpload || _payBlocked != null ? null : _submit,
      ),
    ]);
  }

  Widget _questionRow(FormFieldSpec f) {
    final label = f.required ? f.label : '${f.label} (optional)';
    switch (f.type) {
      case 'select':
      case 'radio':
      case 'checkbox':
        final multi = f.type == 'checkbox';
        final selected = multi ? List<String>.from(_answers[f.id] as List? ?? const []) : _answers[f.id];
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: AppType.body(14, weight: FontWeight.w500)),
            if (f.helpText.isNotEmpty) Text(f.helpText, style: AppType.caption),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final o in f.options)
                ChoiceChip(
                  label: Text(o),
                  selected: multi ? (selected as List<String>).contains(o) : selected == o,
                  selectedColor: AppColors.brandTint,
                  labelStyle: AppType.body(14, weight: FontWeight.w500),
                  side: const BorderSide(color: AppColors.ink200),
                  showCheckmark: multi,
                  onSelected: (on) => setState(() {
                    _choiceErrors.remove(f.id);
                    if (multi) {
                      final cur = List<String>.from(selected as List<String>);
                      on ? cur.add(o) : cur.remove(o);
                      _answers[f.id] = cur;
                    } else {
                      _answers[f.id] = on ? o : null;
                    }
                  }),
                ),
            ]),
            if (_choiceErrors[f.id] != null) ...[
              const SizedBox(height: 6),
              Text(_choiceErrors[f.id]!, style: AppType.body(12, color: AppColors.danger)),
            ],
          ]),
        );
      case 'date':
        final v = _answers[f.id] as String?;
        return ListRow(
          title: label,
          subtitle: _choiceErrors[f.id] ?? (f.helpText.isNotEmpty ? f.helpText : null),
          value: v == null ? 'Choose' : DateFormat('d MMM y').format(DateTime.parse(v)),
          chevron: true,
          onTap: () async {
            final now = DateTime.now();
            final picked = await showDatePicker(
              context: context,
              initialDate: v == null ? now : DateTime.parse(v),
              firstDate: DateTime(1900),
              lastDate: DateTime(now.year + 10),
            );
            if (picked != null) {
              setState(() {
                _answers[f.id] = DateFormat('yyyy-MM-dd').format(picked);
                _choiceErrors.remove(f.id);
              });
            }
          },
        );
      default:
        return FieldRow(
          controller: _text[f.id]!,
          label: label,
          hint: f.placeholder.isEmpty ? null : f.placeholder,
          maxLines: f.type == 'paragraph' ? 4 : 1,
          keyboardType: switch (f.type) {
            'number' => const TextInputType.numberWithOptions(decimal: true),
            'email' => TextInputType.emailAddress,
            'phone' => TextInputType.phone,
            'paragraph' => TextInputType.multiline,
            _ => TextInputType.text,
          },
          validator: (v) {
            final s = (v ?? '').trim();
            if (f.required && s.isEmpty) return 'This field is required';
            if (s.isNotEmpty && f.type == 'number' && num.tryParse(s) == null) return 'Enter a number';
            if (s.isNotEmpty && f.type == 'email' && !_emailRe.hasMatch(s)) return 'Enter a valid email';
            return null;
          },
        );
    }
  }
}

class _CheckRow extends StatelessWidget {
  final String label;
  final bool value;
  final String? error;
  final ValueChanged<bool> onChanged;
  const _CheckRow({required this.label, required this.value, required this.onChanged, this.error});

  @override
  Widget build(BuildContext context) {
    return ListRow(
      leading: Checkbox(
        value: value,
        activeColor: AppColors.brand,
        onChanged: (v) => onChanged(v ?? false),
      ),
      title: label,
      subtitleWidget: error == null ? null : Text(error!, style: AppType.body(12, color: AppColors.danger)),
      onTap: () => onChanged(!value),
    );
  }
}

class _Notice extends StatelessWidget {
  final Tone tone;
  final IconData icon;
  final String text;
  const _Notice({required this.tone, required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tone.tint,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: tone.color.withValues(alpha: 0.35), width: 0.5),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 18, color: tone.strong),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: AppType.body(13, weight: FontWeight.w500, color: AppColors.ink800))),
      ]),
    );
  }
}

/// − 0 + quantity control for a ticket type.
class _Stepper extends StatelessWidget {
  final int value;
  final VoidCallback? onMinus;
  final VoidCallback? onPlus;
  final String label;
  const _Stepper({required this.value, required this.onMinus, required this.onPlus, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      _StepButton(icon: Icons.remove_rounded, tooltip: 'One less $label', onPressed: onMinus),
      SizedBox(
        width: 34,
        child: Text(
          '$value',
          textAlign: TextAlign.center,
          style: AppType.heading(17, color: value > 0 ? AppColors.textPrimary : AppColors.ink400),
          semanticsLabel: '$value $label',
        ),
      ),
      _StepButton(icon: Icons.add_rounded, tooltip: 'One more $label', onPressed: onPlus, filled: true),
    ]);
  }
}

class _StepButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final bool filled;
  const _StepButton({required this.icon, required this.tooltip, required this.onPressed, this.filled = false});

  @override
  Widget build(BuildContext context) {
    final on = onPressed != null;
    final bg = !on ? AppColors.ink100 : (filled ? AppColors.brand : AppColors.brandTint);
    final fg = !on ? AppColors.ink300 : (filled ? Colors.white : AppColors.brand);
    return Tooltip(
      message: tooltip,
      child: Material(
        color: bg,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: SizedBox.square(dimension: 40, child: Icon(icon, size: 20, color: fg)),
        ),
      ),
    );
  }
}
