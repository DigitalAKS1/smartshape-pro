import 'dart:io';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../api/api_client.dart';
import '../api/endpoints.dart';

/// Native push via Firebase Cloud Messaging. Foreground messages are rendered
/// with [FlutterLocalNotificationsPlugin]; background/terminated messages are
/// shown by the OS automatically for notification payloads.
class PushService {
  PushService(
    this._api, {
    FirebaseMessaging? messaging,
    FlutterLocalNotificationsPlugin? local,
  })  : _fm = messaging ?? FirebaseMessaging.instance,
        _local = local ?? FlutterLocalNotificationsPlugin();

  final ApiClient _api;
  final FirebaseMessaging _fm;
  final FlutterLocalNotificationsPlugin _local;
  bool _initialised = false;

  Future<void> init() async {
    if (_initialised) return;
    await _fm.requestPermission();
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const ios = DarwinInitializationSettings();
    await _local.initialize(
      const InitializationSettings(android: android, iOS: ios),
    );
    FirebaseMessaging.onMessage.listen(_showForeground);
    _initialised = true;
  }

  Future<void> _showForeground(RemoteMessage m) async {
    final n = m.notification;
    if (n == null) return;
    const details = NotificationDetails(
      android: AndroidNotificationDetails(
        'default_channel',
        'General',
        channelDescription: 'SmartShape alerts',
        importance: Importance.high,
        priority: Priority.high,
      ),
      iOS: DarwinNotificationDetails(),
    );
    await _local.show(n.hashCode, n.title, n.body, details);
  }

  Future<void> registerToken() async {
    final token = await _fm.getToken();
    if (token == null) return;
    await _api.dio.post(Endpoints.fcmRegister, data: {
      'fcm_token': token,
      'platform': Platform.isIOS ? 'ios' : 'android',
    });
  }

  Future<void> unregisterToken() async {
    final token = await _fm.getToken();
    if (token == null) return;
    await _api.dio.delete(Endpoints.fcmUnregister, data: {'fcm_token': token});
  }
}
