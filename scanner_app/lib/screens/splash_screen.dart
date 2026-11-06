import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../attendee/screens/link_screens.dart';
import '../core/deep_links.dart';
import '../core/storage.dart';
import '../providers/auth_provider.dart';
import '../providers/view_mode_provider.dart';
import '../ui/ui.dart';
import 'common/session_guard.dart' show appNavigatorKey;
import 'role_router.dart';

class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final auth = ref.read(authProvider.notifier);
    await AppStorage.getServerUrl(); // warms the cache used for media URLs
    await auth.loadFromStorage();
    final attendeeView = await AppStorage.getPreferAttendeeView();
    if (!mounted) return;
    ref.read(preferAttendeeViewProvider.notifier).state = attendeeView;
    Navigator.of(context).pushReplacement(
      PageRouteBuilder(
        transitionDuration: const Duration(milliseconds: 250),
        pageBuilder: (_, __, ___) => const RoleRouter(),
        transitionsBuilder: (_, a, __, child) => FadeTransition(opacity: a, child: child),
      ),
    );
    await _startDeepLinks();
  }

  /// App Links (eventlaya.com/e/…, /ticket/…, payment returns): the one the app was opened with,
  /// then any that arrive while it runs, open on top of the user's app.
  static Future<void> _startDeepLinks() async {
    final initial = await DeepLinks.instance.start();
    DeepLinks.instance.links.listen((link) {
      final nav = appNavigatorKey.currentState;
      if (nav != null) openDeepLink(nav, link);
    });
    if (initial != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final nav = appNavigatorKey.currentState;
        if (nav != null) openDeepLink(nav, initial);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Wordmark(size: 96, tagline: true),
            SizedBox(height: 28),
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2.4, color: AppColors.brand),
            ),
          ],
        ),
      ),
    );
  }
}
