import 'dart:async';
import 'package:clock/clock.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smart_auth/smart_auth.dart';
import '../../core/storage.dart';
import '../../providers/auth_provider.dart';
import '../../providers/modules_provider.dart';
import '../../ui/ui.dart';
import '../data/contest_api.dart';
import '../models/contest.dart';
import '../models/stored_pass.dart';
import '../providers/contest_providers.dart';
import '../providers/pass_providers.dart';
import '../widgets/contest_widgets.dart';
import 'captcha_sheet.dart';
import 'profile_screen.dart' show openSignIn;

/// What the vote sheet hands back.
class VoteSheetResult {
  final VoteReceipt? receipt;

  /// The voter asked for more votes (opens the vote packs).
  final bool wantsPacks;

  /// The voter wants to share the contestant after voting.
  final bool share;
  const VoteSheetResult({this.receipt, this.wantsPacks = false, this.share = false});
}

/// Verifies the voter the contest's way, picks how many votes, and casts them.
/// With [contestant] null it only verifies (e.g. before buying a vote pack) and closes.
Future<VoteSheetResult?> showVoteSheet(
  BuildContext context, {
  required Contest contest,
  Contestant? contestant,
  ContestCategory? category,
}) {
  return showAppSheet<VoteSheetResult>(
    context,
    builder: (_) => VoteSheet(contest: contest, contestant: contestant, category: category),
  );
}

class VoteSheet extends ConsumerStatefulWidget {
  final Contest contest;
  final Contestant? contestant;
  final ContestCategory? category;

  /// Listen for the SMS with the code (Android SMS User Consent API). Off in widget tests.
  static bool smsAutofill = true;

  const VoteSheet({super.key, required this.contest, this.contestant, this.category});

  @override
  ConsumerState<VoteSheet> createState() => _VoteSheetState();
}

enum _Busy { none, send, verify, vote }

class _VoteSheetState extends ConsumerState<VoteSheet> {
  Contest get c => widget.contest;
  String get _mode => c.voteMode;
  bool get _otp => c.usesOtp;
  bool get _sms => _mode == 'sms_otp';
  String get _channelWord => _sms ? 'mobile number' : 'email';

  final _dest = TextEditingController();
  final _code = TextEditingController();
  final _ticket = TextEditingController();
  final _codeFocus = FocusNode();

  bool _loaded = false;
  String? _deviceId;
  VoterToken? _token;
  String? _codeSentTo;
  String? _codeFor;
  DateTime? _resendAt;
  Timer? _tick;
  bool _otherTicket = false;

