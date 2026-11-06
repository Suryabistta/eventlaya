import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../attendee/attendee_shell.dart';
import '../models/app_user.dart';
import '../providers/auth_provider.dart';
import '../providers/event_provider.dart';
import '../providers/view_mode_provider.dart';
import '../vendor/vendor_shell.dart';
import 'admin/admin_shell.dart';
import 'staff/gate_select_screen.dart';

/// Picks the app for the current user:
/// - signed out, attendees (and unknown roles) → attendee app (browsing needs no login)
/// - organizers / superadmins → organizer app
/// - gate staff → gate selection, then the staff app
/// - vendors (marketplace businesses) → vendor app
/// Organizers, staff and vendors who chose "Switch to attendee view" get the attendee app.
class RoleRouter extends ConsumerWidget {
  const RoleRouter({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authProvider).user;
    final attendeeView = ref.watch(preferAttendeeViewProvider);

    if (user == null || attendeeView) return const AttendeeShell();

    switch (user.role) {
      case UserRole.superadmin:
      case UserRole.organizer:
        return const _OperatorBootstrap(child: AdminShell());
      case UserRole.staff:
        return const _OperatorBootstrap(child: GateSelectScreen());
      case UserRole.vendor:
        return const VendorShell();
      case UserRole.attendee:
      case UserRole.unknown:
        return const AttendeeShell();
    }
  }
}

/// Loads the saved event / gate assignment for organizer and staff apps.
class _OperatorBootstrap extends ConsumerStatefulWidget {
  final Widget child;
  const _OperatorBootstrap({required this.child});

  @override
  ConsumerState<_OperatorBootstrap> createState() => _OperatorBootstrapState();
}

class _OperatorBootstrapState extends ConsumerState<_OperatorBootstrap> {
  @override
  void initState() {
    super.initState();
    _initRoleData();
  }

  Future<void> _initRoleData() async {
    final eventNotifier = ref.read(eventProvider.notifier);
    await eventNotifier.loadFromStorage();
    await eventNotifier.loadAssignment();

    final user = ref.read(authProvider).user;
    if (user?.isStaff == true) {
      final eventState = ref.read(eventProvider);
      if (eventState.currentEvent != null) {
        ref.read(eventProvider.notifier).startPolling();
      }
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
