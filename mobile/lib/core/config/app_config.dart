/// App-wide configuration. The API base URL is injected at build/run time:
///   flutter run --dart-define=API_BASE_URL=http://192.168.1.5:8000
/// Defaults to the Android-emulator loopback (10.0.2.2 -> host machine).
class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:8000',
  );

  /// Every backend route is mounted under `/api`.
  static String get apiPrefix => '$apiBaseUrl/api';
}
