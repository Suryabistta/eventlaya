import 'dart:math';
import 'package:shared_preferences/shared_preferences.dart';

class AppStorage {
  static const _keyToken = 'auth_token';
  static const _keyRefreshToken = 'refresh_token';
  static const _keyUserJson = 'user_json';
  static const _keyServerUrl = 'server_url';
  static const _keySelectedGate = 'selected_gate';
  static const _keySelectedEventId = 'selected_event_id';
  static const _keySelectedGateJson = 'selected_gate_json';
  static const _keyAttendeeView = 'prefer_attendee_view';
  static const _keyDeviceId = 'device_id';

  // Production API. For local development, change it on the sign-in screen
  // (e.g. http://127.0.0.1:8000 with `adb reverse tcp:8000 tcp:8000`).
  static const defaultServerUrl = 'https://api.eventlaya.com';

  static Future<SharedPreferences> get _prefs async => SharedPreferences.getInstance();

  static const _keyLastEmail = 'last_email';

  // ── Session persistence ("Keep me signed in") ──────────────────────────
  //
  // When the user unticks "Keep me signed in", tokens and the user profile
  // live only in memory for this app session: a kill/restart signs them out.
  // Everything else (refresh rotation, offline scan queue, staff flows) keeps
  // working because all token reads/writes go through these methods.
  static bool _persistSession = true;
  static String? _memToken;
  static String? _memRefresh;
  static String? _memUserJson;

  /// Whether the current session is saved on the device.
  static bool get persistSession => _persistSession;

  /// Chooses where the next tokens are kept. Call before saving the tokens of
  /// a new sign-in (any sign-in path: email, Google, Facebook…). Turning
  /// persistence off also removes tokens saved by an earlier session.
  static Future<void> setPersistSession(bool persist) async {
    _persistSession = persist;
    _memToken = _memRefresh = _memUserJson = null;
    if (!persist) {
      final p = await _prefs;
      await p.remove(_keyToken);
      await p.remove(_keyRefreshToken);
      await p.remove(_keyUserJson);
    }
  }

  static Future<void> saveAuthToken(String token) async {
    if (!_persistSession) {
      _memToken = token;
      return;
    }
    final p = await _prefs;
    await p.setString(_keyToken, token);
  }

  static Future<void> saveRefreshToken(String token) async {
    if (!_persistSession) {
      _memRefresh = token;
      return;
    }
    final p = await _prefs;
    await p.setString(_keyRefreshToken, token);
  }

  static Future<String?> getAuthToken() async {
    if (!_persistSession) return _memToken;
    final p = await _prefs;
    return p.getString(_keyToken);
  }

  static Future<String?> getRefreshToken() async {
    if (!_persistSession) return _memRefresh;
    final p = await _prefs;
    return p.getString(_keyRefreshToken);
  }

  static Future<void> saveUserJson(String json) async {
    if (!_persistSession) {
      _memUserJson = json;
      return;
    }
    final p = await _prefs;
    await p.setString(_keyUserJson, json);
  }

  static Future<String?> getUserJson() async {
    if (!_persistSession) return _memUserJson;
    final p = await _prefs;
    return p.getString(_keyUserJson);
  }

  /// Email to prefill on the sign-in screen. Saved only for "Keep me signed
  /// in" sessions; passing null forgets it. Passwords are never stored.
  static Future<void> saveLastEmail(String? email) async {
    final p = await _prefs;
    if (email == null || email.isEmpty) {
      await p.remove(_keyLastEmail);
    } else {
      await p.setString(_keyLastEmail, email);
    }
  }

  static Future<String?> getLastEmail() async {
    final p = await _prefs;
    return p.getString(_keyLastEmail);
  }

  static String? _serverUrlCache;

  /// Last known server URL without waiting on storage (used to resolve
  /// relative `/media/...` paths while building widgets).
  static String get serverUrlSync => _serverUrlCache ?? defaultServerUrl;

  static Future<void> saveServerUrl(String url) async {
    final p = await _prefs;
    final clean = url.trimRight().replaceAll(RegExp(r'/$'), '');
    await p.setString(_keyServerUrl, clean);
    _serverUrlCache = clean;
  }

  static Future<String> getServerUrl() async {
    final p = await _prefs;
    return _serverUrlCache = p.getString(_keyServerUrl) ?? defaultServerUrl;
  }

  /// True when a developer pointed the app at a non-default server.
  static bool get isCustomServer => serverUrlSync != defaultServerUrl;

  /// Organizer / staff chose to browse as an attendee (kept across launches).
  static Future<void> savePreferAttendeeView(bool value) async {
    final p = await _prefs;
    await p.setBool(_keyAttendeeView, value);
  }

  static Future<bool> getPreferAttendeeView() async {
    final p = await _prefs;
    return p.getBool(_keyAttendeeView) ?? false;
  }

  /// Random id for this install, used for "one vote per device" polls.
  static Future<String> getDeviceId() async {
    final p = await _prefs;
    final existing = p.getString(_keyDeviceId);
    if (existing != null && existing.isNotEmpty) return existing;
    final r = Random.secure();
    final id = List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    await p.setString(_keyDeviceId, id);
    return id;
  }

  static Future<void> saveSelectedGate(String gateName) async {
    final p = await _prefs;
    await p.setString(_keySelectedGate, gateName);
  }

  static Future<String?> getSelectedGate() async {
    final p = await _prefs;
    return p.getString(_keySelectedGate);
  }

  /// The chosen gate (as JSON) for dynamic per-event gates; null clears it.
  static Future<void> saveSelectedGateJson(String? json) async {
    final p = await _prefs;
    if (json == null) {
      await p.remove(_keySelectedGateJson);
    } else {
      await p.setString(_keySelectedGateJson, json);
    }
  }

  static Future<String?> getSelectedGateJson() async {
    final p = await _prefs;
    return p.getString(_keySelectedGateJson);
  }

  static Future<void> saveSelectedEventId(String id) async {
    final p = await _prefs;
    await p.setString(_keySelectedEventId, id);
  }

  static Future<String?> getSelectedEventId() async {
    final p = await _prefs;
    return p.getString(_keySelectedEventId);
  }

  static Future<bool> isLoggedIn() async {
    final token = await getAuthToken();
    return token != null && token.isNotEmpty;
  }

  static Future<void> clearAll() async {
    _memToken = _memRefresh = _memUserJson = null;
    _persistSession = true;
    final p = await _prefs;
    await p.remove(_keyToken);
    await p.remove(_keyRefreshToken);
    await p.remove(_keyUserJson);
    await p.remove(_keySelectedGate);
    await p.remove(_keySelectedEventId);
    await p.remove(_keySelectedGateJson);
    await p.remove(_keyAttendeeView);
    // Passes saved on this device (attendee) are kept on purpose: they belong
    // to the phone, not the account, and must work offline at the gate.
  }
}
