import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';

class AttendanceRepository {
  AttendanceRepository(this._api);
  final ApiClient _api;

  /// work_type: 'office' | 'field' | 'wfh'. Field/office send GPS; wfh may be null.
  Future<Map<String, dynamic>> checkIn({
    required String workType,
    double? lat,
    double? lng,
  }) async {
    final r = await _api.dio.post(Endpoints.attendanceCheckIn, data: {
      'work_type': workType,
      'lat': lat,
      'lng': lng,
    });
    return Map<String, dynamic>.from(r.data as Map);
  }

  /// Backend reads lat/lng from query parameters (not the body).
  Future<void> checkOut({required double lat, required double lng}) async {
    await _api.dio.post(
      Endpoints.attendanceCheckOut,
      queryParameters: {'lat': lat, 'lng': lng},
    );
  }

  Future<Map<String, dynamic>?> today() async {
    final r = await _api.dio.get(Endpoints.attendanceToday);
    return r.data is Map ? Map<String, dynamic>.from(r.data as Map) : null;
  }
}
