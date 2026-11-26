import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'media_url.dart';
import 'storage.dart';

/// Eventlaya's own logo as set by the superadmin (Admin → Site logo).
///
/// The last known URL is kept on the device so the logo shows straight away
/// (and offline); it is refreshed from the server on every app start.
/// A null value means "use the built-in logo".
class SiteBranding {
  SiteBranding._();

  static const _keyLogo = 'site_branding_logo';
  static final ValueNotifier<String?> logo = ValueNotifier<String?>(null);

  /// Loads the cached logo, then refreshes it from the server in the background.
  static Future<void> init() async {
    try {
      final p = await SharedPreferences.getInstance();
      await AppStorage.getServerUrl(); // primes serverUrlSync for mediaUrl()
      logo.value = p.getString(_keyLogo);
    } catch (e) {
      debugPrint('Site branding cache error: $e');
    }
    refresh();
  }

  static Future<void> refresh() async {
    try {
      final base = await AppStorage.getServerUrl();
      final dio = Dio(BaseOptions(
          connectTimeout: const Duration(seconds: 8),
          receiveTimeout: const Duration(seconds: 8)));
      final resp = await dio.get('$base/api/platform/site-branding/');
      final data = resp.data;
      if (data is! Map) return;
      final url = mediaUrl(data['logo']);
      final p = await SharedPreferences.getInstance();
      if (url == null) {
        await p.remove(_keyLogo);
      } else {
        await p.setString(_keyLogo, url);
      }
      logo.value = url;
    } catch (e) {
      debugPrint(
          'Site branding refresh failed: $e'); // keep the cached/built-in logo
    }
  }
}
