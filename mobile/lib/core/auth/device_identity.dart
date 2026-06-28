import 'dart:io';
import 'dart:math';
import 'dart:ui' as ui;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:device_info_plus/device_info_plus.dart';

/// Provides a stable per-install device token (for the backend device-trust
/// system) and a human-readable device-info payload.
class DeviceIdentity {
  DeviceIdentity(this._storage);

  final FlutterSecureStorage _storage;
  static const _kDeviceToken = 'device_token';

  Future<String> getOrCreateDeviceToken() async {
    final existing = await _storage.read(key: _kDeviceToken);
    if (existing != null && existing.isNotEmpty) return existing;
    final token = _uuidV4();
    await _storage.write(key: _kDeviceToken, value: token);
    return token;
  }

  Future<Map<String, dynamic>> deviceInfo() async {
    final info = DeviceInfoPlugin();
    String label = 'Mobile device';
    final platform = Platform.isIOS ? 'ios' : 'android';
    try {
      if (Platform.isAndroid) {
        final a = await info.androidInfo;
        label = '${a.manufacturer} ${a.model}';
      } else if (Platform.isIOS) {
        final i = await info.iosInfo;
        label = '${i.name} (${i.model})';
      }
    } catch (_) {/* keep default label */}

    String screen = '';
    try {
      final view = ui.PlatformDispatcher.instance.views.first;
      final size = view.physicalSize;
      screen = '${size.width.toInt()}x${size.height.toInt()}';
    } catch (_) {}

    return {
      'label': label,
      'platform': platform,
      'screen': screen,
      'timezone': DateTime.now().timeZoneName,
      'language': ui.PlatformDispatcher.instance.locale.languageCode,
    };
  }

  String _uuidV4() {
    final r = Random.secure();
    final b = List<int>.generate(16, (_) => r.nextInt(256));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant
    String hex(int i) => b[i].toRadixString(16).padLeft(2, '0');
    final s = List.generate(16, hex).join();
    return '${s.substring(0, 8)}-${s.substring(8, 12)}-${s.substring(12, 16)}-'
        '${s.substring(16, 20)}-${s.substring(20)}';
  }
}
