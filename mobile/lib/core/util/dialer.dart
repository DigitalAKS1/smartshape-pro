import 'package:url_launcher/url_launcher.dart';

class Dialer {
  /// Opens the phone dialer pre-filled with [phone].
  static Future<bool> call(String phone) async {
    final cleaned = phone.replaceAll(RegExp(r'[^0-9+]'), '');
    if (cleaned.isEmpty) return false;
    final uri = Uri(scheme: 'tel', path: cleaned);
    if (await canLaunchUrl(uri)) {
      return launchUrl(uri);
    }
    return false;
  }
}
