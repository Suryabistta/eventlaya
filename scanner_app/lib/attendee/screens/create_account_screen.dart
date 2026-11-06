import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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

  @override
  ConsumerState<CreateAccountScreen> createState() => _CreateAccountScreenState();
}

class _CreateAccountScreenState extends ConsumerState<CreateAccountScreen> {
  final _formKey = GlobalKey<FormState>();
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true;
  bool _busy = false;
  late bool _keep = widget.keepSignedIn;

  @override
  void dispose() {
    for (final c in [_first, _last, _email, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final email = _email.text.trim();
    try {
      await AccountApi().registerAttendee(
        firstName: _first.text.trim(),
        lastName: _last.text.trim(),
        email: email,
        password: _password.text,
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
      bottomBar: PrimaryButton(label: 'Create account', loading: _busy, onPressed: _submit),
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
                GroupedSection(
                  footer: 'We\'ll email you a 6-digit code to confirm your address.',
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
