import 'bookings_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../../attendee/screens/account_screens.dart' show deleteAccountFlow;
import '../../attendee/screens/profile_screen.dart' show openChangePassword, openEditProfile;
import '../../core/legal.dart';
import '../../core/storage.dart';
import '../../providers/auth_provider.dart';
import '../../providers/modules_provider.dart';
import '../../reviews/review_lists.dart';
import '../../screens/common/session.dart';
import '../../screens/staff/staff_shell.dart' show AccountCard;
import '../../ui/ui.dart';
import '../providers/vendor_providers.dart';

/// Vendor More: account, reviews of my listings, attendee view, sign out.
/// When [embedded] (an organizer opened Business from their More screen) the
/// account actions are left to the organizer app (the shell's top bar leads back).
class VendorMoreScreen extends ConsumerStatefulWidget {
  final bool embedded;
  const VendorMoreScreen({super.key, this.embedded = false});

  @override
  ConsumerState<VendorMoreScreen> createState() => _VendorMoreScreenState();
}

class _VendorMoreScreenState extends ConsumerState<VendorMoreScreen> {
  String? _server;
  String _version = '';

  @override
  void initState() {
    super.initState();
    AppStorage.getServerUrl().then((v) {
      if (mounted) setState(() => _server = v);
    });
    PackageInfo.fromPlatform().then((i) {
      if (mounted) setState(() => _version = '${i.version} (${i.buildNumber})');
    }).catchError((_) {});
  }

  void _push(Widget page) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authProvider).user;
    final reviews = ref.watch(moduleEnabledProvider(AppModule.reviews));
    final listings = ref.watch(myListingsProvider).valueOrNull;

    return AppScaffold(
      title: 'More',
      automaticBack: false,
      slivers: [
        SliverToBoxAdapter(child: AccountCard(user: user)),
        SliverToBoxAdapter(
          child: GroupedSection(
            header: 'Business',
            separatorInset: 58,
            children: [
              ListRow(
                leading: const RowIcon(Icons.event_available_rounded, background: AppColors.success),
                title: 'Bookings',
                subtitle: 'Confirmed bookings, payments received and receipts',
                chevron: true,
                onTap: () => _push(const BookingsScreen()),
              ),
              if (reviews)
                ListRow(
                  leading: const RowIcon(Icons.star_rounded, background: AppColors.marigold),
                  title: 'Reviews',
                  subtitle: 'Read and reply to reviews of your listings',
                  chevron: true,
                  onTap: () => _push(const ManageReviewsScreen(listingsOnly: true)),
                ),
              const ListRow(
                leading: RowIcon(Icons.language_rounded, background: AppColors.ink600),
                title: 'Business portal on the web',
                subtitle: 'eventlaya.com/app/business — add listings, photos and prices',
              ),
              if (listings != null)
                ListRow(
                  leading: const RowIcon(Icons.storefront_rounded),
                  title: 'Listings',
                  value: '${listings.length}',
                ),
            ],
          ),
        ),
        if (!widget.embedded && user != null) ...[
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
                  leading: const RowIcon(Icons.lock_rounded, background: AppColors.ink500),
                  title: user.hasPassword ? 'Change password' : 'Set a password',
                  chevron: true,
                  onTap: () => openChangePassword(context),
                ),
              ],
            ),
          ),
          SliverToBoxAdapter(
            child: GroupedSection(
              header: 'Attendee app',
              separatorInset: 58,
              children: [
                ListRow(
                  leading: const RowIcon(Icons.explore_rounded, background: AppColors.marigold),
                  title: 'Switch to attendee view',
                  subtitle: 'Browse events and keep your own passes',
                  chevron: true,
                  onTap: () => switchToAttendeeView(context, ref),
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
        // Organizers opening Business already have these on their own More screen.
        if (!widget.embedded) const SliverToBoxAdapter(child: LegalSection()),
        if (!widget.embedded && user != null) ...[
          SliverToBoxAdapter(
            child: GroupedSection(children: [
              ListRow(title: 'Sign out', destructive: true, centered: true, onTap: () => confirmSignOut(context, ref)),
            ]),
          ),
          SliverToBoxAdapter(
            child: GroupedSection(children: [
              ListRow(
                title: 'Delete account',
                destructive: true,
                centered: true,
                onTap: () => deleteAccountFlow(context, ref),
              ),
            ]),
          ),
        ],
      ],
    );
  }
}
