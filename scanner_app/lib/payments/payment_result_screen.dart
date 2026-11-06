import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/api_client.dart';
import '../ui/ui.dart';
import 'checkout_screen.dart';
import 'payment_api.dart';
import 'payment_models.dart';

/// What the buyer chose on the result screen.
enum PaymentNext {
  /// Paid (and delivered): carry on.
  done,

  /// Not paid: try again (same or another method).
  retry,

  /// Not paid: switch to paying at the venue (tickets only).
  venue,

  /// Left without a final answer (still pending) — the payment keeps being checked.
  later,
}

class PaymentResult {
  final PaymentNext next;
  final PaymentIntent? intent;
  const PaymentResult(this.next, this.intent);
}

/// Runs a started payment end to end: checkout page → back in the app → status screen.
/// Records it in "My payments" first so an interrupted payment can be found again.
Future<PaymentResult> runPayment(
  BuildContext context, {
  required PurchaseStart start,
  String? eventSlug,
  String? contestRef,
  String doneLabel = 'Done',
  bool offerVenue = false,
  Widget Function(BuildContext context, PaymentIntent intent)? paidDetails,
  PaymentApi? api,
}) async {
  await PaymentHistory.record(start, eventSlug: eventSlug, contestRef: contestRef);
  if (!context.mounted) return PaymentResult(PaymentNext.later, start.payment);
  final p = start.payment;
  final exit = await CheckoutScreen.open(
    context,
    intentId: p.id,
    checkout: start.checkout,
    providerName: p.providerName ?? providerName(p.provider),
    amountLabel: p.amountLabel,
  );
  if (!context.mounted) return PaymentResult(PaymentNext.later, p);
  final r = await Navigator.of(context).push<PaymentResult>(MaterialPageRoute(
    builder: (_) => PaymentResultScreen(
      intentId: p.id,
      initial: p,
      statusHint: exit.status,
      cameBack: exit.exit,
      doneLabel: doneLabel,
      offerVenue: offerVenue,
      paidDetails: paidDetails,
      api: api,
    ),
  ));
  return r ?? PaymentResult(PaymentNext.later, p);
}

/// Confirms a payment with the server and shows paid / waiting / failed / expired.
///
/// Polls `GET /api/payments/intents/<id>/` (the server asks Khalti / eSewa each time, at most every
/// 4 s) while the payment is open or the purchase isn't delivered yet, and again whenever the app
/// comes back to the foreground (e.g. after paying in the browser).
class PaymentResultScreen extends StatefulWidget {
  final String intentId;
  final PaymentIntent? initial;
  final String? statusHint;
  final CheckoutExit? cameBack;
  final String doneLabel;
  final bool offerVenue;
  final Widget Function(BuildContext context, PaymentIntent intent)? paidDetails;
  final PaymentApi? api;

  /// Poll interval (tests use a short one).
  final Duration every;

  const PaymentResultScreen({
    super.key,
    required this.intentId,
    this.initial,
    this.statusHint,
    this.cameBack,
    this.doneLabel = 'Done',
    this.offerVenue = false,
    this.paidDetails,
    this.api,
    this.every = const Duration(seconds: 3),
  });

  @override
  State<PaymentResultScreen> createState() => _PaymentResultScreenState();
}

