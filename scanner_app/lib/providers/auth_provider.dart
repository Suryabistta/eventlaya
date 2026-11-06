import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../core/api_client.dart';
import '../auth/social_sign_in.dart';
import '../core/notification_service.dart';
import '../core/storage.dart';
import '../models/app_user.dart';

class AuthState {
  final AppUser? user;
  final bool isLoading;
  final String? error;

  const AuthState({this.user, this.isLoading = false, this.error});

  bool get isLoggedIn => user != null;

  AuthState copyWith({AppUser? user, bool? isLoading, String? error}) => AuthState(
        user: user ?? this.user,
        isLoading: isLoading ?? this.isLoading,
        error: error,
      );
}

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier([super.initial = const AuthState()]);

  final _api = ApiClient();

  Future<void> loadFromStorage() async {
    final jsonStr = await AppStorage.getUserJson();
    if (jsonStr != null) {
      try {
        state = AuthState(user: AppUser.fromJsonString(jsonStr));
      } catch (e) {
        debugPrint('AuthNotifier: Failed to load user from storage: $e');
      }
    }
  }

  /// Email + password sign-in. With [keepSignedIn] off the session lives in
  /// memory only (signed out when the app is closed) and the email isn't
  /// remembered for next time.
  Future<bool> login(String email, String password, {bool keepSignedIn = true}) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final response = await _api.post('/api/auth/login/', data: {
        'email': email,
        'password': password,
        // Server-side "remember me": a short refresh-token lifetime when off.
        'remember': keepSignedIn,
      });
      final ok = await completeSignIn(
        response.data as Map<String, dynamic>,
        keepSignedIn: keepSignedIn,
        email: email,
      );
      return ok;
    } on DioException catch (e) {
      state = state.copyWith(isLoading: false, error: _api.errorMessage(e));
      return false;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: 'Unexpected error: $e');
      return false;
    }
  }

  /// Finishes any sign-in path (email today; Google / Facebook later) from a
  /// token response `{access, refresh?, user?}`, honouring "Keep me signed in".
  ///
  /// TODO(social-login): the Google/Facebook buttons should POST their
  /// provider token to the new backend endpoint and pass its response here
  /// with the same [keepSignedIn] choice from the sign-in screen.
  Future<bool> completeSignIn(
    Map<String, dynamic> data, {
    required bool keepSignedIn,
    String? email,
  }) async {
    final token = data['access']?.toString();
    final refreshToken = data['refresh']?.toString();

    if (token == null) {
      state = state.copyWith(isLoading: false, error: 'Invalid response from server');
      return false;
    }

    await AppStorage.setPersistSession(keepSignedIn);
    await AppStorage.saveAuthToken(token);
    if (refreshToken != null) await AppStorage.saveRefreshToken(refreshToken);

    // Check if user object was returned directly or fetch via /api/auth/me/
    AppUser user;
    if (data['user'] is Map) {
      user = AppUser.fromJson(Map<String, dynamic>.from(data['user'] as Map));
    } else {
      final profileResp = await _api.get('/api/auth/me/');
      user = AppUser.fromJson(profileResp.data as Map<String, dynamic>);
    }

    await AppStorage.saveUserJson(user.toJsonString());
    await AppStorage.saveLastEmail(keepSignedIn ? (email ?? user.email) : null);
    state = AuthState(user: user);
    unawaited(NotificationService.registerToken());
    return true;
  }

  /// Re-reads `/api/auth/me/` (e.g. after editing the profile or verifying
  /// the email). Keeps the current user on failure.
  Future<AppUser?> refreshMe() async {
    if (state.user == null) return null;
    try {
      final resp = await _api.get('/api/auth/me/');
      final user = AppUser.fromJson(Map<String, dynamic>.from(resp.data as Map));
      await setUser(user);
      return user;
    } catch (e) {
      debugPrint('AuthNotifier.refreshMe: $e');
      return null;
    }
  }

  /// Replaces the signed-in user with fresh data from the server.
  Future<void> setUser(AppUser user) async {
    await AppStorage.saveUserJson(user.toJsonString());
    state = AuthState(user: user);
  }

  Future<void> logout() async {
    await GoogleAuth.signOut();
    await AppStorage.clearAll();
    state = const AuthState();
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier();
});
