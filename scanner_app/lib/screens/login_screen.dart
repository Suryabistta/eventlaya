import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/legal.dart';
import '../core/storage.dart';
import '../providers/auth_provider.dart';
import '../providers/view_mode_provider.dart';
import '../ui/ui.dart';
import '../attendee/data/account_api.dart';
import '../attendee/screens/create_account_screen.dart';
import '../auth/social_sign_in.dart';
import 'role_router.dart';

/// Email sign-in. Opened as the app root (after a session expired) or pushed
/// from the attendee app ("Sign in" on Profile, or when an action needs an
/// account). When pushed, an attendee who signs in is popped back with
/// `true`; organizers and gate staff always continue to their own app.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  String _serverUrl = AppStorage.defaultServerUrl;
  bool _obscurePassword = true;
  bool _keepSignedIn = true;
  String? _socialBusy;

  // Hidden developer escape hatch: tap the logo 7 times to change the server.
  int _logoTaps = 0;
  DateTime? _lastLogoTap;

  @override
  void initState() {
    super.initState();
    _loadServerUrl();
    AppStorage.getLastEmail().then((email) {
      if (mounted && email != null && _emailCtrl.text.isEmpty) _emailCtrl.text = email;
    });
  }

  Future<void> _loadServerUrl() async {
    final url = await AppStorage.getServerUrl();
    if (mounted) setState(() => _serverUrl = url);
  }

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  void _onLogoTap() {
    final now = DateTime.now();
    if (_lastLogoTap == null || now.difference(_lastLogoTap!) > const Duration(seconds: 2)) {
      _logoTaps = 0;
    }
    _lastLogoTap = now;
    if (++_logoTaps >= 7) {
      _logoTaps = 0;
      _editServer();
    }
  }

  Future<void> _login() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;

    final success = await ref.read(authProvider.notifier).login(
          _emailCtrl.text.trim(),
          _passwordCtrl.text,
          keepSignedIn: _keepSignedIn,
        );

    if (!mounted) return;
    if (success) {
      await _afterSignIn();
    } else {
      HapticFeedback.mediumImpact();
      AppToast.error(context, ref.read(authProvider).error ?? "Couldn't sign in. Try again.");
    }
  }

  /// Where to go once signed in (any sign-in path).
  Future<void> _afterSignIn({int linkedTickets = 0}) async {
    final user = ref.read(authProvider).user;
    final name = user?.fullName;
    AppToast.success(
      context,
      [
        name == null ? 'Signed in' : 'Signed in as $name',
        if (linkedTickets > 0) '$linkedTickets ticket${linkedTickets == 1 ? '' : 's'} added to your account',
      ].join(' · '),
    );
    final isAttendee = user == null || (!user.isAdmin && !user.isStaff && !user.isVendor);
    final nav = Navigator.of(context);
    if (isAttendee && nav.canPop()) {
      nav.pop(true);
    } else {
      ref.read(preferAttendeeViewProvider.notifier).state = false;
      await AppStorage.savePreferAttendeeView(false);
      nav.pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const RoleRouter()),
        (_) => false,
      );
    }
  }

  /// Google / Facebook: provider token → backend → same session handling
  /// ("Keep me signed in") as email sign-in.
  Future<void> _social(String provider) async {
    if (_socialBusy != null) return;
    setState(() => _socialBusy = provider);
    try {
      final cfg = await ref.read(socialConfigProvider.future);
      final token = provider == 'google' ? await GoogleAuth.idToken(cfg) : await FacebookAuthBridge.accessToken();
      final data = await AccountApi().socialLogin(provider, token, remember: _keepSignedIn);
      final ok = await ref.read(authProvider.notifier).completeSignIn(data, keepSignedIn: _keepSignedIn);
      if (!mounted) return;
      if (ok) {
        await _afterSignIn(linkedTickets: int.tryParse(data['linked_tickets']?.toString() ?? '') ?? 0);
      } else {
        AppToast.error(context, ref.read(authProvider).error ?? "Couldn't sign in. Try again.");
      }
    } on SocialCancelled {
      // Closed the provider's sheet.
    } catch (e) {
      if (mounted) AppToast.error(context, AccountError.from(e).message);
    } finally {
      if (mounted) setState(() => _socialBusy = null);
    }
  }

  Future<void> _createAccount() async {
    final created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => CreateAccountScreen(keepSignedIn: _keepSignedIn)),
    );
    if (created == true && mounted) await _afterSignIn();
  }

  void _browseWithoutAccount() {
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const RoleRouter()));
  }

  Future<void> _editServer() async {
    final ctrl = TextEditingController(text: _serverUrl);
    final url = await showAppSheet<String>(
      context,
      builder: (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          const SheetHeader(
            title: 'Server',
            message:
                'The address of your Eventlaya server. Leave as is unless your organizer gave you a different one.',
          ),
          TextField(
            controller: ctrl,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Server address',
              hintText: 'https://api.eventlaya.com',
              prefixIcon: Icon(Icons.dns_outlined),
            ),
            onSubmitted: (v) => Navigator.pop(ctx, v),
          ),
          const SizedBox(height: 20),
          PrimaryButton(label: 'Save', onPressed: () => Navigator.pop(ctx, ctrl.text)),
        ],
      ),
    );
    if (url == null || !mounted) return;
    final trimmed = url.trim();
    if (trimmed.isEmpty || Uri.tryParse(trimmed)?.hasScheme != true) {
      AppToast.error(context, 'Enter a full address, like http://192.168.1.10:8000');
      return;
    }
    await AppStorage.saveServerUrl(trimmed);
    await _loadServerUrl();
    if (mounted) AppToast.success(context, 'Server updated');
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final canPop = Navigator.of(context).canPop();

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Stack(
          children: [
            Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 440),
                  child: AutofillGroup(
                    child: Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Align(
                            alignment: Alignment.centerLeft,
                            child: GestureDetector(
                              onTap: _onLogoTap,
                              behavior: HitTestBehavior.opaque,
                              excludeFromSemantics: true,
                              child: const Wordmark(size: 52),
                            ),
                          ),
                          const SizedBox(height: 24),
                          Text('Sign in to Eventlaya', style: AppType.heading(30, weight: FontWeight.w800)),
                          const SizedBox(height: 6),
                          Text(
                            'Your passes, your events and your team — all in one place.',
                            style: AppType.body(15, color: AppColors.textSecondary),
                          ),
                          const SizedBox(height: 28),
                          GroupedSection(
                            separatorInset: 50,
                            children: [
                              FieldRow(
                                controller: _emailCtrl,
                                label: 'Email',
                                icon: Icons.mail_outline_rounded,
                                keyboardType: TextInputType.emailAddress,
                                textInputAction: TextInputAction.next,
                                autofillHints: const [AutofillHints.email, AutofillHints.username],
                                validator: (v) {
                                  if (v == null || v.trim().isEmpty) return 'Enter your email';
                                  if (!v.contains('@')) return 'Enter a valid email';
                                  return null;
                                },
                              ),
                              FieldRow(
                                controller: _passwordCtrl,
                                label: 'Password',
                                icon: Icons.lock_outline_rounded,
                                obscure: _obscurePassword,
                                textInputAction: TextInputAction.done,
                                autofillHints: const [AutofillHints.password],
                                onSubmitted: (_) => _login(),
                                suffix: IconButton(
                                  tooltip: _obscurePassword ? 'Show password' : 'Hide password',
                                  icon: Icon(
                                    _obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                                    size: 20,
                                  ),
                                  onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                                ),
                                validator: (v) {
                                  if (v == null || v.isEmpty) return 'Enter your password';
                                  if (v.length < 4) return 'Password is too short';
                                  return null;
                                },
                              ),
                              ListRow(
                                title: 'Keep me signed in',
                                subtitle: 'Untick on shared phones',
                                trailing: Switch(
                                  value: _keepSignedIn,
                                  onChanged: (v) => setState(() => _keepSignedIn = v),
                                ),
                                onTap: () => setState(() => _keepSignedIn = !_keepSignedIn),
                              ),
                            ],
                          ),
                          PrimaryButton(
                            label: 'Sign in',
                            loading: authState.isLoading,
                            onPressed: _login,
                          ),
                          _SocialButtons(busy: _socialBusy, onTap: _social),
                          const SizedBox(height: 8),
                          TextButton(
                            onPressed: _createAccount,
                            child: const Text('New to Eventlaya? Create an account'),
                          ),
                          if (!canPop) ...[
                            const SizedBox(height: 12),
                            TextButton(
                              onPressed: _browseWithoutAccount,
                              child: const Text('Browse events without signing in'),
                            ),
                          ],
                          if (!_socialShown(ref)) ...[
                            const SizedBox(height: 16),
                            const LegalConsentText(lead: 'By signing in you agree to the'),
                          ],
                          if (_serverUrl != AppStorage.defaultServerUrl) ...[
                            const SizedBox(height: 16),
                            Text(
                              'Server: ${_serverUrl.replaceFirst(RegExp(r'^https?://'), '')}',
                              textAlign: TextAlign.center,
                              style: AppType.caption,
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
            if (canPop)
              Positioned(
                top: 4,
                left: 4,
                child: AppIconButton(
                  icon: Icons.close_rounded,
                  tooltip: 'Close',
                  color: AppColors.ink600,
                  onPressed: () => Navigator.of(context).maybePop(),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Whether the Google / Facebook buttons (with their own consent line) show.
bool _socialShown(WidgetRef ref) {
  final cfg = ref.watch(socialConfigProvider).valueOrNull ?? SocialConfig.none;
  return cfg.google || (cfg.facebook && FacebookAuthBridge.available);
}

/// "or continue with" Google / Facebook — only providers the server enabled
/// and this build supports.
class _SocialButtons extends ConsumerWidget {
  final String? busy;
  final ValueChanged<String> onTap;
  const _SocialButtons({required this.busy, required this.onTap});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cfg = ref.watch(socialConfigProvider).valueOrNull ?? SocialConfig.none;
    final google = cfg.google;
    final facebook = cfg.facebook && FacebookAuthBridge.available;
    if (!_socialShown(ref)) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 20),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const Expanded(child: Divider()),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text('or continue with', style: AppType.caption),
          ),
          const Expanded(child: Divider()),
        ]),
        const SizedBox(height: 14),
        if (google)
          PrimaryButton(
            label: 'Continue with Google',
            icon: Icons.g_mobiledata_rounded,
            tone: ButtonTone.neutral,
            tonal: true,
            loading: busy == 'google',
            onPressed: busy == null ? () => onTap('google') : null,
          ),
        if (google && facebook) const SizedBox(height: 8),
        if (facebook)
          PrimaryButton(
            label: 'Continue with Facebook',
            icon: Icons.facebook_rounded,
            tone: ButtonTone.neutral,
            tonal: true,
            loading: busy == 'facebook',
            onPressed: busy == null ? () => onTap('facebook') : null,
          ),
        // The server records this consent on the first Google/Facebook sign-in.
        const Padding(
          padding: EdgeInsets.only(top: 12),
          child: LegalConsentText(),
        ),
      ]),
    );
  }
}