class _PaymentResultScreenState extends State<PaymentResultScreen> with WidgetsBindingObserver {
  late final PaymentApi _api = widget.api ?? PaymentApi();
  PaymentIntent? _intent;
  String? _error;
  bool _checking = false;
  bool _resuming = false;
  Timer? _timer;
  int _polls = 0;
  bool _celebrated = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _intent = widget.initial;
    _check();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _check();
  }

  bool get _settled {
    final i = _intent;
    if (i == null) return false;
    if (i.isPaid) return i.fulfilled;
    return !i.isOpen;
  }

  Future<void> _check() async {
    _timer?.cancel();
    if (_checking) return;
    setState(() => _checking = true);
    try {
      final i = await _api.intent(widget.intentId);
      if (!mounted) return;
      setState(() {
        _intent = i;
        _error = null;
      });
      unawaited(PaymentHistory.updateStatus(i.id, i.status));
      if (i.isDone && !_celebrated) {
        _celebrated = true;
        HapticFeedback.mediumImpact();
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e is DioException ? ApiClient().errorMessage(e) : 'Something went wrong. Try again.');
    } finally {
      if (mounted) {
        setState(() => _checking = false);
        _polls++;
        if (!_settled) {
          // Quick at first, then calmer (Khalti links stay open for an hour).
          final wait = _polls < 40 ? widget.every : widget.every * 4;
          _timer = Timer(wait, _check);
        }
      }
    }
  }

  Future<void> _continuePayment() async {
    final i = _intent;
    if (i == null || i.provider == null) return;
    setState(() => _resuming = true);
    try {
      final start = await _api.checkout(i.id, i.provider!);
      if (!mounted) return;
      await CheckoutScreen.open(
        context,
        intentId: i.id,
        checkout: start.checkout,
        providerName: i.providerName ?? providerName(i.provider),
        amountLabel: i.amountLabel,
      );
      if (mounted) await _check();
    } catch (e) {
      if (mounted) {
        AppToast.error(context, e is DioException ? ApiClient().errorMessage(e) : "Couldn't reopen the payment");
      }
      await _check();
    } finally {
      if (mounted) setState(() => _resuming = false);
    }
  }

  void _finish(PaymentNext next) => Navigator.of(context).pop(PaymentResult(next, _intent));

  @override
  Widget build(BuildContext context) {
    final i = _intent;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        _finish(i == null
            ? PaymentNext.later
            : (i.isDone ? PaymentNext.done : (i.isOpen ? PaymentNext.later : PaymentNext.retry)));
      },
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent),
        child: Scaffold(
          backgroundColor: AppColors.background,
          body: SafeArea(
            child: LayoutBuilder(builder: (context, c) {
              final gutter = AppScaffold.gutterFor(c.maxWidth);
              return ListView(
                padding: EdgeInsets.fromLTRB(gutter + 8, 32, gutter + 8, 24),
                children: [_body(context, i)],
              );
            }),
          ),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, PaymentIntent? i) {
    if (i == null) {
      return _error != null
          ? _Hero(
              icon: Icons.cloud_off_rounded,
              tone: Tone.warning,
              title: "Couldn't check the payment",
              message: _error!,
              actions: [
                PrimaryButton(label: 'Check again', loading: _checking, onPressed: _check),
                const SizedBox(height: 8),
                PrimaryButton(
                    label: 'Close', tone: ButtonTone.neutral, tonal: true, onPressed: () => _finish(PaymentNext.later)),
              ],
            )
          : const _Hero(
              icon: Icons.hourglass_top_rounded, tone: Tone.brand, title: 'Checking your payment…', busy: true);
    }

    final provider = i.providerName ?? providerName(i.provider);
    final facts = _Facts(intent: i);

    if (i.isPaid && !i.fulfilled) {
      return _Hero(
        icon: Icons.check_circle_rounded,
        tone: Tone.success,
        title: 'Payment received',
        message: 'Getting everything ready. This takes a moment.',
        busy: true,
        footer: facts,
      );
    }
    if (i.isPaid) {
      return _Hero(
        icon: Icons.check_circle_rounded,
        tone: Tone.success,
        title: 'Payment successful',
        message: '${i.amountLabel} paid with $provider.',
        footer: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (widget.paidDetails != null) ...[widget.paidDetails!(context, i), const SizedBox(height: 16)],
          facts,
        ]),
        actions: [
          PrimaryButton(
              label: widget.doneLabel, icon: Icons.arrow_forward_rounded, onPressed: () => _finish(PaymentNext.done))
        ],
      );
    }
    if (i.status == 'refunded') {
      return _Hero(
        icon: Icons.undo_rounded,
        tone: Tone.neutral,
        title: 'Payment refunded',
        message: 'This payment was refunded by the organizer.',
        footer: facts,
        actions: [PrimaryButton(label: 'Close', onPressed: () => _finish(PaymentNext.later))],
      );
    }
    if (i.isOpen) {
      final late = _polls > 3;
      return _Hero(
        icon: Icons.hourglass_top_rounded,
        tone: Tone.warning,
        title: widget.statusHint == 'cancelled' ? 'Payment not finished' : 'Waiting for $provider',
        message: late
            ? "We haven't had a confirmation from $provider yet. If you paid, this updates on its own — "
                'you can also leave and find it later in Profile → My payments.'
            : "We're confirming your payment with $provider…",
        busy: !late,
        footer: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (_error != null) ...[
            Text(_error!, style: AppType.body(13, color: AppColors.danger)),
            const SizedBox(height: 8),
          ],
          facts,
        ]),
        actions: [
          if (i.provider != null) ...[
            PrimaryButton(label: 'Continue payment', loading: _resuming, onPressed: _continuePayment),
            const SizedBox(height: 8),
          ],
          PrimaryButton(
              label: 'Check again', tone: ButtonTone.neutral, tonal: true, loading: _checking, onPressed: _check),
          const SizedBox(height: 8),
          PrimaryButton(
            label: 'Pay another way',
            tone: ButtonTone.neutral,
            tonal: true,
            onPressed: () => _finish(PaymentNext.retry),
          ),
        ],
      );
    }
    // failed / cancelled / expired
    final (title, message) = switch (i.status) {
      'expired' => (
          'Payment timed out',
          'The payment wasn\'t finished in time, so nothing was charged and the hold was released.'
        ),
      'cancelled' => ('Payment cancelled', 'You cancelled at $provider. Nothing was charged.'),
      // The provider's reason when it's a sentence (not just a status word like "failed").
      _ => (
          'Payment failed',
          (i.failureReason ?? '').trim().contains(' ')
              ? i.failureReason!
              : '$provider didn\'t complete the payment. Nothing was charged.'
        ),
    };
    return _Hero(
      icon: i.status == 'expired' ? Icons.timer_off_rounded : Icons.cancel_rounded,
      tone: Tone.danger,
      title: title,
      message: message,
      footer: facts,
      actions: [
        PrimaryButton(label: 'Try again', icon: Icons.refresh_rounded, onPressed: () => _finish(PaymentNext.retry)),
        if (widget.offerVenue) ...[
          const SizedBox(height: 8),
          PrimaryButton(
            label: 'Pay at the venue instead',
            tone: ButtonTone.neutral,
            tonal: true,
            onPressed: () => _finish(PaymentNext.venue),
          ),
        ],
        const SizedBox(height: 8),
        PrimaryButton(
            label: 'Close', tone: ButtonTone.neutral, tonal: true, onPressed: () => _finish(PaymentNext.later)),
      ],
    );
  }
}

