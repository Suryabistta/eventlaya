import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/legal.dart';
import '../../core/storage.dart';
import '../../models/event_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/event_provider.dart';
import '../../providers/scan_provider.dart';
import '../../chat/chat_providers.dart';
import '../../providers/modules_provider.dart';
import '../../reviews/review_lists.dart';
import '../../ui/ui.dart';
import '../../vendor/vendor_shell.dart';
import 'event_tasks_screen.dart';
import '../common/format.dart';
import '../common/pickers.dart';
import '../common/session.dart';
import '../staff/staff_shell.dart' show AccountCard;
import 'broadcast_sheet.dart';
import 'rbac_module_screen.dart';
import 'scan_logs_screen.dart';
import 'staff_screen.dart';
import 'team_screen.dart';

class MoreScreen extends ConsumerStatefulWidget {
  const MoreScreen({super.key});

  @override
  ConsumerState<MoreScreen> createState() => _MoreScreenState();
}

class _MoreScreenState extends ConsumerState<MoreScreen> {
  String? _server;

  @override
  void initState() {
    super.initState();
    AppStorage.getServerUrl().then((v) {
      if (mounted) setState(() => _server = v);
    });
    // Picks up marketplace access granted since sign-in (shows Business).
    ref.read(authProvider.notifier).refreshMe();
  }

  void _push(Widget page) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));

  Future<void> _sync() async {
    final r = await ref.read(scanProvider.notifier).flushOfflineQueue();
    if (!mounted) return;
    if (r.synced == 0 && r.remaining == 0) {
      AppToast.info(context, 'Nothing to sync');
    } else if (r.remaining == 0) {
      AppToast.success(context, 'Synced ${Fmt.plural(r.synced, 'scan')}');
    } else {
      AppToast.error(context, "Couldn't sync ${Fmt.plural(r.remaining, 'scan')}. Check your connection.");
    }
  }

  Future<void> _switchEvent(List<EventModel> list, EventModel? current) async {
    final picked = await showEventPicker(context, events: list, current: current);
    if (picked == null || picked == current || !mounted) return;
    ref.read(eventProvider.notifier).setCurrentEvent(picked);
    AppToast.success(context, 'Switched to ${picked.title}');
  }

  @override
  Widget build(BuildContext context) {
    final events = ref.watch(eventsProvider).valueOrNull ?? const <EventModel>[];
    final user = ref.watch(authProvider).user;
    final event = ref.watch(eventProvider).currentEvent;
    final scan = ref.watch(scanProvider);
    final chat = ref.watch(chatEnabledProvider);
    final reviews = ref.watch(moduleEnabledProvider(AppModule.reviews));
    final business =
        user?.hasBusinessPortal == true && ref.watch(moduleEnabledProvider(AppModule.marketplace));

    return AppScaffold(
      title: 'More',
      slivers: [
        SliverToBoxAdapter(child: AccountCard(user: user)),
        if (user?.isAdmin == true)
          SliverToBoxAdapter(
            child: GroupedSection(
              header: 'Team',
              separatorInset: 58,
              children: [
                ListRow(
                  leading: const RowIcon(Icons.groups_rounded),
                  title: 'Team members',
                  subtitle: 'Onboard and manage gate staff',
                  chevron: true,
                  onTap: () => _push(const TeamScreen()),
                ),
              ],
            ),
          ),
        if (business)
          SliverToBoxAdapter(
            child: GroupedSection(
              header: 'Marketplace',
              separatorInset: 58,
              children: [
                ListRow(
                  leading: const RowIcon(Icons.storefront_rounded, background: AppColors.success),
                  title: 'Business',
                  subtitle: 'Booking requests, availability and your listings',
                  chevron: true,
                  onTap: () => Navigator.of(context, rootNavigator: true).push(
                    MaterialPageRoute(builder: (_) => const VendorShell(embedded: true)),
                  ),
                ),
              ],
            ),
          ),
        SliverToBoxAdapter(
          child: GroupedSection(
            header: 'Event',
            separatorInset: 58,
            children: [
              ListRow(
                leading: const RowIcon(Icons.event_rounded),
                title: event?.title ?? 'No event selected',
                subtitle: events.length > 1 ? 'Tap to switch event' : null,
                chevron: events.length > 1,
                onTap: events.length > 1 ? () => _switchEvent(events, event) : null,
              ),
              if (chat)
                ListRow(
                  leading: const RowIcon(Icons.task_alt_rounded, background: AppColors.success),
                  title: 'Tasks',
                  chevron: true,
                  onTap: () => _push(const EventTasksScreen()),
                ),
              if (reviews)
                ListRow(
                  leading: const RowIcon(Icons.star_rounded, background: AppColors.marigold),
                  title: 'Reviews',
                  subtitle: 'Reply to or hide reviews of your events',
                  chevron: true,
                  onTap: () => _push(const ManageReviewsScreen()),
                ),
              ListRow(
                leading: const RowIcon(Icons.history_rounded),
                title: 'Scan logs',
                chevron: true,
                onTap: () => _push(const ScanLogsScreen()),
              ),
              ListRow(
                leading: const RowIcon(Icons.badge_outlined, background: AppColors.ink600),
                title: 'Gate staff',
                chevron: true,
                onTap: () => _push(const StaffScreen()),
              ),
              ListRow(
                leading: const RowIcon(Icons.campaign_outlined, background: AppColors.marigold),
                title: 'Message gate staff',
                chevron: true,
                onTap: () => showBroadcastSheet(context),
              ),
            ],
          ),
        ),
        if (user?.isSuperAdmin == true)
          SliverToBoxAdapter(
            child: GroupedSection(
              header: 'Platform',
              separatorInset: 58,
              children: [
                ListRow(
                  leading: const RowIcon(Icons.tune_rounded, background: AppColors.ink500),
                  title: 'Modules',
                  subtitle: 'Turn features on or off for everyone',
                  chevron: true,
                  onTap: () => _push(const RbacModuleScreen()),
                ),
              ],
            ),
          ),
        SliverToBoxAdapter(
          child: GroupedSection(
            header: 'This phone',
            separatorInset: 58,
            children: [
              ListRow(
                leading: RowIcon(scan.isOnline ? Icons.wifi_rounded : Icons.wifi_off_rounded,
                    background: scan.isOnline ? AppColors.success : AppColors.marigold),
                title: 'Offline scans',
                value: scan.offlineQueueCount == 0 ? 'All synced' : '${Fmt.number(scan.offlineQueueCount)} waiting',
                chevron: scan.offlineQueueCount > 0,
                onTap: scan.offlineQueueCount > 0 ? _sync : null,
              ),
              // Only shown when a developer pointed the app at another server.
              if (_server != null && _server != AppStorage.defaultServerUrl)
                ListRow(
                  leading: const RowIcon(Icons.dns_outlined, background: AppColors.ink400),
                  title: 'Server',
                  value: _server!.replaceFirst(RegExp(r'^https?://'), ''),
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
        const SliverToBoxAdapter(child: LegalSection()),
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
      ],
    );
  }
}
