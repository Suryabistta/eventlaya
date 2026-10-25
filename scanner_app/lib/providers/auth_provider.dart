import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../core/api_client.dart';
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
  AuthNotifier() : super(const AuthState());

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

  Future<bool> login(String email, String password) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final response = await _api.post('/api/auth/login/', data: {
        'email': email,
        'password': password,
      });

      final data = response.data as Map<String, dynamic>;
      final token = data['access']?.toString();
      final refreshToken = data['refresh']?.toString();

      if (token == null) {
        state = state.copyWith(isLoading: false, error: 'Invalid response from server');
        return false;
      }

      await AppStorage.saveAuthToken(token);
      if (refreshToken != null) await AppStorage.saveRefreshToken(refreshToken);

      // Check if user object was returned directly or fetch via /api/auth/me/
      AppUser user;
      if (data['user'] is Map) {
        user = AppUser.fromJson(data['user'] as Map<String, dynamic>);
      } else {
        final profileResp = await _api.get('/api/auth/me/');
        user = AppUser.fromJson(profileResp.data as Map<String, dynamic>);
      }

      await AppStorage.saveUserJson(user.toJsonString());
      state = AuthState(user: user);
      return true;
    } on DioException catch (e) {
      state = state.copyWith(isLoading: false, error: _api.errorMessage(e));
      return false;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: 'Unexpected error: $e');
      return false;
    }
  }

  Future<void> logout() async {
    await AppStorage.clearAll();
    state = const AuthState();
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier();
});
