import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/modules_provider.dart';
import '../ui/ui.dart';
import 'screens/explore_screen.dart';
import 'screens/my_pass_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/tickets_screen.dart';
import 'screens/vendors_screen.dart';

/// Attendee app: Explore · Tickets · [My Pass] · Vendors · Profile.
///
/// Opens for signed-out users (browsing needs no account), attendees, and
/// organizers / staff who chose "Switch to attendee view". Vendors hides
/// itself when the `marketplace` module is off.
class AttendeeShell extends ConsumerWidget {
  final int initialIndex;
  const AttendeeShell({super.key, this.initialIndex = exploreTab});

  static const exploreTab = 0, ticketsTab = 1, passTab = 2;

  /// Switches to [tab] from inside a page (no-op outside the shell).
  static void goTo(BuildContext context, int tab) => ShellScope.maybeOf(context)?.goTo(tab);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final marketplace = ref.watch(moduleEnabledProvider(AppModule.marketplace));
    return AdaptiveShell(
      // Rebuild the shell when the tab set changes so indexes stay right.
      key: ValueKey('attendee-shell-$marketplace'),
      initialIndex: initialIndex,
      tabs: [
        ShellTab(
          item: const TabItem(label: 'Explore', icon: Icons.explore_outlined, activeIcon: Icons.explore_rounded),
          builder: (_, __) => const ExploreScreen(),
        ),
        ShellTab(
          item: const TabItem(
            label: 'Tickets',
            icon: Icons.confirmation_number_outlined,
            activeIcon: Icons.confirmation_number_rounded,
          ),
          builder: (_, __) => const TicketsScreen(),
        ),
        ShellTab(
          item: const TabItem(
            label: 'My Pass',
            icon: Icons.qr_code_2_rounded,
            activeIcon: Icons.qr_code_2_rounded,
            prominent: true,
          ),
          builder: (_, active) => MyPassScreen(active: active),
        ),
        if (marketplace)
          ShellTab(
            item: const TabItem(label: 'Vendors', icon: Icons.storefront_outlined, activeIcon: Icons.storefront_rounded),
            builder: (_, __) => const VendorsScreen(),
          ),
        ShellTab(
          item: const TabItem(
            label: 'Profile',
            icon: Icons.account_circle_outlined,
            activeIcon: Icons.account_circle_rounded,
          ),
          builder: (_, __) => const ProfileScreen(),
        ),
      ],
    );
  }
}