  AllowanceSet? _allowance;
  bool _allowanceLoading = false;
  int _quantity = 1;
  _Busy _busy = _Busy.none;
  String? _error;
  VoteReceipt? _done;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    _deviceId = await AppStorage.getDeviceId();
    if (_otp) {
      _token = await VoterStore.token(c.id);
      _dest.text = await VoterStore.lastContact(_sms ? 'sms' : 'email') ?? '';
    } else if (_mode == 'contact') {
      final user = ref.read(authProvider).user;
      _dest.text = await VoterStore.lastContact('contact') ?? user?.email ?? '';
    } else if (_mode == 'ticket') {
      _ticket.text = await VoterStore.ticketCode(c.eventSlug) ?? '';
    }
    if (!mounted) return;
    setState(() => _loaded = true);
    _loadAllowance();
  }

  @override
  void dispose() {
    _tick?.cancel();
    if (VoteSheet.smsAutofill && _sms) unawaited(SmartAuth.instance.removeUserConsentApiListener());
    _dest.dispose();
    _code.dispose();
    _ticket.dispose();
    _codeFocus.dispose();
    super.dispose();
  }

  StoredPass? get _pass => ref.read(passForEventProvider(c.eventSlug));
  bool get _signedIn => ref.read(authProvider).user != null;

  /// Identity for vote / allowance requests, or null when the voter still has to identify.
  VoterIdentity? _identity() {
    final device = _deviceId;
    switch (_mode) {
      case 'sms_otp':
      case 'email_otp':
        return _token == null ? null : VoterIdentity(voterToken: _token!.token, deviceId: device);
      case 'ticket':
        final pass = _pass;
        if (pass != null && !_otherTicket) return VoterIdentity(ticketCode: pass.qrToken, deviceId: device);
        final code = _ticket.text.trim();
        if (code.isNotEmpty) return VoterIdentity(ticketCode: code, deviceId: device);
        if (_signedIn && pass == null && !_otherTicket) return VoterIdentity(deviceId: device);
        return null;
      case 'contact':
        final v = _dest.text.trim();
        return v.isEmpty ? null : VoterIdentity(contact: v, deviceId: device);
      case 'account':
        return _signedIn ? VoterIdentity(deviceId: device) : null;
      default:
        return VoterIdentity(deviceId: device);
    }
  }

  /// Contact and typed ticket codes are only checked on submit (no lookup per keystroke).
  bool get _canAskAllowance {
    if (_otp) return _token != null;
    if (_mode == 'contact') return false;
    if (_mode == 'ticket') return (_pass != null && !_otherTicket) || (_signedIn && _pass == null && !_otherTicket);
    if (_mode == 'account') return _signedIn;
    return true;
  }

  Future<void> _loadAllowance() async {
    final id = _identity();
    if (!_canAskAllowance || id == null || widget.contestant == null || _done != null) return;
    setState(() => _allowanceLoading = true);
    try {
      final a = await ref.read(contestApiProvider).allowance(c.eventSlug, c.ref, id, contestantId: widget.contestant!.id);
      if (!mounted) return;
      setState(() {
        _allowance = a;
        _quantity = _quantity.clamp(1, _maxQ);
      });
    } on ContestFailure catch (e) {
      if (!mounted) return;
      if (e.needsVerification) await _forgetToken();
      if (e.moduleDisabled) noteModuleDisabled(ref, e);
      // Not fatal: the vote itself reports problems (e.g. a ticket that isn't scanned yet).
      if (e.status == 403 || e.status == 401) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _allowanceLoading = false);
    }
  }

  Allowance? get _myAllowance => _allowance?.forCategory(widget.category?.id);

  /// Never more than the server will accept for this contestant (free left for them + credits).
  int get _maxQ => maxVotesFor(c.rules, _myAllowance, contestantCap: c.rules.votesPerContestant);

  /// No splitting: the voter already gave their votes to someone else here.
  String? get _splitBlock {
    final a = _myAllowance, target = widget.contestant;
    if (c.rules.allowSplit || a == null || target == null || a.votedFor.isEmpty || a.votedFor.contains(target.id)) return null;
    final other = c.contestantById(a.votedFor.first);
    final who = other == null ? 'someone else' : other.label;
    return 'You already gave your votes to $who. In this contest all your votes go to one contestant.';
  }

  Future<void> _forgetToken() async {
    await VoterStore.saveToken(c.id, null);
    if (mounted) setState(() => _token = null);
  }

  Future<String?> _captcha() async {
    final key = c.captchaSiteKey;
    if (key == null) return null;
    final url = widget.contestant == null ? c.webUrl : c.contestUrlFor(widget.contestant!);
    final t = await requestCaptcha(context, siteKey: key, fallbackUrl: url);
    if (t == null && mounted) setState(() => _error = 'Complete the "I\'m not a robot" check to continue.');
    return t;
  }

  void _fail(ContestFailure e) {
    if (e.moduleDisabled) noteModuleDisabled(ref, e);
    setState(() => _error = e.message);
  }

  // ── OTP ────────────────────────────────────────────────────────────────

  int get _resendIn {
    final r = _resendAt;
    if (r == null) return 0;
    final s = r.difference(clock.now()).inMilliseconds;
    return s <= 0 ? 0 : (s / 1000).ceil();
  }

  void _startTicker() {
    _tick?.cancel();
    _tick = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() {});
      if (_resendIn == 0) t.cancel();
    });
  }

  Future<void> _sendCode() async {
    final dest = _dest.text.trim();
    setState(() => _error = null);
    if (dest.isEmpty) {
      setState(() => _error = _sms ? 'Enter your mobile number.' : 'Enter your email address.');
      return;
    }
    String? captcha;
    if (c.captchaSiteKey != null) {
      captcha = await _captcha();
      if (captcha == null) return;
    }
    setState(() => _busy = _Busy.send);
    try {
      final sent = await ref.read(contestApiProvider).sendCode(c.eventSlug, c.ref, dest, captchaToken: captcha);
      if (!mounted) return;
      unawaited(VoterStore.saveContact(_sms ? 'sms' : 'email', dest));
      setState(() {
        _codeSentTo = sent.destination.isEmpty ? dest : sent.destination;
        _codeFor = dest;
        _code.clear();
        _resendAt = clock.now().add(Duration(seconds: sent.resendIn));
      });
      _startTicker();
      _codeFocus.requestFocus();
      _listenForSms();
    } on ContestFailure catch (e) {
      if (!mounted) return;
      if (e.retryAfter != null) {
        _resendAt = clock.now().add(Duration(seconds: e.retryAfter!));
        _startTicker();
      }
      _fail(e);
    } finally {
      if (mounted) setState(() => _busy = _Busy.none);
    }
  }

  /// Android: ask to read the incoming SMS (User Consent API: the system shows "Allow Eventlaya to
  /// read this message?"), then fill and submit the code. No SMS permission needed.
  Future<void> _listenForSms() async {
    if (!_sms || !VoteSheet.smsAutofill || kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    try {
      final res = await SmartAuth.instance.getSmsWithUserConsentApi(matcher: r'\d{6}');
      final code = res.data?.code;
      if (!mounted || code == null || _token != null) return;
      _code.text = code;
      setState(() {});
      unawaited(_verify());
    } catch (_) {
      // Autofill is a bonus; typing / the keyboard's suggestion still work.
    }
  }

  Future<void> _verify() async {
    final code = _code.text.trim();
    setState(() => _error = null);
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() => _error = 'Enter the 6-digit code.');
      return;
    }
    if (_busy == _Busy.verify) return;
    setState(() => _busy = _Busy.verify);
    try {
      final token = await ref.read(contestApiProvider).verifyCode(c.eventSlug, c.ref, _codeFor ?? _dest.text.trim(), code);
      await VoterStore.saveToken(c.id, token);
      if (!mounted) return;
      HapticFeedback.selectionClick();
      setState(() {
        _token = token;
        _codeSentTo = null;
      });
      if (widget.contestant == null) {
        Navigator.of(context).pop(const VoteSheetResult());
        return;
      }
      await _loadAllowance();
    } on ContestFailure catch (e) {
      if (!mounted) return;
      if (e.status == 410) _code.clear();
      _fail(e);
    } finally {
      if (mounted) setState(() => _busy = _Busy.none);
    }
  }

  // ── Vote ───────────────────────────────────────────────────────────────

  Future<void> _vote() async {
    final target = widget.contestant;
    if (target == null) return;
    setState(() => _error = null);
    final id = _identity();
    if (id == null) {
      setState(() => _error = switch (_mode) {
            'ticket' => 'Enter the ticket code from your pass.',
            'contact' => 'Enter your phone number or email.',
            'account' => 'Sign in to vote.',
            _ => 'Verify your $_channelWord first.',
          });
      return;
    }
    String? captcha;
    if (c.captchaSiteKey != null) {
      captcha = await _captcha();
      if (captcha == null || !mounted) return;
    }
    FocusScope.of(context).unfocus();
    setState(() => _busy = _Busy.vote);
    try {
      final r = await ref.read(contestApiProvider).vote(
            c.eventSlug,
            c.ref,
            contestantId: target.id,
            categoryId: widget.category?.id,
            quantity: _quantity,
            identity: id,
            captchaToken: captcha,
          );
      if (_mode == 'ticket' && id.ticketCode != null && id.ticketCode != _pass?.qrToken) {
        unawaited(VoterStore.saveTicketCode(c.eventSlug, id.ticketCode!));
      }
      if (_mode == 'contact') unawaited(VoterStore.saveContact('contact', _dest.text.trim()));
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      setState(() {
        _done = r;
        final a = _allowance;
        if (a != null) {
          _allowance = widget.category == null
              ? AllowanceSet(r.allowance, a.categories)
              : AllowanceSet(a.main, {...a.categories, widget.category!.id: r.allowance});
        }
      });
      ref.invalidate(contestProvider((slug: c.eventSlug, ref: c.ref)));
      ref.invalidate(contestantProvider);
      ref.invalidate(myAllowanceProvider);
    } on ContestFailure catch (e) {
      if (!mounted) return;
      if (e.needsVerification) await _forgetToken();
      if (e.code == 'allowance_used' && e.freeRemaining != null) {
        final left = e.freeRemaining! + (e.credits ?? 0);
        if (left > 0) _quantity = _quantity.clamp(1, left);
      }
      if (e.staleContest) ref.invalidate(contestProvider((slug: c.eventSlug, ref: c.ref)));
      _fail(e);
      if (e.code == 'allowance_used' || e.code == 'no_split') unawaited(_loadAllowance());
    } finally {
      if (mounted) setState(() => _busy = _Busy.none);
    }
  }

  // ── Build ──────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    ref.watch(authProvider.select((s) => s.user?.id));
    if (_done != null) return _success(_done!);
    final target = widget.contestant;
    final id = _loaded ? _identity() : null;
    final a = _myAllowance;
    final split = _splitBlock;
    final out = a?.outHere ?? false;
    final maxPerSubmit = c.rules.maxVotesPerSubmit;
    final canBuy = c.paid.canBuy && ref.watch(moduleEnabledProvider(AppModule.paidVotes));

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      if (target != null) _targetHeader(target) else _verifyHeader(),
      const SizedBox(height: 16),
      if (!_loaded)
        const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))
      else ...[
        _identitySection(),
        if (target != null && id != null) ...[
          if (a != null || _allowanceLoading) ...[
            const SizedBox(height: 14),
            _allowanceBox(a, out),
          ],
          if (split != null) ...[
            const SizedBox(height: 12),
            ContestNoticeInline(text: split),
          ],
          if (maxPerSubmit > 1 && _maxQ > 1 && !out && split == null && (a != null || !_canAskAllowance)) ...[
            const SizedBox(height: 16),
            _quantityStepper(),
          ],
          if (c.rules.contestantCapText != null && widget.category == null) ...[
            const SizedBox(height: 8),
            Text(c.rules.contestantCapText!, style: AppType.caption),
          ],
        ],
      ],
      if (_error != null) ...[
        const SizedBox(height: 14),
        Semantics(liveRegion: true, child: ContestNoticeInline(text: _error!, tone: Tone.danger)),
      ],
      const SizedBox(height: 18),
      // OTP voters verify first ("Send code" / "Verify" are the actions until then).
      if (target != null && !(_otp && _token == null)) ...[
        PrimaryButton(
          label: _quantity > 1 ? 'Give $_quantity votes' : 'Vote',
          icon: Icons.how_to_vote_rounded,
          loading: _busy == _Busy.vote,
          onPressed: id == null || out || split != null || _busy != _Busy.none ? null : _vote,
        ),
        if (out && canBuy) ...[
          const SizedBox(height: 8),
          PrimaryButton(
            label: 'Get more votes',
            icon: Icons.add_circle_outline_rounded,
            tonal: true,
            onPressed: () => Navigator.of(context).pop(const VoteSheetResult(wantsPacks: true)),
          ),
        ],
      ],
    ]);
  }

  Widget _targetHeader(Contestant t) {
    final where = widget.category != null
        ? 'In ${widget.category!.name}'
        : c.currentRound != null
            ? '${c.currentRound!.name} · ${c.title}'
            : c.title;
    return Row(children: [
      SizedBox(width: 56, height: 70, child: ContestantPhoto(name: t.name, url: t.photoUrl, radius: 12, initialsSize: 20)),
      const SizedBox(width: 14),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          NumberTag(t.displayNumber, size: 13),
          const SizedBox(height: 4),
          Text('Vote for ${t.name}', maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.heading(21)),
          Text(where, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.caption),
        ]),
      ),
    ]);
  }

  Widget _verifyHeader() => SheetHeader(
        title: 'Verify to continue',
        message: 'Vote packs go to the voter verified here. ${c.methodText}',
      );

  // Who is voting, per the contest's method.
  Widget _identitySection() {
    switch (_mode) {
      case 'sms_otp':
      case 'email_otp':
        if (_token != null) {
          return _VerifiedRow(
            icon: Icons.verified_user_rounded,
            title: 'Verified as ${_token!.destination}',
            action: 'Change',
            onAction: () async {
              await _forgetToken();
              setState(() => _allowance = null);
            },
          );
        }
        return _codeSentTo != null ? _codeEntry() : _destinationEntry();
      case 'ticket':
        final pass = _pass;
        if (pass != null && !_otherTicket) {
          return _VerifiedRow(
            icon: Icons.confirmation_number_rounded,
            title: 'Voting with your pass ${pass.ticketNumber}',
            subtitle: c.requireCheckedIn ? 'Saved on this phone · must be scanned at the gate first' : 'Saved on this phone',
            action: 'Use another code',
            onAction: () => setState(() {
              _otherTicket = true;
              _allowance = null;
            }),
          );
        }
        if (_signedIn && pass == null && !_otherTicket) {
          return _VerifiedRow(
            icon: Icons.confirmation_number_rounded,
            title: 'Voting with the ticket on your account',
            subtitle: ref.read(authProvider).user?.email,
            action: 'Enter a code',
            onAction: () => setState(() {
              _otherTicket = true;
              _allowance = null;
            }),
          );
        }
        return GroupedSection(
          margin: EdgeInsets.zero,
          footer: c.requireCheckedIn
              ? "It's under the QR on your pass. Your ticket must have been scanned at the gate."
              : "It's printed under the QR code on your pass. One ticket = one voter.",
          children: [
            FieldRow(
              controller: _ticket,
              label: 'Ticket code',
              hint: 'TKT-0C4B62-0001',
              icon: Icons.confirmation_number_outlined,
              textCapitalization: TextCapitalization.characters,
              onChanged: (_) => setState(() {}),
            ),
          ],
        );
      case 'contact':
        return GroupedSection(
          margin: EdgeInsets.zero,
          footer: "Used only to count each person's votes. It isn't shown to anyone.",
          children: [
            FieldRow(
              controller: _dest,
              label: 'Phone or email',
              hint: '98XXXXXXXX or you@example.com',
              icon: Icons.alternate_email_rounded,
              keyboardType: TextInputType.emailAddress,
              onChanged: (_) => setState(() {}),
            ),
          ],
        );
      case 'account':
        final user = ref.read(authProvider).user;
        if (user != null) {
          return _VerifiedRow(icon: Icons.account_circle_rounded, title: 'Voting as ${user.email}', subtitle: 'One account = one voter');
        }
        return Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: AppColors.ink100, borderRadius: BorderRadius.circular(14)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Sign in to vote', style: AppType.body(15, weight: FontWeight.w600)),
            const SizedBox(height: 2),
            Text('Each Eventlaya account counts as one voter.', style: AppType.body(13, color: AppColors.ink600)),
            const SizedBox(height: 10),
            PrimaryButton(
              label: 'Sign in',
              icon: Icons.login_rounded,
              expand: false,
              onPressed: () async {
                final ok = await openSignIn(context);
                if (ok && mounted) {
                  setState(() => _error = null);
                  unawaited(_loadAllowance());
                }
              },
            ),
          ]),
        );
      default:
        return const _VerifiedRow(icon: Icons.phone_android_rounded, title: 'Voting from this phone');
    }
  }

  Widget _destinationEntry() {
    final wait = _resendIn;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      GroupedSection(
        margin: EdgeInsets.zero,
        footer: "We send a one-time code to check it's you. Your $_channelWord is never shown to anyone.",
        children: [
          FieldRow(
            controller: _dest,
            label: _sms ? 'Your mobile number' : 'Your email',
            hint: _sms ? '98XXXXXXXX' : 'you@example.com',
            icon: _sms ? Icons.phone_iphone_rounded : Icons.mail_outline_rounded,
            keyboardType: _sms ? TextInputType.phone : TextInputType.emailAddress,
            autofillHints: [_sms ? AutofillHints.telephoneNumber : AutofillHints.email],
            textInputAction: TextInputAction.send,
            onSubmitted: (_) => _sendCode(),
          ),
        ],
      ),
      const SizedBox(height: 12),
      PrimaryButton(
        label: wait > 0 ? 'Send code (wait ${wait}s)' : 'Send code',
        icon: Icons.sms_outlined,
        tone: ButtonTone.neutral,
        loading: _busy == _Busy.send,
        onPressed: wait > 0 || _busy != _Busy.none ? null : _sendCode,
      ),
    ]);
  }

  Widget _codeEntry() {
    final wait = _resendIn;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text.rich(
        TextSpan(children: [
          const TextSpan(text: 'We sent a 6-digit code to '),
          TextSpan(text: _codeSentTo, style: AppType.body(14, weight: FontWeight.w600)),
          const TextSpan(text: '. It works for 5 minutes.'),
        ]),
        style: AppType.body(14, color: AppColors.ink700),
      ),
      const SizedBox(height: 12),
      AutofillGroup(
        child: TextField(
          controller: _code,
          focusNode: _codeFocus,
          keyboardType: TextInputType.number,
          textAlign: TextAlign.center,
          maxLength: 6,
          autofillHints: const [AutofillHints.oneTimeCode],
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
          style: AppType.mono(28, weight: FontWeight.w600).copyWith(letterSpacing: 10),
          decoration: InputDecoration(
            counterText: '',
            hintText: '000000',
            hintStyle: AppType.mono(28, color: AppColors.ink300).copyWith(letterSpacing: 10),
            filled: true,
            fillColor: AppColors.ink50,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.ink200)),
            enabledBorder:
                OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.ink200)),
            focusedBorder:
                OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.brand, width: 1.5)),
          ),
          onChanged: (v) {
            setState(() {});
            if (v.length == 6) _verify();
          },
          onSubmitted: (_) => _verify(),
        ),
      ),
      const SizedBox(height: 12),
      PrimaryButton(
        label: 'Verify',
        loading: _busy == _Busy.verify,
        onPressed: _code.text.length == 6 && _busy == _Busy.none ? _verify : null,
      ),
      const SizedBox(height: 4),
      Wrap(alignment: WrapAlignment.spaceBetween, children: [
        NavTextButton(
          label: wait > 0 ? 'Resend in ${wait}s' : 'Send a new code',
          onPressed: wait > 0 || _busy != _Busy.none ? null : _sendCode,
        ),
        NavTextButton(
          label: _sms ? 'Wrong number?' : 'Wrong email?',
          color: AppColors.ink600,
          onPressed: () => setState(() {
            _codeSentTo = null;
            _error = null;
          }),
        ),
      ]),
    ]);
  }

  Widget _allowanceBox(Allowance? a, bool out) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(
        color: out ? AppColors.marigoldTint : AppColors.ink100,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(children: [
        Icon(out ? Icons.hourglass_bottom_rounded : Icons.how_to_vote_outlined,
            size: 18, color: out ? AppColors.marigoldDark : AppColors.ink600),
        const SizedBox(width: 8),
        Expanded(
          child: a == null
              ? Text('Checking your votes…', style: AppType.body(13.5, color: AppColors.ink600))
              : Text(widget.contestant == null ? a.line : a.lineFor(widget.contestant!.name),
                  style: AppType.body(13.5, weight: FontWeight.w500, color: AppColors.ink800)),
        ),
      ]),
    );
  }

  Widget _quantityStepper() {
    final max = _maxQ;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('How many votes?', style: AppType.body(14, weight: FontWeight.w600)),
      if (c.rules.allowSplit)
        Text('You can split your votes between contestants.', style: AppType.caption),
      const SizedBox(height: 8),
      Row(children: [
        _RoundButton(
          icon: Icons.remove_rounded,
          tooltip: 'One vote fewer',
          onPressed: _quantity > 1 ? () => setState(() => _quantity--) : null,
        ),
        SizedBox(
          width: 64,
          child: Text(
            '$_quantity',
            textAlign: TextAlign.center,
            semanticsLabel: '$_quantity votes',
            style: AppType.heading(32, weight: FontWeight.w800).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
          ),
        ),
        _RoundButton(
          icon: Icons.add_rounded,
          tooltip: 'One vote more',
          filled: true,
          onPressed: _quantity < max ? () => setState(() => _quantity++) : null,
        ),
        if (max > 2) ...[
          const SizedBox(width: 8),
          NavTextButton(label: 'All $max', bold: true, onPressed: () => setState(() => _quantity = max)),
        ],
      ]),
    ]);
  }

  Widget _success(VoteReceipt r) {
    final t = widget.contestant!;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      const SizedBox(height: 8),
      Center(
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.5, end: 1),
          duration: const Duration(milliseconds: 420),
          curve: Curves.elasticOut,
          builder: (_, s, child) => Transform.scale(scale: s, child: child),
          child: Container(
            width: 84,
            height: 84,
            decoration: const BoxDecoration(color: AppColors.successTint, shape: BoxShape.circle),
            child: const Icon(Icons.check_rounded, size: 52, color: AppColors.success),
          ),
        ),
      ),
      const SizedBox(height: 16),
      Text('Thank you for voting!', textAlign: TextAlign.center, style: AppType.heading(24, weight: FontWeight.w800)),
      const SizedBox(height: 6),
      Semantics(
        liveRegion: true,
        child: Text(r.message, textAlign: TextAlign.center, style: AppType.body(15, weight: FontWeight.w500)),
      ),
      const SizedBox(height: 4),
      Text(r.allowance.lineFor(t.name), textAlign: TextAlign.center, style: AppType.body(13.5, color: AppColors.ink600)),
      const SizedBox(height: 20),
      PrimaryButton(
        label: 'Ask friends to vote for ${t.name.split(' ').first}',
        icon: Icons.ios_share_rounded,
        tonal: true,
        onPressed: () => Navigator.of(context).pop(VoteSheetResult(receipt: r, share: true)),
      ),
      const SizedBox(height: 8),
      PrimaryButton(
        label: 'Done',
        tone: ButtonTone.neutral,
        tonal: true,
        onPressed: () => Navigator.of(context).pop(VoteSheetResult(receipt: r)),
      ),
    ]);
  }
}

