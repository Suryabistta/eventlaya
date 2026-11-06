import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/modules_provider.dart';
import '../screens/common/session.dart';
import '../ui/ui.dart';
import 'providers/vendor_providers.dart';
import 'screens/calendar_screen.dart';
import 'screens/listings_screen.dart';
import 'screens/requests_screen.dart';
import 'screens/vendor_home_screen.dart';
import 'screens/vendor_more_screen.dart';
import 'vendor_push.dart';

/// Vendor / venue owner app: Home · Requests · [Calendar] · Listings · More.
///
/// Opens for `vendor` accounts (RoleRouter). Organizers with marketplace
/// access open it from More → Business as an [embedded] page (a top bar leads
/// back to the organizer app; push taps are handled by the organizer shell then).
/// Everything here belongs to the `marketplace` module: when it's off the
/// shell shows a "turned off" state instead of tabs.
class VendorShell extends ConsumerStatefulWidget {
  final bool embedded;
  final int initialIndex;
  const VendorShell({super.key, this.embedded = false, this.initialIndex = homeTab});

  static const homeTab = 0, requestsTab = 1, calendarTab = 2, listingsTab = 3, moreTab = 4;

  @override
  ConsumerState<VendorShell> createState() => _VendorShellState();
}

class _VendorShellState extends ConsumerState<VendorShell> with BookingPushHandler, WidgetsBindingObserver {
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    if (!widget.embedded) initBookingPush();
    WidgetsBinding.instance.addObserver(this);
    // New requests also arrive by push; this keeps the badge right without one.
    _poll = Timer.periodic(const Duration(minutes: 2), (_) => ref.invalidate(vendorRequestsProvider));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) ref.refreshVendorData();
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    if (!widget.embedded) disposeBookingPush();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final enabled = ref.watch(vendorMarketplaceEnabledProvider);
    if (!enabled) return _MarketplaceOff(embedded: widget.embedded);
    final pending = ref.watch(pendingRequestCountProvider);
    final shell = AdaptiveShell(
      initialIndex: widget.initialIndex,
      tabs: [
        ShellTab(
          item: const TabItem(label: 'Home', icon: Icons.home_outlined, activeIcon: Icons.home_rounded),
          builder: (_, __) => const VendorHomeScreen(),
        ),
        ShellTab(
          item: TabItem(
            label: 'Requests',
            icon: Icons.inbox_outlined,
            activeIcon: Icons.inbox_rounded,
            badge: pending,
          ),
          builder: (_, __) => const RequestsScreen(),
        ),
        ShellTab(
          item: const TabItem(
            label: 'Calendar',
            icon: Icons.calendar_month_rounded,
            activeIcon: Icons.calendar_month_rounded,
            prominent: true,
          ),
          builder: (_, __) => const CalendarScreen(),
        ),
        ShellTab(
          item: const TabItem(label: 'Listings', icon: Icons.storefront_outlined, activeIcon: Icons.storefront_rounded),
          builder: (_, __) => const ListingsScreen(),
        ),
        ShellTab(
          item: const TabItem(label: 'More', icon: Icons.more_horiz_rounded, activeIcon: Icons.more_horiz_rounded),
          builder: (_, __) => VendorMoreScreen(embedded: widget.embedded),
        ),
      ],
    );
    return widget.embedded ? _EmbeddedFrame(child: shell) : shell;
  }
}

/// Organizer's embedded Business view: one "Back to organizer app" bar above
/// all tabs (the tab pages themselves show no back arrows).
class _EmbeddedFrame extends StatelessWidget {
  final Widget child;
  const _EmbeddedFrame({required this.child});

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent),
      child: Material(
        color: AppColors.background,
        child: Column(children: [
          DecoratedBox(
            decoration: const BoxDecoration(
              color: AppColors.surface,
              border: Border(bottom: BorderSide(color: AppColors.separator, width: 0.5)),
            ),
            child: Padding(
              padding: EdgeInsets.fromLTRB(4, top, 16, 0),
              child: SizedBox(
                height: 48,
                child: Row(children: [
                  TextButton.icon(
                    onPressed: () => Navigator.of(context).maybePop(),
                    icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
                    label: const Text('Back to organizer app'),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.brand,
                      textStyle: AppType.body(15, weight: FontWeight.w600),
                    ),
                  ),
                  const Spacer(),
                  Text('Business', style: AppType.body(13, weight: FontWeight.w600, color: AppColors.ink400)),
                ]),
              ),
            ),
          ),
          Expanded(child: MediaQuery.removePadding(context: context, removeTop: true, child: child)),
        ]),
      ),
    );
  }
}

/// Shown instead of the tabs when the marketplace module is off.
class _MarketplaceOff extends ConsumerWidget {
  final bool embedded;
  const _MarketplaceOff({required this.embedded});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(children: [
              if (embedded)
                Align(
                  alignment: Alignment.centerLeft,
                  child: AppIconButton(
                    icon: Icons.arrow_back_ios_new_rounded,
                    tooltip: 'Back',
                    onPressed: () => Navigator.of(context).maybePop(),
                  ),
                ),
              const Spacer(),
              const EmptyState(
                icon: Icons.storefront_outlined,
                title: 'Marketplace is turned off for your account',
                message: 'Booking requests, availability and listings are unavailable right now. '
                    'Your data is safe — it comes back when the Eventlaya team turns the marketplace on again.',
              ),
              PrimaryButton(
                label: 'Check again',
                icon: Icons.refresh_rounded,
                tonal: true,
                onPressed: () {
                  ref.read(disabledModulesProvider.notifier).state = const {};
                  ref.invalidate(modulesProvider);
                  ref.invalidate(myListingsProvider);
                  ref.refreshVendorData();
                },
              ),
              const Spacer(),
              if (!embedded) ...[
                PrimaryButton(
                  label: 'Switch to attendee view',
                  icon: Icons.explore_rounded,
                  tone: ButtonTone.neutral,
                  tonal: true,
                  onPressed: () => switchToAttendeeView(context, ref),
                ),
                const SizedBox(height: 8),
                PrimaryButton(
                  label: 'Sign out',
                  tone: ButtonTone.danger,
                  tonal: true,
                  onPressed: () => confirmSignOut(context, ref),
                ),
                const SizedBox(height: 16),
              ],
            ]),
          ),
        ),
      ),
    );
  }
}
