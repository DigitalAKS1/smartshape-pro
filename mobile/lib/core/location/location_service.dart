import 'package:geolocator/geolocator.dart';
import '../error/api_failure.dart';

/// A simple lat/lng pair.
typedef LatLng = ({double lat, double lng});

class LocationService {
  /// Returns the current GPS position, requesting permission as needed.
  /// Throws [ApiFailure] when location is unavailable or denied.
  Future<LatLng> current() async {
    final serviceOn = await Geolocator.isLocationServiceEnabled();
    if (!serviceOn) {
      throw ApiFailure('Location is turned off. Enable it to check in.');
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    if (perm == LocationPermission.denied ||
        perm == LocationPermission.deniedForever) {
      throw ApiFailure('Location permission denied. Allow it in Settings.');
    }
    final pos = await Geolocator.getCurrentPosition();
    return (lat: pos.latitude, lng: pos.longitude);
  }
}
