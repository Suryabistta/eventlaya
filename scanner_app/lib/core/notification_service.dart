import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart' show Color;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'api_client.dart';

class NotificationService {
  static final _localNotifications = FlutterLocalNotificationsPlugin();
  static bool _initialized = false;

  /// The high-importance push channel. Same id as the backend payload
  /// (`apps/core/fcm.py`), the manifest's FCM default channel and
  /// `EventlayaApplication.kt` (which creates it before any push can arrive).
  /// Channel settings can't change after creation, so new settings mean a new
  /// id; [_legacyChannelId] is the pre-2026-10 "Eventlaya Scanner" channel.
  static const channelId = 'eventlaya_alerts';
  static const _legacyChannelId = 'eventlaya_scanner';
  static const _channelName = 'Eventlaya alerts';
  static const _channelDescription = 'Booking requests, team chat messages and gate alerts';

  /// White "इ" status-bar icon (res/drawable-*/ic_stat_eventlaya.png) and the
  /// brand crimson it is tinted with in the shade.
  static const _smallIcon = 'ic_stat_eventlaya';
  static const _brandColor = Color(0xFFC2215A);

  /// Notifications for one conversation / booking request share a tag (the
  /// backend sets the same one), so a newer push replaces the older one and
  /// opening the chat / request clears it. Must match `fcm.notification_tag`.
  static String? tagFor(Map<String, dynamic> data) {
    final type = data['type']?.toString() ?? '';
    final conv = data['conversation_id']?.toString() ?? '';
    final inquiry = data['inquiry_id']?.toString() ?? '';
    if (type == 'chat_message' && conv.isNotEmpty) return 'chat:$conv';
    if (type.startsWith('booking_') && inquiry.isNotEmpty) return 'booking:$inquiry';
    return null;
  }

  /// FCM shows tagged notifications with id 0; local ones use the same id.
  static const _taggedId = 0;

  static final _taps = StreamController<Map<String, dynamic>>.broadcast();
  static Map<String, dynamic>? _pendingTap;

  /// Data of tapped notifications (FCM or local), e.g.
  /// `{type: "chat_message", conversation_id, message_id}`.
  static Stream<Map<String, dynamic>> get taps => _taps.stream;

  /// The tap that opened the app from a terminated state; read once by the
  /// shell that can handle it. With [where], only a matching tap is taken (so
  /// chat and booking handlers on the same shell don't steal each other's).
  static Map<String, dynamic>? takePendingTap({bool Function(Map<String, dynamic> data)? where}) {
    final t = _pendingTap;
    if (t == null || (where != null && !where(t))) return null;
    _pendingTap = null;
    return t;
  }

  static final _messages = StreamController<Map<String, dynamic>>.broadcast();

  /// Data of pushes received while the app is in the foreground (e.g. to
  /// refresh a list when a booking request arrives).
  static Stream<Map<String, dynamic>> get messages => _messages.stream;

  /// Conversation open on screen: its foreground pushes aren't shown.
  static String? activeChatConversationId;

  static void _emitTap(Map<String, dynamic> data) {
    if (data.isEmpty) return;
    if (_taps.hasListener) {
      _taps.add(data);
    } else {
      _pendingTap = data;
    }
  }

  static Map<String, dynamic>? _payloadData(String? payload) {
    if (payload == null || payload.isEmpty) return null;
    try {
      final data = jsonDecode(payload);
      if (data is Map && data.isNotEmpty) return Map<String, dynamic>.from(data);
    } catch (_) {}
    return null;
  }

  static Future<void> init() async {
    if (_initialized) return;

    const androidSettings = AndroidInitializationSettings(_smallIcon);
    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );

    await _localNotifications.initialize(
      const InitializationSettings(android: androidSettings, iOS: iosSettings),
      onDidReceiveNotificationResponse: (details) {
        debugPrint('Notification tapped: ${details.payload}');
        final data = _payloadData(details.payload);
        if (data != null) _emitTap(data);
      },
    );

    // A local notification (a push shown while the app was open) tapped after
    // the app was closed: the tap launched the app, so no callback fires.
    try {
      final launch = await _localNotifications.getNotificationAppLaunchDetails();
      if (launch?.didNotificationLaunchApp ?? false) {
        final data = _payloadData(launch!.notificationResponse?.payload);
        if (data != null) _pendingTap = data;
      }
    } catch (e) {
      debugPrint('NotificationService: launch details unavailable: $e');
    }

    // The channel normally exists already (EventlayaApplication.kt); this is
    // a no-op then. High importance = sound, heads-up, and shown on the lock
    // screen; showBadge = launcher dot while a notification is active.
    const channel = AndroidNotificationChannel(
      channelId,
      _channelName,
      description: _channelDescription,
      importance: Importance.high,
      enableVibration: true,
      playSound: true,
      showBadge: true,
    );
    final android = _localNotifications.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    await android?.deleteNotificationChannel(_legacyChannelId);
    await android?.createNotificationChannel(channel);