class _Hero extends StatelessWidget {
  final IconData icon;
  final Tone tone;
  final String title;
  final String? message;
  final bool busy;
  final Widget? footer;
  final List<Widget> actions;
  const _Hero({
    required this.icon,
    required this.tone,
    required this.title,
    this.message,
    this.busy = false,
    this.footer,
    this.actions = const [],
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 24),
        Center(
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0.6, end: 1),
            duration: const Duration(milliseconds: 380),
            curve: Curves.easeOutBack,
            builder: (_, s, child) => Transform.scale(scale: s, child: child),
            child: Container(
              width: 96,
              height: 96,
              decoration: BoxDecoration(color: tone.tint, shape: BoxShape.circle),
              child: Icon(icon, size: 52, color: tone.strong),
            ),
          ),
        ),
        const SizedBox(height: 20),
        Text(title, textAlign: TextAlign.center, style: AppType.heading(26, weight: FontWeight.w800)),
        if (message != null) ...[
          const SizedBox(height: 8),
          Text(message!, textAlign: TextAlign.center, style: AppType.body(15, color: AppColors.textSecondary)),
        ],
        if (busy) ...[
          const SizedBox(height: 20),
          const Center(child: SizedBox.square(dimension: 24, child: CircularProgressIndicator(strokeWidth: 2.4))),
        ],
        if (footer != null) ...[const SizedBox(height: 24), footer!],
        if (actions.isNotEmpty) ...[const SizedBox(height: 24), ...actions],
      ],
    );
  }
}

class _Facts extends StatelessWidget {
  final PaymentIntent intent;
  const _Facts({required this.intent});

  @override
  Widget build(BuildContext context) {
    final i = intent;
    return GroupedSection(
      margin: EdgeInsets.zero,
      children: [
        if (i.description.isNotEmpty) ListRow(title: 'For', value: i.description),
        ListRow(title: 'Amount', value: i.amountLabel),
        ListRow(title: 'Paid with', value: i.providerName ?? providerName(i.provider)),
        ListRow(title: 'Status', value: i.statusLabel),
        if (i.providerTxnId != null) ListRow(title: 'Transaction', value: i.providerTxnId),
      ],
    );
  }
}
