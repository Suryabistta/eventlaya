import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../attendee/data/account_api.dart';

/// Which social buttons to show: those the server has configured
/// (`GET /api/auth/social/config/`) AND this build can actually run.
final socialConfigProvider = FutureProvider<SocialConfig>((ref) => AccountApi().socialConfig());

/// Thrown when the user closes the provider's sheet (show nothing).
class SocialCancelled implements Exception {
  const SocialCancelled();
}

/// Google sign-in via `google_sign_in` (Android Credential Manager / iOS SDK).
///
/// Needs, outside the code (see report): an Android OAuth client for the
/// package `com.eventlaya.eventlaya_scanner` + the signing SHA-1 in Google
/// Cloud, and the *Web* OAuth client ID as `serverClientId` so the ID token
/// is issued for the backend. The Web client ID is taken from
/// `--dart-define=GOOGLE_SERVER_CLIENT_ID=…` when given, else the first of
/// the server's `google.client_ids`.
class GoogleAuth {
  GoogleAuth._();
  static const _override = String.fromEnvironment('GOOGLE_SERVER_CLIENT_ID');
  static Future<void>? _init;

  static String? serverClientId(SocialConfig cfg) =>
      _override.isNotEmpty ? _override : cfg.googleClientIds.firstOrNull;

  /// Returns a Google ID token for the backend.
  static Future<String> idToken(SocialConfig cfg) async {
    final signIn = GoogleSignIn.instance;
    _init ??= signIn.initialize(serverClientId: serverClientId(cfg));
    await _init;
    if (!signIn.supportsAuthenticate()) {
      throw const AccountError('Google sign-in isn\'t supported on this device.');
    }
    try {
      final account = await signIn.authenticate();
      final token = account.authentication.idToken;
      if (token == null || token.isEmpty) {
        throw const AccountError('Google didn\'t return a sign-in token. Try again.');
      }
      return token;
    } on GoogleSignInException catch (e) {
      if (e.code == GoogleSignInExceptionCode.canceled ||
          e.code == GoogleSignInExceptionCode.interrupted) {
        throw const SocialCancelled();
      }
      debugPrint('Google sign-in: ${e.code} ${e.description}');
      throw AccountError(
          'Google sign-in isn\'t set up for this app yet${kDebugMode ? ' (${e.code.name})' : ''}.');
    }
  }

  static Future<void> signOut() async {
    try {
      if (_init != null) await GoogleSignIn.instance.signOut();
    } catch (_) {}
  }
}

/// Facebook sign-in is NOT bundled in this build: the Facebook SDK needs the
/// app id and client token in `android/app/src/main/res/values/strings.xml`
/// and `<meta-data>` entries in AndroidManifest.xml (plus Info.plist on iOS),
/// which can't be verified from here. When those are added together with
/// `flutter_facebook_auth`, implement [accessToken] with
/// `FacebookAuth.instance.login()` → `result.accessToken!.tokenString` and set
/// [available] to true; the button and the backend call are already wired.
class FacebookAuthBridge {
  FacebookAuthBridge._();
  static const available = false;

  static Future<String> accessToken() async =>
      throw const AccountError('Facebook sign-in isn\'t available in this version of the app.');
}
