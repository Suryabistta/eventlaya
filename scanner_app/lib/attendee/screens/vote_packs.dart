import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/ticket_type_model.dart';
import '../../payments/payment_models.dart';
import '../../payments/payment_result_screen.dart';
import '../../payments/payment_widgets.dart';
import '../../providers/auth_provider.dart';
import '../../providers/modules_provider.dart';
import '../../ui/ui.dart';
import '../data/contest_api.dart';
import '../models/contest.dart';
import '../providers/contest_providers.dart';
import '../providers/pass_providers.dart';
import 'captcha_sheet.dart';
import 'profile_screen.dart' show openSignIn;
import 'vote_sheet.dart';

/// Vote packs: pick a pack and Khalti / eSewa, pay, and the votes land in the voter's balance
/// (and, when the contest has "buy and vote", go straight to [contestant]).
/// Only offered when the API says packs can be bought (`paid.payments_available`).
Future<void> openVotePacks(BuildContext context, {required Contest contest, Contestant? contestant}) {
  return showAppSheet<void>(context, builder: (_) => _PacksSheet(contest: contest, contestant: contestant));
}

class _PacksSheet extends ConsumerStatefulWidget {
  final Contest contest;
  final Contestant? contestant;
  const _PacksSheet({required this.contest, this.contestant});

  @override
  ConsumerState<_PacksSheet> createState() => _PacksSheetState();
}

class _PacksSheetState extends ConsumerState<_PacksSheet> {
  Contest get c => widget.contest;
  static const custom = '__custom__';

