import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../../core/legal.dart';
import '../../core/storage.dart';
import '../../payments/my_payments_screen.dart';
import '../../providers/auth_provider.dart';
import '../../screens/common/session.dart';
import '../../screens/login_screen.dart';
import '../../screens/staff/staff_shell.dart' show AccountCard;
import '../../ui/ui.dart';
import '../providers/pass_providers.dart';
import '../../providers/modules_provider.dart';
import '../../reviews/review_lists.dart';
import '../widgets/attendee_widgets.dart';
import '../widgets/verify_banner.dart';
import 'account_screens.dart';
import 'create_account_screen.dart';
import 'verify_email_screen.dart';

/// Opens the sign-in screen on top of the attendee app. Resolves to true
/// when an attendee signed in (organizers / staff continue to their app).
Future<bool> openSignIn(BuildContext context) async {
  final ok = await Navigator.of(context, rootNavigator: true).push<bool>(
    MaterialPageRoute(fullscreenDialog: true, builder: (_) => const LoginScreen()),
  );
  return ok == true;
}

Future<T?> _push<T>(BuildContext context, Widget page) =>
    Navigator.of(context).push<T>(MaterialPageRoute(builder: (_) => page));

/// Attendee sign-up (then sign in + email verification).
Future<void> openCreateAccount(BuildContext context) async {
  final ok = await Navigator.of(context, rootNavigator: true).push<bool>(
    MaterialPageRoute(fullscreenDialog: true, builder: (_) => const CreateAccountScreen()),
  );
  if (ok == true && context.mounted) AppToast.success(context, 'Welcome to Eventlaya');
}

Future<void> openEditProfile(BuildContext context) => _push(context, const EditProfileScreen());
Future<void> openChangePassword(BuildContext context) => _push(context, const ChangePasswordScreen());
Future<void> openMyReviews(BuildContext context) => _push(context, const MyReviewsScreen());
Future<void> openMyInquiries(BuildContext context) => _push(context, const MyInquiriesScreen());
Future<void> openVerifyEmail(BuildContext context) => _push(context, const VerifyEmailScreen());

