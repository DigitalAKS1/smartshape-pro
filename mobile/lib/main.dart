import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'app.dart';
import 'firebase_options.dart';

/// Background/terminated push handler. For notification payloads the OS shows
/// the tray entry automatically; this hook is required to be a top-level fn.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // No-op: tray entry is rendered by the system.
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Firebase is optional until `flutterfire configure` is run — skip gracefully
  // so the rest of the app (login, attendance, leads) still works.
  try {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  } catch (e) {
    debugPrint('[push] Firebase not configured yet: $e');
  }
  runApp(const ProviderScope(child: SmartShapeApp()));
}
