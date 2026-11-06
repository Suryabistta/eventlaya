import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../attendee/attendee_shell.dart';
import '../../core/storage.dart';
import '../../providers/auth_provider.dart';
import '../../providers/event_provider.dart';
import '../../providers/view_mode_provider.dart';
import '../../ui/ui.dart';
import '../role_router.dart';

/// Asks for confirmation, signs out and returns to the attendee app.
Future<void> confirmSignOut(BuildContext context, WidgetRef ref) async {
  final user = ref.read(authProvider).user;
  final staffish = user != null && (user.isAdmin || user.isStaff);
  final ok = await confirmSheet(
    context,
    title: 'Sign out?',
    message: staffish
        ? "You'll need your email and password to sign back in. Scans saved offline stay on this device."
        : user?.isVendor == true
            ? "You'll need to sign in again to see new booking requests."
            : "Passes saved on this phone stay here, so you can still show them at the gate.",
    confirmLabel: 'Sign out',
  );
  if (!ok || !context.mounted) return;
  await signOut(context, ref);
}

/// Signs out and lands on the attendee app (signed out), which can browse
/// events and sign in again from Profile.
Future<void> signOut(BuildContext context, WidgetRef ref) async {
  final nav = Navigator.of(context, rootNavigator: true);
  final container = ProviderScope.containerOf(context, listen: false);
  final auth = container.read(authProvider.notifier);
  final events = container.read(eventProvider.notifier);
  AppToast.info(context, 'Signed out');
  nav.pushAndRemoveUntil(
    MaterialPageRoute(builder: (_) => const AttendeeShell()),
    (_) => false,
  );
  await auth.logout();
  container.read(preferAttendeeViewProvider.notifier).state = false;
  events.reset();
  container.invalidate(eventsProvider);
}

/// Organizer / staff / vendor: browse the app as an attendee (remembered across launches).
Future<void> switchToAttendeeView(BuildContext context, WidgetRef ref) async {
  final nav = Navigator.of(context, rootNavigator: true);
  ref.read(preferAttendeeViewProvider.notifier).state = true;
  await AppStorage.savePreferAttendeeView(true);
  nav.pushAndRemoveUntil(
    MaterialPageRoute(builder: (_) => const AttendeeShell()),
    (_) => false,
  );
}

/// Back from the attendee view to the signed-in user's organizer / staff / vendor app.
Future<void> switchToRoleView(BuildContext context, WidgetRef ref) async {
  final nav = Navigator.of(context, rootNavigator: true);
  ref.read(preferAttendeeViewProvider.notifier).state = false;
  await AppStorage.savePreferAttendeeView(false);
  nav.pushAndRemoveUntil(
    MaterialPageRoute(builder: (_) => const RoleRouter()),
    (_) => false,
  );
}
