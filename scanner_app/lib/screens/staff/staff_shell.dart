import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../chat/chat_providers.dart';
import '../../chat/chat_push.dart';
import '../../chat/screens/chat_list_screen.dart';
import '../../core/legal.dart';
import '../../core/media_url.dart';
import '../../core/offline_queue.dart';
import '../../core/storage.dart';
import '../../models/app_user.dart';
import '../../models/gate_stats_model.dart';
import '../../models/scan_result_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/event_provider.dart';
import '../../providers/scan_provider.dart';
import '../../ui/ui.dart';
import '../common/format.dart';
import '../common/passes.dart';
import '../common/session.dart';
import 'gate_select_screen.dart';
import 'scanner_screen.dart';

/// Gate staff: Recent scans · [Scan] · Chat · Account (Chat only when the
/// `chat` module is on for the user; otherwise Recent · [Scan] · Account).
class StaffShell extends ConsumerStatefulWidget {
  final int initialIndex;
  const StaffShell({super.key, this.initialIndex = scanTab});

  /// Account is index 2 without chat, 3 with chat.
  static const recentTab = 0, scanTab = 1, chatTab = 2;

  @override
  ConsumerState<StaffShell> createState() => _StaffShellState();
}

class _StaffShellState extends ConsumerState<StaffShell> with ChatPushHandler {
  @override
  void initState() {
    super.initState();
    initChatPush();
  }

  @override
  void dispose() {
    disposeChatPush();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chat = ref.watch(chatEnabledProvider);
    final unread = chat ? ref.watch(chatUnreadProvider) : 0;
    return AdaptiveShell(
      key: ValueKey('staff-shell-$chat'),
      initialIndex: widget.initialIndex,
      tabs: [
        ShellTab(
          item: const TabItem(label: 'Recent scans', icon: Icons.history_rounded, activeIcon: Icons.history_rounded),
          builder: (_, __) => const RecentScansScreen(),
        ),
        ShellTab(
          item: const TabItem(
            label: 'Scan',
            icon: Icons.qr_code_scanner_rounded,
            activeIcon: Icons.qr_code_scanner_rounded,
            prominent: true,
          ),
          builder: (_, active) => ScannerScreen(active: active),
        ),
        if (chat)
          ShellTab(
            item: TabItem(
              label: 'Chat',
              icon: Icons.chat_bubble_outline_rounded,
              activeIcon: Icons.chat_bubble_rounded,
              badge: unread,
            ),
            builder: (_, __) => const ChatListScreen(),
          ),
        ShellTab(
          item: const TabItem(
              label: 'Account', icon: Icons.account_circle_outlined, activeIcon: Icons.account_circle_rounded),
          builder: (_, __) => const StaffAccountScreen(),
        ),
      ],
    );
  }
}

/// Scans made on this phone plus recent activity across all gates.
class RecentScansScreen extends ConsumerWidget {
  const RecentScansScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(scanProvider).history;
    final eventState = ref.watch(eventProvider);
    final allGates = eventState.stats.recentScans;
    final event = eventState.currentEvent;

    Future<void> refresh() async {
      if (event != null) await ref.read(eventProvider.notifier).fetchStats(event.id);
    }

    return AppScaffold(
      title: 'Recent scans',
      onRefresh: refresh,
      slivers: [
        if (history.isEmpty && allGates.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.qr_code_2_rounded,
              title: 'No scans yet',
              message: 'Passes you scan show up here, so you can check who just came through.',
              actionLabel: 'Open scanner',
              actionIcon: Icons.qr_code_scanner_rounded,
              onAction: () => ShellScope.maybeOf(context)?.goTo(StaffShell.scanTab),
            ),
          )
        else ...[
          if (history.isNotEmpty)
            SliverToBoxAdapter(
              child: GroupedSection(
                header: 'This phone',
                separatorInset: 68,
                children: [for (final r in history.take(30)) ScanResultRow(result: r)],
              ),
            ),
          if (allGates.isNotEmpty)
            SliverToBoxAdapter(
              child: GroupedSection(
                header: 'All gates',
                separatorInset: 68,
                children: [for (final s in allGates) RecentScanRow(scan: s)],
              ),
            ),
        ],
      ],
    );
  }
}

/// Row for a scan made on this device. Tap to open the pass.
class ScanResultRow extends ConsumerWidget {
  final ScanResultModel result;
  const ScanResultRow({super.key, required this.result});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final copy = ScanCopy.of(result);
    final name = (result.attendeeName?.isNotEmpty ?? false) ? result.attendeeName! : 'Unknown attendee';
    return ListRow(
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(color: copy.tone.tint, shape: BoxShape.circle),
        child: Icon(copy.icon, color: copy.tone.strong, size: 22),
      ),
      title: name,
      subtitleWidget: Text(
        [
          if (result.ticketType.hasName) result.ticketType.name,
          if (result.ticketCode != null) result.ticketCode!,
          scanTypeLabel(result.scanType),
          Fmt.time(result.scannedAt),
        ].join(' · '),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppType.rowSubtitle,
      ),
      trailing: StatusBadge(copy.title, tone: copy.tone),
      onTap: () {
        final ev = ref.read(eventProvider);
        showTicketPassSheet(context, pass: passFromScan(result, event: ev.currentEvent, gate: ev.selectedGate));
      },
    );
  }
}

/// Row for a scan from the gate-stats feed.
class RecentScanRow extends StatelessWidget {
  final RecentScan scan;
  const RecentScanRow({super.key, required this.scan});