/// Profile: sign in / account, view switching, app info.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  String _version = '';
  String? _server;

  @override
  void initState() {
    super.initState();
    PackageInfo.fromPlatform().then((i) {
      if (mounted) setState(() => _version = '${i.version} (${i.buildNumber})');
    }).catchError((_) {});
    AppStorage.getServerUrl().then((v) {
      if (mounted) setState(() => _server = v);
    });
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authProvider).user;
    final passes = ref.watch(passesProvider).valueOrNull ?? const [];
    final operator = user != null && (user.isAdmin || user.isStaff || user.isVendor);
    final reviews = ref.watch(moduleEnabledProvider(AppModule.reviews));
    final marketplace = ref.watch(moduleEnabledProvider(AppModule.marketplace));
    final payments = ref.watch(moduleEnabledProvider(AppModule.payments));

    return AppScaffold(
      title: 'Profile',
      slivers: [
        if (user == null)
          const SliverToBoxAdapter(child: _SignInCard())
        else ...[
          SliverToBoxAdapter(child: AccountCard(user: user)),
          const SliverToBoxAdapter(
            child: VerifyEmailBanner(message: 'Verify your email to keep your tickets on every device.'),
          ),
          if (operator)
            SliverToBoxAdapter(
              child: GroupedSection(
                separatorInset: 58,
                children: [
                  ListRow(
                    leading: RowIcon(user.isStaff
                        ? Icons.qr_code_scanner_rounded
                        : user.isVendor
                            ? Icons.storefront_rounded
                            : Icons.dashboard_rounded),
                    title: user.isStaff
                        ? 'Back to gate staff view'
                        : user.isVendor
                            ? 'Back to business view'
                            : 'Back to organizer view',
                    chevron: true,
                    onTap: () => switchToRoleView(context, ref),
                  ),
                ],
              ),
            ),
          SliverToBoxAdapter(
            child: GroupedSection(
              header: 'Account',
              separatorInset: 58,
              children: [
                ListRow(
                  leading: const RowIcon(Icons.edit_rounded, background: AppColors.ink600),
                  title: 'Edit profile',
                  chevron: true,
                  onTap: () => openEditProfile(context),
                ),
                ListRow(
                  leading: RowIcon(user.emailVerified ? Icons.mark_email_read_rounded : Icons.mark_email_unread_rounded,
                      background: user.emailVerified ? AppColors.success : AppColors.marigold),
                  title: 'Email',
                  value: user.emailVerified ? 'Verified' : 'Not verified',
                  chevron: !user.emailVerified,
                  onTap: user.emailVerified ? null : () => openVerifyEmail(context),
                ),
                ListRow(
                  leading: const RowIcon(Icons.lock_rounded, background: AppColors.ink500),
                  title: user.hasPassword ? 'Change password' : 'Set a password',
                  subtitle: user.socialProviders.isEmpty
                      ? null
                      : 'Signed in with ${user.socialProviders.map((p) => p[0].toUpperCase() + p.substring(1)).join(' & ')}',
                  chevron: true,
                  onTap: () => openChangePassword(context),
                ),
                if (reviews)
                  ListRow(
                    leading: const RowIcon(Icons.star_rounded, background: AppColors.marigold),
                    title: 'My reviews',
                    chevron: true,
                    onTap: () => openMyReviews(context),
                  ),
                if (marketplace)
                  ListRow(
                    leading: const RowIcon(Icons.forum_rounded, background: AppColors.success),
                    title: 'My inquiries',
                    chevron: true,
                    onTap: () => openMyInquiries(context),
                  ),
              ],
            ),
          ),
        ],
        SliverToBoxAdapter(
          child: GroupedSection(
            header: 'This phone',
            separatorInset: 58,
            children: [
              ListRow(
                leading: const RowIcon(Icons.confirmation_number_rounded),
                title: 'Saved passes',
                value: '${passes.length}',
              ),
              if (payments)
                ListRow(
                  leading: const RowIcon(Icons.receipt_long_rounded, background: AppColors.success),
                  title: 'My payments',
                  subtitle: 'Tickets and vote packs paid online',
                  chevron: true,
                  onTap: () => _push(context, const MyPaymentsScreen()),
                ),
              if (_server != null && _server != AppStorage.defaultServerUrl)
                ListRow(
                  leading: const RowIcon(Icons.dns_outlined, background: AppColors.ink400),
                  title: 'Server',
                  value: _server!.replaceFirst(RegExp(r'^https?://'), ''),
                ),
              ListRow(
                leading: const RowIcon(Icons.info_outline_rounded, background: AppColors.ink400),
                title: 'App version',
                value: _version,
              ),
            ],
          ),
        ),
        // Always visible, signed in or not (Play Store: privacy policy reachable in the app).
        const SliverToBoxAdapter(child: LegalSection()),
        if (user != null) ...[
          SliverToBoxAdapter(
            child: GroupedSection(
              children: [
                ListRow(
                  title: 'Sign out',
                  destructive: true,
                  centered: true,
                  onTap: () => confirmSignOut(context, ref),
                ),
              ],
            ),
          ),
          if (!user.isSuperAdmin)
            SliverToBoxAdapter(
              child: GroupedSection(
                children: [
                  ListRow(
                    title: 'Delete account',
                    destructive: true,
                    centered: true,
                    onTap: () => deleteAccountFlow(context, ref),
                  ),
                ],
              ),
            ),
        ],
      ],
    );
  }
}

/// Signed-out hero: why sign in, Sign in / Create account.
class _SignInCard extends StatelessWidget {
  const _SignInCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 24),
      decoration: BoxDecoration(gradient: brandGradient, borderRadius: BorderRadius.circular(AppRadius.xl + 4)),
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white.withValues(alpha: 0.35)),
            ),
            child: const Icon(Icons.person_rounded, color: Colors.white, size: 28),
          ),
          const SizedBox(height: 14),
          Text("You're browsing as a guest", style: AppType.heading(22, color: Colors.white)),
          const SizedBox(height: 4),
          Text(
            'Sign in to keep your passes on every device, vote with your ticket and review events. Organizers and gate staff sign in here too.',
            style: AppType.body(14, color: Colors.white.withValues(alpha: 0.82)),
          ),
          const SizedBox(height: 18),
          PrimaryButton(
            label: 'Sign in',
            tone: ButtonTone.onDark,
            icon: Icons.login_rounded,
            onPressed: () => openSignIn(context),
          ),
          const SizedBox(height: 8),
          PrimaryButton(
            label: 'Create account',
            tone: ButtonTone.onDark,
            tonal: true,
            onPressed: () => openCreateAccount(context),
          ),
        ],
      ),
    );
  }
}
