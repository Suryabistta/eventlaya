import 'package:shared_preferences/shared_preferences.dart';

class AppStorage {
  static const _keyToken = 'auth_token';
  static const _keyRefreshToken = 'refresh_token';
  static const _keyUserJson = 'user_json';
  static const _keyServerUrl = 'server_url';
  static const _keySelectedGate = 'selected_gate';
  static const _keySelectedEventId = 'selected_event_id';

  // Default server URL — 10.0.2.2 for Android emulator, 127.0.0.1 for desktop/web
  static const defaultServerUrl = 'http://127.0.0.1:8000';

  static Future<SharedPreferences> get _prefs async => SharedPreferences.getInstance();

  static Future<void> saveAuthToken(String token) async {
    final p = await _prefs;
    await p.setString(_keyToken, token);
  }

  static Future<void> saveRefreshToken(String token) async {
    final p = await _prefs;
    await p.setString(_keyRefreshToken, token);
  }

  static Future<String?> getAuthToken() async {
    final p = await _prefs;
    return p.getString(_keyToken);
  }

  static Future<String?> getRefreshToken() async {
    final p = await _prefs;
    return p.getString(_keyRefreshToken);
  }

  static Future<void> saveUserJson(String json) async {
    final p = await _prefs;
    await p.setString(_keyUserJson, json);
  }

  static Future<String?> getUserJson() async {
    final p = await _prefs;
    return p.getString(_keyUserJson);
  }

  static Future<void> saveServerUrl(String url) async {
    final p = await _prefs;
    await p.setString(_keyServerUrl, url.trimRight().replaceAll(RegExp(r'/$'), ''));
  }

  static Future<String> getServerUrl() async {
    final p = await _prefs;
    return p.getString(_keyServerUrl) ?? defaultServerUrl;
  }

  static Future<void> saveSelectedGate(String gateName) async {
    final p = await _prefs;
    await p.setString(_keySelectedGate, gateName);
  }

  static Future<String?> getSelectedGate() async {
    final p = await _prefs;
    return p.getString(_keySelectedGate);
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
    final p = await _prefs;
    await p.remove(_keyToken);
    await p.remove(_keyRefreshToken);
    await p.remove(_keyUserJson);
    await p.remove(_keySelectedGate);
    await p.remove(_keySelectedEventId);
  }
}