  @override
  Widget build(BuildContext context) {
    final isIn = scan.scanType == 'gate_in';
    final tone = isIn ? Tone.success : Tone.warning;
    return ListRow(
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(color: tone.tint, shape: BoxShape.circle),
        child: Icon(isIn ? Icons.login_rounded : Icons.logout_rounded, color: tone.strong, size: 20),
      ),
      title: scan.attendeeName,
      subtitle: [if (scan.gateName.isNotEmpty) scan.gateName, Fmt.timeIso(scan.scannedAt)].join(' · '),
      trailing: StatusBadge(isIn ? 'In' : 'Out', tone: tone),
    );
  }
}

/// Staff account: who you are, where you're scanning, offline queue, sign out.
class StaffAccountScreen extends ConsumerStatefulWidget {
  const StaffAccountScreen({super.key});

  @override
  ConsumerState<StaffAccountScreen> createState() => _StaffAccountScreenState();
}

class _StaffAccountScreenState extends ConsumerState<StaffAccountScreen> {
  String? _server;

  @override
  void initState() {
    super.initState();
    AppStorage.getServerUrl().then((v) {
      if (mounted) setState(() => _server = v);
    });
  }

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

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authProvider).user;
    final ev = ref.watch(eventProvider);
    final scan = ref.watch(scanProvider);
    final queued = scan.offlineQueueCount > 0 ? scan.offlineQueueCount : OfflineQueue.count;

    return AppScaffold(
      title: 'Account',
      slivers: [
        SliverToBoxAdapter(child: AccountCard(user: user)),
        SliverToBoxAdapter(
          child: GroupedSection(
            header: 'Scanning',
            separatorInset: 58,
            children: [
              ListRow(
                leading: const RowIcon(Icons.event_rounded),
                title: 'Event',
                value: ev.currentEvent?.title ?? 'None',
              ),
              ListRow(
                leading: const RowIcon(Icons.door_front_door_outlined, background: AppColors.success),
                title: 'Gate',
                subtitle: ev.gateLocked ? 'Assigned by your organizer' : null,
                value: ev.selectedGate ?? 'No gate',
                trailing:
                    ev.gateLocked ? const Icon(Icons.lock_outline_rounded, size: 18, color: AppColors.ink400) : null,
                chevron: !ev.gateLocked,
                onTap: ev.gateLocked
                    ? null
                    : () => Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => const GateSelectScreen(returnOnDone: true)),
                        ),
              ),
            ],
          ),
        ),
        SliverToBoxAdapter(
          child: GroupedSection(
            header: 'Offline scans',
            footer:
                'Scans made without a connection are kept on this phone and sent automatically when you are back online.',
            separatorInset: 58,
            children: [
              ListRow(
                leading: RowIcon(scan.isOnline ? Icons.wifi_rounded : Icons.wifi_off_rounded,
                    background: scan.isOnline ? AppColors.success : AppColors.marigold),
                title: scan.isOnline ? 'Online' : 'Offline',
                value: queued == 0 ? 'All synced' : '${Fmt.number(queued)} waiting',
              ),
              if (queued > 0)
                ListRow(
                  leading: const RowIcon(Icons.cloud_upload_outlined, background: AppColors.ink600),
                  title: 'Sync now',
                  onTap: _sync,
                ),
            ],
          ),
        ),
        // Only shown when a developer pointed the app at another server.
        if (_server != null && _server != AppStorage.defaultServerUrl)
          SliverToBoxAdapter(
            child: GroupedSection(
              separatorInset: 58,
              children: [
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

/// Avatar, name, email and role.
class AccountCard extends StatelessWidget {
  final AppUser? user;
  const AccountCard({super.key, required this.user});

  @override
  Widget build(BuildContext context) {
    final roleLabel = switch (user?.role) {
      UserRole.superadmin => 'Superadmin',
      UserRole.organizer => 'Organizer',
      UserRole.staff => 'Gate staff',
      UserRole.vendor => 'Business',
      _ => 'Member',
    };
    return GroupedSection(
      children: [
        ListRow(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          leading: UserAvatar(user: user, size: 52),
          titleWidget: Text(user?.fullName ?? 'Signed out', style: AppType.heading(19)),
          title: user?.fullName ?? '',
          subtitleWidget: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(user?.email ?? '', style: AppType.rowSubtitle, maxLines: 1, overflow: TextOverflow.ellipsis),
              if (user?.organizationName != null && user!.organizationName!.isNotEmpty)
                Text(user!.organizationName!, style: AppType.rowSubtitle, maxLines: 1, overflow: TextOverflow.ellipsis),
            ],
          ),
          trailing: StatusBadge(roleLabel, tone: Tone.brand, dot: false),
        ),
      ],
    );
  }
}

/// Profile photo, or initials when there is none.
class UserAvatar extends StatelessWidget {
  final AppUser? user;
  final double size;
  const UserAvatar({super.key, required this.user, this.size = 40});

  @override
  Widget build(BuildContext context) {
    final fallback = InitialsAvatar(name: user?.fullName ?? '?', size: size);
    final url = mediaUrl(user?.avatar);
    if (url == null) return fallback;
    return ClipOval(
      child: CachedNetworkImage(
        imageUrl: url,
        width: size,
        height: size,
        fit: BoxFit.cover,
        placeholder: (_, __) => fallback,
        errorWidget: (_, __, ___) => fallback,
      ),
    );
  }
}
