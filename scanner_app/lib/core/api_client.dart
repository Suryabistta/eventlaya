import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'storage.dart';

class ApiClient {
  static ApiClient? _instance;
  late Dio _dio;

  ApiClient._internal() {
    _dio = Dio();
    _setupInterceptors();
  }

  ApiClient._withDio(Dio dio) {
    _dio = dio;
  }

  factory ApiClient() {
    _instance ??= ApiClient._internal();
    return _instance!;
  }

  /// Replaces the shared client with one backed by [dio] (tests and previews).
  /// With [withSessionHandling] the 401 refresh/expiry interceptor is added too.
  @visibleForTesting
  static void overrideWithDio(Dio dio, {bool withSessionHandling = false}) {
    final client = ApiClient._withDio(dio);
    if (withSessionHandling) dio.interceptors.add(client._sessionInterceptor());
    _instance = client;
  }

  static final _sessionExpired = StreamController<void>.broadcast();

  /// Fires when a request got 401 and the token could not be refreshed.
  /// The saved session has already been cleared when this fires.
  static Stream<void> get onSessionExpired => _sessionExpired.stream;

  static const _skipRefresh = 'skipAuthRefresh';
  Future<String?>? _refreshing;

  /// Exchanges the refresh token for a new access token. Null on failure.
  Future<String?> _refreshAccessToken() {
    return _refreshing ??= () async {
      try {
        final refresh = await AppStorage.getRefreshToken();
        if (refresh == null || refresh.isEmpty) return null;
        final resp = await _dio.post(
          '/api/auth/refresh/',
          data: {'refresh': refresh},
          options: Options(extra: {_skipRefresh: true}),
        );
        final data = resp.data;
        final access = data is Map ? data['access']?.toString() : null;
        if (access == null) return null;
        await AppStorage.saveAuthToken(access);
        final rotated = data['refresh']?.toString();
        if (rotated != null) await AppStorage.saveRefreshToken(rotated);
        return access;
      } catch (_) {
        return null;
      } finally {
        _refreshing = null;
      }
    }();
  }

  bool _isAuthEndpoint(String path) =>
      path.contains('/api/auth/login/') || path.contains('/api/auth/refresh/');

  Interceptor _sessionInterceptor() => InterceptorsWrapper(
        onError: (DioException e, handler) async {
          final opts = e.requestOptions;
          if (e.response?.statusCode != 401 ||
              opts.extra[_skipRefresh] == true ||
              _isAuthEndpoint(opts.path)) {
            handler.next(e);
            return;
          }
          final token = await _refreshAccessToken();
          if (token != null) {
            try {
              opts.headers['Authorization'] = 'Bearer $token';
              opts.extra[_skipRefresh] = true; // retry once only
              handler.resolve(await _dio.fetch(opts));
              return;
            } on DioException catch (retryError) {
              if (retryError.response?.statusCode != 401) {
                handler.next(retryError);
                return;
              }
            }
          }
          // Refresh failed: end the session.
          final hadSession = await AppStorage.isLoggedIn();
          await AppStorage.clearAll();
          if (hadSession) _sessionExpired.add(null);
          handler.next(e);
        },
      );

  void _setupInterceptors() {
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final baseUrl = await AppStorage.getServerUrl();
        options.baseUrl = baseUrl;
        options.connectTimeout = const Duration(seconds: 10);
        options.receiveTimeout = const Duration(seconds: 15);
        if (options.data is! FormData) options.headers['Content-Type'] = 'application/json';
        options.headers['Accept'] = 'application/json';

        final token = await AppStorage.getAuthToken();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onResponse: (response, handler) {
        handler.next(response);
      },
      onError: (DioException e, handler) {
        debugPrint('API Error [${e.response?.statusCode}]: ${e.requestOptions.path}');
        handler.next(e);
      },
    ));
    _dio.interceptors.add(_sessionInterceptor());

    if (kDebugMode) {
      _dio.interceptors.add(LogInterceptor(
        requestBody: true,
        responseBody: true,
        logPrint: (obj) => debugPrint('[DIO] $obj'),
      ));
    }
  }

  Future<Response> get(String path, {Map<String, dynamic>? queryParameters}) async {
    return _dio.get(path, queryParameters: queryParameters);
  }

  Future<Response> post(String path, {dynamic data}) async {
    return _dio.post(path, data: data);
  }

  Future<Response> patch(String path, {dynamic data}) async {
    return _dio.patch(path, data: data);
  }

  Future<Response> delete(String path, {dynamic data}) async {
    return _dio.delete(path, data: data);
  }

  /// A file from the API (e.g. a PDF receipt) as bytes.
  Future<List<int>> getBytes(String path) async {
    final resp = await _dio.get<List<int>>(path, options: Options(responseType: ResponseType.bytes));
    return resp.data ?? const [];
  }

  /// Multipart upload (e.g. `/api/uploads/`).
  Future<Response> upload(String path, FormData data, {ProgressCallback? onSendProgress}) async {
    return _dio.post(
      path,
      data: data,
      options: Options(contentType: 'multipart/form-data', sendTimeout: const Duration(seconds: 60)),
      onSendProgress: onSendProgress,
    );
  }

  /// Gets a fresh access token with the refresh token (e.g. for the chat
  /// WebSocket after it closed with 4401). Null when the session is over.
  Future<String?> refreshAccessToken() => _refreshAccessToken();

  /// Message shown when the server has switched a feature off.
  static const moduleDisabledMessage = 'This feature is currently unavailable.';

  /// True when the server refused because a platform module is switched off
  /// (403 `{"code": "module_disabled", "module": "<slug>"}`).
  static bool isModuleDisabled(Object e) {
    if (e is! DioException || e.response?.statusCode != 403) return false;
    final data = e.response?.data;
    return data is Map && data['code'] == 'module_disabled';
  }

  /// The disabled module's slug from a module_disabled response, if any.
  static String? disabledModule(Object e) {
    if (!isModuleDisabled(e)) return null;
    return ((e as DioException).response!.data as Map)['module']?.toString();
  }

  String errorMessage(DioException e) {
    if (isModuleDisabled(e)) return moduleDisabledMessage;
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.connectionError) {
      return 'Connection failed. Check server URL and network.';
    }
    final data = e.response?.data;
    if (data is Map) {
      final direct = data['detail'] ?? data['error'] ?? data['message'];
      if (direct != null) return direct.toString();
      // DRF field errors: {"field": ["message"]} — show the first one.
      for (final v in data.values) {
        if (v is List && v.isNotEmpty) return v.first.toString();
        if (v is String && v.isNotEmpty) return v;
      }
      return 'Server error (${e.response?.statusCode})';
    }
    return 'Unexpected error. Please try again.';
  }
}
