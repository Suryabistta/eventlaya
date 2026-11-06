import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'core/offline_queue.dart';
import 'core/notification_service.dart';
import 'screens/common/session_guard.dart';
import 'screens/splash_screen.dart';
import 'ui/ui.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Phones stay in portrait; tablets may rotate (the layout adapts).
  final view = WidgetsBinding.instance.platformDispatcher.views.first;
  final shortestSide = view.physicalSize.shortestSide / view.devicePixelRatio;
  if (shortestSide < 600) {
    await SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
      DeviceOrientation.portraitDown,
    ]);
  }

  // Set system UI overlay style (light app chrome; the scanner switches to light icons itself)
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.dark,
    systemNavigationBarColor: AppColors.surface,
    systemNavigationBarIconBrightness: Brightness.dark,
  ));

  // Initialize Hive for offline scan queue
  try {
    await Hive.initFlutter();
    await OfflineQueue.init();
  } catch (e) {
    debugPrint('Hive init error: $e');
  }

  // Initialize local notifications
  try {
    await NotificationService.init();
  } catch (e) {
    debugPrint('Local notifications init error: $e');
  }

  // Initialize Firebase (graceful — fails safely if google-services.json is not configured)
  try {
    await NotificationService.initFirebase();
  } catch (e) {
    debugPrint('Firebase init skipped (not yet configured): $e');
  }

  runApp(const ProviderScope(child: EventlayaApp()));
}

class EventlayaApp extends StatelessWidget {
  const EventlayaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Eventlaya',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      navigatorKey: appNavigatorKey,
      builder: (context, child) => SessionGuard(child: child ?? const SizedBox()),
      home: const SplashScreen(),
    );
  }
}