    _initialized = true;
    debugPrint('NotificationService: Local notifications initialized');
  }

  /// Shows a notification from the app itself (pushes received while it is
  /// open, gate scan alerts). Looks like the ones FCM shows in the background.
  /// With [tag] it replaces the previous notification with that tag; [number]
  /// is the launcher badge count (e.g. unread messages in that chat).
  static Future<void> showLocalNotification({
    required String title,
    required String body,
    String? payload,
    int id = 0,
    String? tag,
    int? number,
  }) async {
    final androidDetails = AndroidNotificationDetails(
      channelId,
      _channelName,
      channelDescription: _channelDescription,
      importance: Importance.high,
      priority: Priority.high,
      icon: _smallIcon,
      color: _brandColor,
      // Personal text (bookings, chat) is hidden on a secure lock screen when
      // the user chose "hide sensitive content"; Android then shows "Eventlaya"
      // with the icon only. Same as the backend payload's visibility.
      visibility: NotificationVisibility.private,
      category: tag != null && tag.startsWith('chat:') ? AndroidNotificationCategory.message : null,
      tag: tag,
      number: number != null && number > 0 ? number : null,
      styleInformation: BigTextStyleInformation(body),
    );
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentSound: true,
      presentBadge: true,
    );
    final details = NotificationDetails(android: androidDetails, iOS: iosDetails);

    await _localNotifications.show(tag != null ? _taggedId : id, title, body, details, payload: payload);
  }

  /// Removes the shade notification for [tag] (shown by FCM or by the app).
  static Future<void> clear(String tag) async {
    if (!_initialized) return;
    try {
      await _localNotifications.cancel(_taggedId, tag: tag);
    } catch (e) {
      debugPrint('NotificationService: clear $tag failed: $e');
    }
  }

  /// The user opened this conversation: its notification has been seen.
  static Future<void> clearChat(String conversationId) => clear('chat:$conversationId');

  /// The user opened this booking request.
  static Future<void> clearBooking(String inquiryId) => clear('booking:$inquiryId');

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
      _firebaseReady = true;

      // Listeners are set up regardless of the permission: on Android the
      // token works without it, and taps / foreground refreshes still matter.
      // The permission prompt itself waits for a signed-in user
      // ([registerToken] -> [_requestPermissionOnce]).
      await registerToken();
      FirebaseMessaging.instance.onTokenRefresh.listen((_) => registerToken());

      // Foreground messages: show a local notification (tap data in the
      // payload), except chat messages for the conversation already open.
      FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        debugPrint('FCM Foreground Message: ${message.notification?.title}');
        final data = Map<String, dynamic>.from(message.data);
        if (data.isNotEmpty) _messages.add(data);
        if (data['type'] == 'chat_message' && data['conversation_id'] == activeChatConversationId) return;
        final n = message.notification;
        if (n == null) return;
        final tag = n.android?.tag ?? tagFor(data);
        showLocalNotification(
          title: n.title ?? 'Eventlaya',
          body: n.body ?? '',
          payload: data.isEmpty ? null : jsonEncode(data),
          tag: tag,
          number: n.android?.count,
          // Untagged: one notification per push (a fixed id would replace the previous one).
          id: (message.messageId ?? '${DateTime.now().microsecondsSinceEpoch}').hashCode & 0x7fffffff,
        );
      });

      // Taps on system notifications (app in background / terminated).
      FirebaseMessaging.onMessageOpenedApp.listen((m) => _emitTap(Map<String, dynamic>.from(m.data)));
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null && initial.data.isNotEmpty) _pendingTap = Map<String, dynamic>.from(initial.data);
    } catch (e) {
      debugPrint('NotificationService: Firebase FCM not initialized (expected if credentials missing): $e');
    }
  }

  static bool _permissionAsked = false;

  /// Asks for notification permission (Android 13+ POST_NOTIFICATIONS, iOS
  /// alerts) once per launch, only once someone is signed in: right after
  /// sign-in, or at launch for a returning user — never over the sign-in
  /// screen of a first-time user. Android itself stops asking after two
  /// refusals; a refusal only loses the banners, the in-app inbox still works.
  static Future<void> _requestPermissionOnce() async {
    if (_permissionAsked) return;
    _permissionAsked = true;
    try {
      final settings = await FirebaseMessaging.instance.requestPermission(alert: true, badge: true, sound: true);
      debugPrint('FCM: notification permission ${settings.authorizationStatus.name}');
    } catch (e) {
      debugPrint('FCM: permission request failed: $e');
    }
  }

  static bool _firebaseReady = false;

  /// Sends this device's FCM token to the backend for the signed-in user.
  /// Called at launch and again after every sign-in (the launch call is
  /// refused while signed out).
  static Future<void> registerToken() async {
    if (!_firebaseReady) return;
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null) return;
      await ApiClient().post('/api/auth/fcm-token/', data: {
        'token': token,
        'platform': defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
      });
      debugPrint('FCM: Token registered with backend');
      unawaited(_requestPermissionOnce()); // signed in (the post above needs a session)
    } catch (e) {
      debugPrint('FCM: Token not registered (signed out?): $e');
    }
  }
}
