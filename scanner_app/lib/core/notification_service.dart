import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'api_client.dart';

class NotificationService {
  static final _localNotifications = FlutterLocalNotificationsPlugin();
  static bool _initialized = false;

  static Future<void> init() async {
    if (_initialized) return;

    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );

    await _localNotifications.initialize(
      const InitializationSettings(android: androidSettings, iOS: iosSettings),
      onDidReceiveNotificationResponse: (details) {
        debugPrint('Notification tapped: ${details.payload}');
      },
    );

    // Create notification channels for Android
    const channel = AndroidNotificationChannel(
      'eventlaya_scanner',
      'Eventlaya Scanner',
      description: 'Gate scan alerts and event notifications',
      importance: Importance.high,
      enableVibration: true,
      playSound: true,
    );

    await _localNotifications
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);

    _initialized = true;
    debugPrint('NotificationService: Local notifications initialized');
  }

  static Future<void> showLocalNotification({
    required String title,
    required String body,
    String? payload,
    int id = 0,
  }) async {
    const androidDetails = AndroidNotificationDetails(
      'eventlaya_scanner',
      'Eventlaya Scanner',
      channelDescription: 'Gate scan alerts',
      importance: Importance.high,
      priority: Priority.high,
      icon: '@mipmap/ic_launcher',
    );
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentSound: true,
      presentBadge: true,
    );
    const details = NotificationDetails(android: androidDetails, iOS: iosDetails);

    await _localNotifications.show(id, title, body, details, payload: payload);
  }

  static Future<void> showScanAlert({
    required String message,
    required bool isSuccess,
  }) async {
    await showLocalNotification(
      title: isSuccess ? '✅ Scan Successful' : '❌ Scan Alert',
      body: message,
      id: DateTime.now().millisecondsSinceEpoch ~/ 1000,
    );
  }

  // Firebase FCM setup (graceful — works even if google-services.json is not configured yet)
  static Future<void> initFirebase() async {
    try {
      await Firebase.initializeApp();
      final messaging = FirebaseMessaging.instance;

      // Request permission for push notifications
      NotificationSettings settings = await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );

      if (settings.authorizationStatus == AuthorizationStatus.authorized) {
        debugPrint('FCM: User granted notification permission');
        final token = await messaging.getToken();
        if (token != null) {
          debugPrint('FCM Token: $token');
          // Register token with backend
          try {
            final api = ApiClient();
            await api.post('/api/auth/fcm-token/', data: {
              'token': token,
              'platform': defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
            });
            debugPrint('FCM: Token registered with backend');
          } catch (e) {
            debugPrint('FCM: Failed to register token with backend: $e');
          }
        }

        // Listen for foreground messages
        FirebaseMessaging.onMessage.listen((RemoteMessage message) {
          debugPrint('FCM Foreground Message: ${message.notification?.title}');
          if (message.notification != null) {
            showLocalNotification(
              title: message.notification!.title ?? 'Eventlaya Alert',
              body: message.notification!.body ?? '',
            );
          }
        });
      }
    } catch (e) {
      debugPrint('NotificationService: Firebase FCM not initialized (expected if credentials missing): $e');
    }
  }
}
