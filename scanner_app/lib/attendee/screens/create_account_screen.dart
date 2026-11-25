import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smart_auth/smart_auth.dart';
import '../../core/legal.dart';
import '../../providers/auth_provider.dart';
import '../../ui/ui.dart';
import '../data/account_api.dart';
import 'verify_email_screen.dart';

/// Attendee sign-up: `POST /api/auth/register/` (account_type attendee), then
/// sign in with the same "Keep me signed in" choice, then verify the email
/// (a 6-digit code was sent). Pops `true` once signed in.
class CreateAccountScreen extends ConsumerStatefulWidget {
  final bool keepSignedIn;
  const CreateAccountScreen({super.key, this.keepSignedIn = true});

  /// Android SMS autofill (off in widget tests).
  static bool smsAutofill = true;

  @override
  ConsumerState<CreateAccountScreen> createState() => _CreateAccountScreenState();
}

class _CreateAccountScreenState extends ConsumerState<CreateAccountScreen> {
  final _formKey = GlobalKey<FormState>();
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  bool _obscure = true;
  /// The number the SMS code went to; null until "Send code" succeeds.
  String? _codeSentTo;
  int _resendIn = 0;
  Timer? _timer;
  bool _listening = false;

  /// Android: the system asks "Allow Eventlaya to read this message?", then the code fills in and the
  /// account is created. No SMS permission needed; typing still works.
  Future<void> _listenForSms() async {
    if (!CreateAccountScreen.smsAutofill || kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    if (_listening) await SmartAuth.instance.removeUserConsentApiListener();
    _listening = true;
    try {
      final res = await SmartAuth.instance.getSmsWithUserConsentApi(matcher: r'\d{6}');
      final code = res.data?.code;
      if (!mounted || code == null || _busy) return;
      _code.text = code;
      unawaited(_submit());
    } catch (_) {
      // Autofill is a bonus.
    } finally {
      _listening = false;
    }
  }
  bool _busy = false;
  late bool _keep = widget.keepSignedIn;

  @override
  void dispose() {
    _timer?.cancel();
    if (_listening) unawaited(SmartAuth.instance.removeUserConsentApiListener());
    for (final c in [_first, _last, _email, _password, _phone, _code]) {
      c.dispose();
    }
    super.dispose();
  }

  void _startTimer(int seconds) {
    _timer?.cancel();
    setState(() => _resendIn = seconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted || _resendIn <= 1) {
        t.cancel();
        if (mounted) setState(() => _resendIn = 0);
        return;
      }
      setState(() => _resendIn--);
    });
  }

  /// Step 1: text a 6-digit code to the mobile number.
  Future<void> _sendCode() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final phone = _phone.text.trim();
    try {
      final wait = await AccountApi().sendPhoneCode(phone);
      if (!mounted) return;
      setState(() => _codeSentTo = phone);
      _startTimer(wait);
      unawaited(_listenForSms());
      AppToast.success(context, 'Code sent to $phone');
    } catch (e) {
      if (mounted) AppToast.error(context, AccountError.from(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Step 2: create the account with the code.
  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (_codeSentTo == null || _phone.text.trim() != _codeSentTo) return _sendCode();
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final email = _email.text.trim();
    try {
      await AccountApi().registerAttendee(
        firstName: _first.text.trim(),
        lastName: _last.text.trim(),
        email: email,
        password: _password.text,
        phone: _phone.text.trim(),
        phoneCode: _code.text.trim(),
      );
      final ok = await ref.read(authProvider.notifier).login(email, _password.text, keepSignedIn: _keep);
      if (!mounted) return;
      if (!ok) {
        // Account exists; let them sign in from the previous screen.
        AppToast.info(context, 'Account created. Sign in to continue.');
        Navigator.of(context).pop(false);
        return;
      }
      HapticFeedback.mediumImpact();
      await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => const VerifyEmailScreen(afterSignUp: true),
      ));
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) AppToast.error(context, AccountError.from(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Create account',
      bottomBar: PrimaryButton(
        label: _codeSentTo == null ? 'Send code to my phone' : 'Create account',
        icon: _codeSentTo == null ? Icons.sms_outlined : null,
        loading: _busy,
        onPressed: _submit,
      ),
      slivers: [
        SliverToBoxAdapter(
          child: AutofillGroup(
            child: Form(
              key: _formKey,
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 0, 4, 20),
                  child: Text(
                    'Keep your passes on every device, vote with your ticket and review events you went to.',
                    style: AppType.body(15, color: AppColors.textSecondary),
                  ),
                ),
                GroupedSection(
                  separatorInset: 50,
                  children: [
                    FieldRow(
                      controller: _first,
                      label: 'First name',
                      icon: Icons.person_outline_rounded,
                      textCapitalization: TextCapitalization.words,
                      autofillHints: const [AutofillHints.givenName],
                      validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your first name' : null,
                    ),
                    FieldRow(
                      controller: _last,
                      label: 'Last name',
                      icon: Icons.badge_outlined,
                      textCapitalization: TextCapitalization.words,
                      autofillHints: const [AutofillHints.familyName],
                    ),
                    FieldRow(
                      controller: _email,
                      label: 'Email',
                      icon: Icons.mail_outline_rounded,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      validator: (v) {
                        final s = (v ?? '').trim();
                        if (s.isEmpty) return 'Enter your email';
                        if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(s)) return 'Enter a valid email';
                        return null;
                      },
                    ),
                    FieldRow(
                      controller: _phone,
                      label: 'Mobile number',
                      hint: '98XXXXXXXX',
                      icon: Icons.phone_iphone_rounded,
                      keyboardType: TextInputType.phone,
                      autofillHints: const [AutofillHints.telephoneNumber],
                      onChanged: (v) {
                        // A new number needs a new code
                        if (_codeSentTo != null && v.trim() != _codeSentTo) setState(() => _codeSentTo = null);
                      },
                      validator: (v) {
                        var d = (v ?? '').replaceAll(RegExp(r'\D'), '');
                        if (d.startsWith('977') && d.length == 13) d = d.substring(3);
                        if (d.isEmpty) return 'Enter your mobile number';
                        return RegExp(r'^9[78]\d{8}$').hasMatch(d) ? null : 'Enter a 10-digit mobile number (98… or 97…)';
                      },
                    ),
                    FieldRow(
                      controller: _password,
                      label: 'Password',
                      icon: Icons.lock_outline_rounded,
                      obscure: _obscure,
                      autofillHints: const [AutofillHints.newPassword],
                      suffix: IconButton(
                        tooltip: _obscure ? 'Show password' : 'Hide password',
                        icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined, size: 20),
                        onPressed: () => setState(() => _obscure = !_obscure),
                      ),
                      validator: (v) => (v ?? '').length < 8 ? 'Use at least 8 characters' : null,
                    ),
                  ],
                ),
                if (_codeSentTo != null)
                  GroupedSection(
                    header: 'Verify your mobile',
                    footer: 'Enter the 6-digit code we sent by SMS to $_codeSentTo. It expires in 10 minutes.',
                    children: [
                      FieldRow(
                        controller: _code,
                        label: 'SMS code',
                        hint: '6-digit code',
                        icon: Icons.sms_outlined,
                        keyboardType: TextInputType.number,
                        autofillHints: const [AutofillHints.oneTimeCode],
                        validator: (v) =>
                            RegExp(r'^\d{6}$').hasMatch((v ?? '').trim()) ? null : 'Enter the 6-digit code',
                      ),
                      ListRow(
                        title: '',
                        titleWidget: Text(
                          _resendIn > 0 ? 'Resend code in ${_resendIn}s' : 'Resend code',
                          style: AppType.body(15,
                              weight: FontWeight.w600,
                              color: _resendIn > 0 ? AppColors.textTertiary : AppColors.brand),
                        ),
                        onTap: _resendIn > 0 || _busy ? null : _sendCode,
                      ),
                    ],
                  ),
                GroupedSection(
                  footer: 'We\'ll text a code to your mobile, and email a code to confirm your address.',
                  children: [
                    ListRow(
                      title: 'Keep me signed in',
                      subtitle: 'Untick on shared phones',
                      trailing: Switch(value: _keep, onChanged: (v) => setState(() => _keep = v)),
                      onTap: () => setState(() => _keep = !_keep),
                    ),
                  ],
                ),
                const Padding(
                  padding: EdgeInsets.fromLTRB(8, 0, 8, 8),
                  child: LegalConsentText(lead: 'By creating an account you agree to the'),
                ),
              ]),
            ),
          ),
        ),
      ],
    );
  }
}