  /// A pack id, or [custom] for "any number of votes".
  late String? _pack = c.paid.packs.firstOrNull?.id ?? (c.paid.customVotes ? custom : null);
  late int _votes = 10.clamp(1, c.paid.maxCustomVotes);
  late final _votesCtrl = TextEditingController(text: '$_votes');
  String? _provider;
  List<PaymentProviderInfo>? _providers;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadProviders();
  }

  Future<void> _loadProviders() async {
    if (c.paid.providers.isNotEmpty) {
      setState(() {
        _providers = c.paid.providers;
        _provider = c.paid.providers.where((p) => p.accepts(_amount ?? 0)).firstOrNull?.id;
      });
      return;
    }
    try {
      final list = await ref.read(paymentApiProvider).providers();
      if (!mounted) return;
      setState(() {
        _providers = list;
        _provider = list.where((p) => p.accepts(_amount ?? 0)).firstOrNull?.id;
        if (list.isEmpty) _error = 'Online payment isn\'t available right now.';
      });
    } catch (e) {
      if (!mounted) return;
      noteModuleDisabled(ref, e);
      setState(() {
        _providers = const [];
        _error = ContestFailure.from(e).message;
      });
    }
  }

  VotePackOffer? get _selected => c.paid.packs.where((p) => p.id == _pack).firstOrNull;
  bool get _isCustom => _pack == custom;

  /// What the chosen option costs.
  double? get _amount => _isCustom ? c.paid.priceFor(_votes) : _selected?.price;

  String get _amountLabel => formatRupees(_amount ?? 0);

  @override
  void dispose() {
    _votesCtrl.dispose();
    super.dispose();
  }

  /// Pick a pack / custom amount; keeps the payment method valid (Khalti needs Rs 10 or more).
  void _choose({String? pack, int? votes}) {
    setState(() {
      if (pack != null) _pack = pack;
      if (votes != null) {
        _votes = votes.clamp(1, c.paid.maxCustomVotes);
        if (_votesCtrl.text != '$_votes') _votesCtrl.text = '$_votes';
      }
      final ok = (_providers ?? const <PaymentProviderInfo>[]).where((p) => p.accepts(_amount ?? 0)).toList();
      if (!ok.any((p) => p.id == _provider)) _provider = ok.firstOrNull?.id;
    });
  }

  Future<VoterIdentity?> _identity() async {
    final signedIn = ref.read(authProvider).user != null;
    final pass = ref.read(passForEventProvider(c.eventSlug));
    var id = await readyIdentity(c, pass: pass, signedIn: signedIn);
    if (id != null || !mounted) return id;
    if (c.usesOtp) {
      await showVoteSheet(context, contest: c);
      return readyIdentity(c, pass: pass, signedIn: signedIn);
    }
    if (c.voteMode == 'account' || c.voteMode == 'ticket') {
      if (c.voteMode == 'ticket' && signedIn) return null;
      final ok = await openSignIn(context);
      if (!ok) return null;
      return readyIdentity(c, pass: pass, signedIn: true);
    }
    return null;
  }

  Future<void> _buy() async {
    final pack = _selected, provider = _provider;
    if ((pack == null && !_isCustom) || provider == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final id = await _identity();
      if (!mounted) return;
      if (id == null) {
        setState(() => _error = c.voteMode == 'ticket'
            ? 'Vote packs go to a ticket. Save your pass on this phone (or sign in with the account that has it) first.'
            : 'Verify who you are first, so the votes go to you.');
        return;
      }
      String? captcha;
      if (c.captchaSiteKey != null) {
        captcha = await requestCaptcha(context, siteKey: c.captchaSiteKey!, fallbackUrl: c.webUrl);
        if (captcha == null || !mounted) return;
      }
      final user = ref.read(authProvider).user;
      final name = user == null ? '' : '${user.firstName} ${user.lastName}'.trim();
      // Contact for refunds: kept by the server only when it is the verified voter's own.
      final phone = c.voteMode == 'sms_otp' ? await VoterStore.lastContact('sms') : null;
      final email = c.voteMode == 'email_otp' ? await VoterStore.lastContact('email') : user?.email;
      if (!mounted) return;
      final start = await ref.read(contestApiProvider).buyPack(
            c.eventSlug,
            c.ref,
            packId: _isCustom ? null : pack!.id,
            votes: _isCustom ? _votes : null,
            provider: provider,
            identity: id,
            contestantId: widget.contestant?.id,
            captchaToken: captcha,
            returnUrl: widget.contestant == null ? c.webUrl : c.contestantUrl(widget.contestant!.ref),
            payerName: name.isEmpty ? 'Voter' : name, // Khalti needs a name
            payerPhone: phone,
            payerEmail: email,
          );
      if (!mounted) return;
      final nav = Navigator.of(context);
      final result = await runPayment(
        context,
        start: start,
        contestRef: c.ref,
        eventSlug: c.eventSlug,
        doneLabel: 'Back to voting',
        paidDetails: (_, intent) => _PaidVotes(intent: intent),
      );
      ref.invalidate(myAllowanceProvider);
      ref.invalidate(contestProvider((slug: c.eventSlug, ref: c.ref)));
      if (result.next == PaymentNext.done && nav.mounted) nav.pop();
    } on ContestFailure catch (e) {
      if (!mounted) return;
      if (e.moduleDisabled) noteModuleDisabled(ref, e);
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final providers = _providers;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      SheetHeader(
        title: 'Get more votes',
        message: widget.contestant != null
            ? (c.paid.buyAndVote
                ? 'Extra votes, cast for ${widget.contestant!.label} as soon as the payment is confirmed.'
                : 'Extra votes on top of your free ones, for ${widget.contestant!.label} or anyone you like.')
            : 'Extra votes on top of your free ones. They\'re added to your balance once the payment is confirmed.',
      ),
      for (final p in c.paid.packs) ...[
        _PackTile(pack: p, selected: p.id == _pack, onTap: () => _choose(pack: p.id)),
        const SizedBox(height: 8),
      ],
      if (c.paid.customVotes) ...[
        _CustomVotesTile(
          selected: _isCustom,
          votes: _votes,
          max: c.paid.maxCustomVotes,
          pricePerVote: c.paid.pricePerVote ?? 0,
          controller: _votesCtrl,
          onTap: () => _choose(pack: custom),
          onVotes: (n) => _choose(pack: custom, votes: n),
        ),
        const SizedBox(height: 8),
      ],
      const SizedBox(height: 8),
      if (providers == null)
        const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()))
      else if (providers.isNotEmpty)
        PaymentMethodPicker(
          header: 'Pay with',
          providers: providers,
          venue: false,
          amount: _amount ?? 0,
          selected: _provider,
          onChanged: (v) => setState(() => _provider = v),
          footer: (providers.any((p) => p.id == 'khalti') && (_amount ?? 0) < 10)
              ? 'Khalti takes Rs 10 or more. Pay with eSewa, or pick more votes.'
              : null,
        ),
      if (_error != null) ...[
        ContestNoticeInline(text: _error!, tone: Tone.danger),
        const SizedBox(height: 12),
      ],
      PrimaryButton(
        label: _amount == null ? 'Pick a pack' : 'Pay $_amountLabel',
        icon: Icons.lock_rounded,
        loading: _busy,
        onPressed: _amount == null || _provider == null || _busy ? null : _buy,
      ),
      const SizedBox(height: 8),
      Text(
        'Paid votes count like free ones and follow the same rules. Payments go to Eventlaya, which pays the organizer.',
        textAlign: TextAlign.center,
        style: AppType.caption,
      ),
    ]);
  }
}

