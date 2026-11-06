import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/event_model.dart';
import '../../providers/event_provider.dart';
import '../../chat/chat_providers.dart';
import '../../chat/chat_push.dart';
import '../../chat/screens/chat_list_screen.dart';
import '../../ui/ui.dart';
import '../../vendor/vendor_push.dart';
import '../staff/scanner_screen.dart';
import 'admin_home_screen.dart';
import 'attendees_screen.dart';
import 'event_tasks_screen.dart';
import 'more_screen.dart';

/// Organizer / admin: Home · Attendees · [Scan] · Chat · More.
/// When chat is off for the user (module), the 4th tab is Tasks instead
/// (Tasks otherwise lives in More).
class AdminShell extends ConsumerStatefulWidget {
  final int initialIndex;
  const AdminShell({super.key, this.initialIndex = 0});

  /// Index 3 is Chat when chat is enabled, otherwise Tasks.
  static const homeTab = 0, attendeesTab = 1, scanTab = 2, tasksTab = 3, chatTab = 3, moreTab = 4;

  @override
  ConsumerState<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends ConsumerState<AdminShell> with ChatPushHandler, BookingPushHandler {
  @override
  void initState() {
    super.initState();
    // Once events load: pick a default (live, next upcoming, most recent) if
    // none is selected yet, otherwise keep the selected event's details fresh.
    ref.listenManual(eventsProvider, (_, next) {
      final list = next.valueOrNull;
      if (list == null || list.isEmpty) return;
      final notifier = ref.read(eventProvider.notifier);
      final current = ref.read(eventProvider).currentEvent;
      if (current == null) {
        notifier.setCurrentEvent(defaultEvent(list)!);
      } else {
        final fresh = list.where((e) => e.id == current.id).firstOrNull;
        if (fresh != null) notifier.refreshEvent(fresh);
      }
    }, fireImmediately: true);
    initChatPush();
    initBookingPush(); // organizers with marketplace access own listings too
  }

  @override
  void dispose() {
    disposeChatPush();
    disposeBookingPush();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chat = ref.watch(chatEnabledProvider);
    final unread = chat ? ref.watch(chatUnreadProvider) : 0;
    return AdaptiveShell(
      key: ValueKey('admin-shell-$chat'),
      initialIndex: widget.initialIndex,
      tabs: [
        ShellTab(
          item: const TabItem(label: 'Home', icon: Icons.home_outlined, activeIcon: Icons.home_rounded),
          builder: (_, __) => const AdminHomeScreen(),
        ),
        ShellTab(
          item: const TabItem(label: 'Attendees', icon: Icons.people_outline_rounded, activeIcon: Icons.people_rounded),
          builder: (_, __) => const AttendeesScreen(),
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
          )
        else
          ShellTab(
            item: const TabItem(label: 'Tasks', icon: Icons.task_alt_rounded, activeIcon: Icons.task_alt_rounded),
            builder: (_, __) => const EventTasksScreen(),
          ),
        ShellTab(
          item: const TabItem(label: 'More', icon: Icons.more_horiz_rounded, activeIcon: Icons.more_horiz_rounded),
          builder: (_, __) => const MoreScreen(),
        ),
      ],
    );
  }
}
