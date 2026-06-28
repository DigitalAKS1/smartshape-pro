import 'package:dio/dio.dart';
import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';
import '../../../core/auth/token_store.dart';
import '../../../core/auth/device_identity.dart';
import '../../../core/error/api_failure.dart';
import 'user_model.dart';

class AuthRepository {
  AuthRepository(this._api, this._tokens, this._device);

  final ApiClient _api;
  final TokenStore _tokens;
  final DeviceIdentity _device;

  Future<UserModel> login(String email, String password) async {
    try {
      final deviceToken = await _device.getOrCreateDeviceToken();
      final info = await _device.deviceInfo();
      final r = await _api.dio.post(Endpoints.login, data: {
        'email': email.trim(),
        'password': password,
        'device_token': deviceToken,
        'device_info': info,
      });
      final data = Map<String, dynamic>.from(r.data as Map);
      await _tokens.save(
        access: data['access_token'] as String,
        refresh: data['refresh_token'] as String,
      );
      return UserModel.fromJson(data);
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }

  Future<void> logout() async {
    try {
      await _api.dio.post(Endpoints.logout);
    } catch (_) {/* best effort */}
    await _tokens.clear();
  }

  Future<UserModel?> currentUser() async {
    if (await _tokens.accessToken == null) return null;
    try {
      final r = await _api.dio.get(Endpoints.me);
      return UserModel.fromJson(Map<String, dynamic>.from(r.data as Map));
    } catch (_) {
      return null;
    }
  }

  /// Maps backend auth errors (incl. structured device-trust / lockout detail)
  /// to a presentable [ApiFailure].
  ApiFailure _mapError(DioException e) {
    final status = e.response?.statusCode;
    final raw = e.response?.data;
    final detail = raw is Map ? raw['detail'] : null;

    if (detail is Map) {
      return ApiFailure(
        (detail['message'] ?? 'Login failed').toString(),
        statusCode: status,
        code: (detail['code'] ?? '').toString(),
      );
    }
    if (detail is String && detail.isNotEmpty) {
      return ApiFailure(detail, statusCode: status);
    }
    if (e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout) {
      return ApiFailure('Cannot reach the server. Check your connection.',
          statusCode: status);
    }
    final msg = status == 401
        ? 'Invalid email or password'
        : 'Login failed. Please try again.';
    return ApiFailure(msg, statusCode: status);
  }
}
