import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'core/offline_queue.dart';
import 'core/notification_service.dart';
import 'core/theme.dart';
import 'screens/splash_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock to portrait orientations
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Set system UI overlay style
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: AppColors.background,
    systemNavigationBarIconBrightness: Brightness.light,
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
      title: 'Eventlaya Scanner',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark,
      home: const SplashScreen(),
    );
  }
}
