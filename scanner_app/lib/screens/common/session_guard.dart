import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';
import '../../providers/auth_provider.dart';
import '../../providers/event_provider.dart';
import '../../ui/ui.dart';
import '../login_screen.dart';

/// Root navigator, used to leave the app when the session ends.
final appNavigatorKey = GlobalKey<NavigatorState>();

/// Listens for expired sessions (401 after a failed token refresh) and sends
/// the user back to the login screen.
class SessionGuard extends ConsumerStatefulWidget {
  final Widget child;
  const SessionGuard({super.key, required this.child});

  @override
  ConsumerState<SessionGuard> createState() => _SessionGuardState();
}

class _SessionGuardState extends ConsumerState<SessionGuard> {
  StreamSubscription<void>? _sub;

  @override
  void initState() {
    super.initState();
    _sub = ApiClient.onSessionExpired.listen((_) => _expire());
  }

  Future<void> _expire() async {
    if (ref.read(authProvider).user == null) return;
    final nav = appNavigatorKey.currentState;
    if (nav == null) return;
    final overlay = nav.overlay;
    if (overlay != null) AppToast.showIn(overlay, 'Your session ended. Sign in again.', type: ToastType.error);
    nav.pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
    await ref.read(authProvider.notifier).logout();
    ref.read(eventProvider.notifier).reset();
    ref.invalidate(eventsProvider);
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