class _VerifiedRow extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final String? action;
  final VoidCallback? onAction;
  const _VerifiedRow({required this.icon, required this.title, this.subtitle, this.action, this.onAction});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
      decoration: BoxDecoration(color: AppColors.successTint, borderRadius: BorderRadius.circular(14)),
      child: Row(children: [
        Icon(icon, size: 22, color: AppColors.success),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: AppType.body(14, weight: FontWeight.w600)),
            if (subtitle != null && subtitle!.isNotEmpty) Text(subtitle!, style: AppType.body(12.5, color: AppColors.ink600)),
          ]),
        ),
        if (action != null) NavTextButton(label: action!, onPressed: onAction),
      ]),
    );
  }
}

class _RoundButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final bool filled;
  const _RoundButton({required this.icon, required this.tooltip, this.onPressed, this.filled = false});

  @override
  Widget build(BuildContext context) {
    final on = onPressed != null;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: !on ? AppColors.ink100 : (filled ? AppColors.brand : AppColors.brandTint),
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: SizedBox.square(
            dimension: 48,
            child: Icon(icon, color: !on ? AppColors.ink300 : (filled ? Colors.white : AppColors.brand)),
          ),
        ),
      ),
    );
  }
}

extension on Contest {
  String contestUrlFor(Contestant t) => contestantUrl(t.ref);
}
