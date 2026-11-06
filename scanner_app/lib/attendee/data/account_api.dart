import 'package:dio/dio.dart';
import '../../core/api_client.dart';
import '../../models/app_user.dart';

/// Error with the server's machine-readable `code` (e.g. `wrong_password`,
/// `invalid_code`, `rate_limited`) next to the message to show.
class AccountError implements Exception {
  final String message;
  final String? code;
  final int? status;
  final Map<String, dynamic> data;
  const AccountError(this.message, {this.code, this.status, this.data = const {}});

  factory AccountError.from(Object e) {
    if (e is AccountError) return e;
    if (e is DioException) {
      final d = e.response?.data;
      final map = d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{};
      return AccountError(ApiClient().errorMessage(e),
          code: map['code']?.toString(), status: e.response?.statusCode, data: map);
    }
    return const AccountError('Something went wrong. Please try again.');
  }

  @override
  String toString() => message;
}

/// Result of `POST /api/auth/email/verify/`.
class VerifyResult {
  final int linkedTickets;
  final String message;
  final AppUser? user;
  const VerifyResult(this.linkedTickets, this.message, this.user);
}

/// Which social sign-in buttons the server supports (`/api/auth/social/config/`).
class SocialConfig {
  final bool google;
  final List<String> googleClientIds;
  final bool facebook;
  final String? facebookAppId;
  const SocialConfig({this.google = false, this.googleClientIds = const [], this.facebook = false, this.facebookAppId});

  static const none = SocialConfig();
}

/// Account self-service: sign-up, profile, password, email verification,
/// deletion and social sign-in. All errors are thrown as [AccountError].
class AccountApi {
  AccountApi([ApiClient? client]) : _api = client ?? ApiClient();
  final ApiClient _api;

  Future<T> _wrap<T>(Future<T> Function() f) async {
    try {
      return await f();
    } catch (e) {
      throw AccountError.from(e);
    }
  }

  /// `POST /api/auth/register/` as an attendee. Returns no tokens: sign in
  /// afterwards. The server emails a 6-digit verification code.
  Future<void> registerAttendee({
    required String firstName,
    required String lastName,
    required String email,
    required String password,
  }) =>
      _wrap(() => _api.post('/api/auth/register/', data: {
            'account_type': 'attendee',
            'first_name': firstName,
            'last_name': lastName,
            'email': email,
            'password': password,
            // The sign-up screen says "By creating an account you agree to the Terms of service and Privacy
            // policy"; the server refuses sign-ups without this and records when they agreed.
            'terms': true,
          }));

  /// `PATCH /api/auth/me/` → the updated user.
  Future<AppUser> updateProfile(Map<String, dynamic> fields) => _wrap(() async {
        final resp = await _api.patch('/api/auth/me/', data: fields);
        return AppUser.fromJson(Map<String, dynamic>.from(resp.data as Map));
      });

  /// `POST /api/auth/password/` (no current password for social-only accounts).
  Future<String> changePassword({String? currentPassword, required String newPassword}) => _wrap(() async {
        final resp = await _api.post('/api/auth/password/', data: {
          if (currentPassword != null) 'current_password': currentPassword,
          'new_password': newPassword,
        });
        return (resp.data is Map ? resp.data['message']?.toString() : null) ?? 'Password changed.';
      });

  /// `DELETE /api/auth/me/` with `{password}` or `{confirm: true}`.
  Future<void> deleteAccount({String? password}) => _wrap(() => _api.delete('/api/auth/me/',
      data: password != null ? {'password': password} : {'confirm': true}));

  /// `POST /api/auth/email/send-code/` → message (429 `rate_limited` carries `retry_after`).
  Future<String> sendVerificationCode() => _wrap(() async {
        final resp = await _api.post('/api/auth/email/send-code/');
        return (resp.data is Map ? resp.data['message']?.toString() : null) ?? 'We sent you a new code.';
      });

  /// `POST /api/auth/email/verify/ {code}`.
  Future<VerifyResult> verifyEmail(String code) => _wrap(() async {
        final resp = await _api.post('/api/auth/email/verify/', data: {'code': code});
        final d = Map<String, dynamic>.from(resp.data as Map);
        return VerifyResult(
          int.tryParse(d['linked_tickets']?.toString() ?? '') ?? 0,
          d['message']?.toString() ?? 'Email verified.',
          d['user'] is Map ? AppUser.fromJson(Map<String, dynamic>.from(d['user'] as Map)) : null,
        );
      });

  /// `GET /api/auth/social/config/`. Never throws: no buttons on failure.
  Future<SocialConfig> socialConfig() async {
    try {
      final resp = await _api.get('/api/auth/social/config/');
      final d = Map<String, dynamic>.from(resp.data as Map);
      final g = d['google'] is Map ? d['google'] as Map : const {};
      final f = d['facebook'] is Map ? d['facebook'] as Map : const {};
      return SocialConfig(
        google: g['enabled'] == true,
        googleClientIds: [if (g['client_ids'] is List) for (final c in g['client_ids'] as List) c.toString()],
        facebook: f['enabled'] == true,
        facebookAppId: f['app_id']?.toString(),
      );
    } catch (_) {
      return SocialConfig.none;
    }
  }

  /// `POST /api/auth/social/<provider>/` → login payload `{access, refresh, user, created, linked_tickets}`.
  Future<Map<String, dynamic>> socialLogin(String provider, String token, {required bool remember}) =>
      _wrap(() async {
        final resp = await _api.post('/api/auth/social/$provider/', data: {
          provider == 'google' ? 'id_token' : 'access_token': token,
          'remember': remember,
        });
        return Map<String, dynamic>.from(resp.data as Map);
      });

  /// `POST /api/uploads/` (multipart) → the stored path/url, for avatars and chat images.
  /// [onProgress] gets 0.0–1.0 while the file is sent.
  Future<String> uploadImage(MultipartFile file, {required String kind, void Function(double)? onProgress}) =>
      _wrap(() async {
        final resp = await _api.upload(
          '/api/uploads/',
          FormData.fromMap({'file': file, 'kind': kind}),
          onSendProgress: onProgress == null ? null : (sent, total) => onProgress(total > 0 ? sent / total : 0),
        );
        return resp.data['url'].toString();
      });

  /// Uploads a picked photo file (see `lib/core/photo_picker.dart`).
  Future<String> uploadPhoto(String path, {required String kind, void Function(double)? onProgress}) async {
    final name = path.split('/').last;
    return uploadImage(await MultipartFile.fromFile(path, filename: name), kind: kind, onProgress: onProgress);
  }
}
