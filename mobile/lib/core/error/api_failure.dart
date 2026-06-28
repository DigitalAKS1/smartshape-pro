/// A user-presentable failure derived from an API error.
class ApiFailure implements Exception {
  ApiFailure(this.message, {this.statusCode, this.code});

  final String message;
  final int? statusCode;

  /// Backend error code where present, e.g. DEVICE_PENDING / DEVICE_REVOKED /
  /// DEVICE_LIMIT_REACHED. Empty string when the backend sent a plain message.
  final String? code;

  @override
  String toString() => message;
}

/// Raised when the refresh token is missing/expired and the session is over.
class SessionExpired extends ApiFailure {
  SessionExpired()
      : super('Your session has expired. Please log in again.', statusCode: 401);
}