class _PackTile extends StatelessWidget {
  final VotePackOffer pack;
  final bool selected;
  final VoidCallback onTap;
  const _PackTile({required this.pack, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      button: true,
      child: Material(
        color: selected ? AppColors.brandTint : AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: selected ? AppColors.brand : AppColors.ink200, width: selected ? 1.5 : 1),
            ),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${pack.totalVotes} votes', style: AppType.heading(22, weight: FontWeight.w800)),
                  if (pack.bonusVotes > 0)
                    Text('includes ${pack.bonusVotes} bonus', style: AppType.body(12.5, weight: FontWeight.w600, color: AppColors.success)),
                  if (pack.label.isNotEmpty) Text(pack.label, style: AppType.caption),
                ]),
              ),
              Text(pack.priceLabel, style: AppType.heading(18)),
              const SizedBox(width: 10),
              Icon(selected ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded,
                  color: selected ? AppColors.brand : AppColors.ink300),
            ]),
          ),
        ),
      ),
    );
  }
}

/// "Any number of votes" at the per-vote price, with a − / number / + stepper and the live price.
class _CustomVotesTile extends StatelessWidget {
  final bool selected;
  final int votes;
  final int max;
  final double pricePerVote;
  final TextEditingController controller;
  final VoidCallback onTap;
  final ValueChanged<int> onVotes;
  const _CustomVotesTile({
    required this.selected,
    required this.votes,
    required this.max,
    required this.pricePerVote,
    required this.controller,
    required this.onTap,
    required this.onVotes,
  });

  @override
  Widget build(BuildContext context) {
    Widget step(IconData icon, String tip, VoidCallback? on) => IconButton.filledTonal(
          tooltip: tip,
          onPressed: on,
          icon: Icon(icon),
          style: IconButton.styleFrom(backgroundColor: AppColors.brandTint, foregroundColor: AppColors.brand),
        );
    return Semantics(
      selected: selected,
      child: Material(
        color: selected ? AppColors.brandTint : AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: selected ? AppColors.brand : AppColors.ink200, width: selected ? 1.5 : 1),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('Any number of votes', style: AppType.heading(18, weight: FontWeight.w800)),
                    Text('${formatRupees(pricePerVote)} a vote · up to $max', style: AppType.caption),
                  ]),
                ),
                const SizedBox(width: 10),
                Icon(selected ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded,
                    color: selected ? AppColors.brand : AppColors.ink300),
              ]),
              if (selected) ...[
                const SizedBox(height: 10),
                Row(children: [
                  step(Icons.remove_rounded, 'One vote fewer', votes > 1 ? () => onVotes(votes - 1) : null),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 96,
                    child: TextField(
                      controller: controller,
                      keyboardType: TextInputType.number,
                      textAlign: TextAlign.center,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                      style: AppType.heading(22, weight: FontWeight.w800),
                      decoration: InputDecoration(
                        isDense: true,
                        suffixText: 'votes',
                        suffixStyle: AppType.caption,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      onChanged: (v) {
                        final n = int.tryParse(v);
                        if (n != null && n >= 1) onVotes(n > max ? max : n);
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  step(Icons.add_rounded, 'One vote more', votes < max ? () => onVotes(votes + 1) : null),
                  const Spacer(),
                  Text('= ${formatRupees(pricePerVote * votes)}', style: AppType.heading(18)),
                ]),
              ],
            ]),
          ),
        ),
      ),
    );
  }
}

/// On the payment result: what the pack added.
class _PaidVotes extends StatelessWidget {
  final PaymentIntent intent;
  const _PaidVotes({required this.intent});

  @override
  Widget build(BuildContext context) {
    final r = intent.result ?? const {};
    final purchase = r['purchase'] is Map ? Map<String, dynamic>.from(r['purchase'] as Map) : const <String, dynamic>{};
    final total = int.tryParse(purchase['total_votes']?.toString() ?? '');
    final credits = int.tryParse(r['credits']?.toString() ?? '');
    final autoVoted = int.tryParse(purchase['auto_voted']?.toString() ?? '') ?? 0;
    final note = purchase['auto_vote_note']?.toString() ?? '';
    final who = purchase['contestant'] is Map ? (purchase['contestant'] as Map)['name']?.toString() : null;
    final lines = [
      if (total != null) '$total votes added.',
      if (autoVoted > 0) '$autoVoted ${autoVoted == 1 ? 'vote was' : 'votes were'} cast for ${who ?? 'your pick'}.',
      if (note.isNotEmpty) note,
      if (credits != null) 'Your balance: $credits ${credits == 1 ? 'vote' : 'votes'} to give.',
    ];
    if (lines.isEmpty) return const SizedBox.shrink();
    return ContestNoticeInline(text: lines.join(' '), tone: Tone.success);
  }
}
