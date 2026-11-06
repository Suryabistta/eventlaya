import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/auth_provider.dart';
import '../../ui/ui.dart';
import '../data/account_api.dart';
import '../providers/pass_providers.dart';

/// Enter the 6-digit email code. Verifying links tickets registered with
/// this email to the account (they then show on every device).
class VerifyEmailScreen extends ConsumerStatefulWidget {
  /// Right after sign-up the server already sent a code; elsewhere one is
  /// requested when the screen opens.
  final bool afterSignUp;
  const VerifyEmailScreen({super.key, this.afterSignUp = false});

  @override
  ConsumerState<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends ConsumerState<VerifyEmailScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  bool _sending = false;
  int _wait = 0;
  Timer? _timer;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.afterSignUp) {
      _startWait(60);
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) => _resend());
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _code.dispose();
    super.dispose();
  }

  void _startWait(int seconds) {
    _timer?.cancel();
    setState(() => _wait = seconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _wait = (_wait - 1).clamp(0, 9999));
      if (_wait == 0) t.cancel();
    });
  }

  Future<void> _resend() async {
    setState(() => _sending = true);
    try {
      final msg = await AccountApi().sendVerificationCode();
      if (!mounted) return;
      AppToast.success(context, msg);
      _startWait(60);
    } catch (e) {
      final err = AccountError.from(e);
      if (!mounted) return;
      if (err.code == 'already_verified') {
        await ref.read(authProvider.notifier).refreshMe();
        if (mounted) Navigator.of(context).pop(true);
        return;
      }
      if (err.code == 'rate_limited') {
        _startWait(int.tryParse(err.data['retry_after']?.toString() ?? '') ?? 60);
      } else {
        AppToast.error(context, err.message);
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _verify() async {
    final code = _code.text.replaceAll(RegExp(r'\D'), '');
    if (code.length != 6) {
      setState(() => _error = 'Enter the 6-digit code from the email.');
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await AccountApi().verifyEmail(code);
      if (r.user != null) {
        await ref.read(authProvider.notifier).setUser(r.user!);
      } else {
        await ref.read(authProvider.notifier).refreshMe();
      }
      await ref.read(passesProvider.notifier).refresh();
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      AppToast.success(
        context,
        r.linkedTickets > 0
            ? 'Email verified · ${r.linkedTickets} ticket${r.linkedTickets == 1 ? '' : 's'} added to your account'
            : 'Email verified',
      );
      Navigator.of(context).pop(true);
    } catch (e) {
      final err = AccountError.from(e);
      if (mounted) setState(() => _error = err.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final email = ref.watch(authProvider).user?.email ?? 'your email';
    return AppScaffold(
      title: 'Verify email',
      actions: [
        if (widget.afterSignUp) NavTextButton(label: 'Later', onPressed: () => Navigator.of(context).pop(false)),
      ],
      bottomBar: PrimaryButton(label: 'Verify', loading: _busy, onPressed: _verify),
      slivers: [
        SliverToBoxAdapter(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 0, 4, 20),
              child: Text(
                'We sent a 6-digit code to $email. Verifying adds tickets you registered with this email to your account.',
                style: AppType.body(15, color: AppColors.textSecondary),
              ),
            ),
            GroupedSection(
              footer: _error,
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: TextField(
                    controller: _code,
                    autofocus: true,
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.center,
                    maxLength: 6,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    style: AppType.mono(28, weight: FontWeight.w700),
                    decoration: const InputDecoration(
                      counterText: '',
                      hintText: '••••••',
                      filled: false,
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                    ),
                    onSubmitted: (_) => _verify(),
                  ),
                ),
              ],
            ),
            TextButton(
              onPressed: _wait > 0 || _sending ? null : _resend,
              child: Text(_wait > 0 ? 'Send a new code in ${_wait}s' : (_sending ? 'Sending…' : 'Send a new code')),
            ),
          ]),
        ),
      ],
    );
  }
}
