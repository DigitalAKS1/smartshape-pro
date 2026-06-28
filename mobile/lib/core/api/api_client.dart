import 'package:dio/dio.dart';
import '../auth/token_store.dart';
import '../config/app_config.dart';
import '../error/api_failure.dart';
import 'endpoints.dart';

/// Wraps a [Dio] instance with Bearer-token auth and transparent 401 refresh.
class ApiClient {
  ApiClient(this.tokenStore, {Dio? dio, this.onSessionExpired})
      : dio = dio ?? Dio() {
    this.dio.options.baseUrl = AppConfig.apiPrefix;
    this.dio.options.connectTimeout = const Duration(seconds: 20);
    this.dio.options.receiveTimeout = const Duration(seconds: 30);
    this.dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: _onRequest,
            onError: _onError,
          ),
        );
  }

  final TokenStore tokenStore;
  final Dio dio;
  final void Function()? onSessionExpired;

  Future<void> _onRequest(
      RequestOptions options, RequestInterceptorHandler handler) async {
    final token = await tokenStore.accessToken;
    if (token != null) options.headers['Authorization'] = 'Bearer $token';
    handler.next(options);
  }

  Future<void> _onError(
      DioException e, ErrorInterceptorHandler handler) async {
    final is401 = e.response?.statusCode == 401;
    final isRefreshCall = e.requestOptions.path.contains(Endpoints.refresh);
    if (is401 && !isRefreshCall) {
      try {
        if (await _refresh()) {
          final retried = await _retry(e.requestOptions);
          return handler.resolve(retried);
        }
      } catch (_) {/* fall through to session-expired */}
      await tokenStore.clear();
      onSessionExpired?.call();
      return handler.reject(
        DioException(requestOptions: e.requestOptions, error: SessionExpired()),
      );
    }
    handler.next(e);
  }

  Future<bool> _refresh() async {
    final rt = await tokenStore.refreshToken;
    if (rt == null) return false;
    final r = await dio.post(Endpoints.refresh, data: {'refresh_token': rt});
    final data = r.data;
    if (data is! Map || data['access_token'] == null) return false;
    await tokenStore.save(
      access: data['access_token'] as String,
      refresh: data['refresh_token'] as String,
    );
    return true;
  }

  Future<Response<dynamic>> _retry(RequestOptions o) async {
    final token = await tokenStore.accessToken;
    return dio.request(
      o.path,
      data: o.data,
      queryParameters: o.queryParameters,
      options: Options(
        method: o.method,
        headers: {...o.headers, 'Authorization': 'Bearer $token'},
      ),
    );
  }
}
