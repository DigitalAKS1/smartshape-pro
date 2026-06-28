import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';

class VisitRepository {
  VisitRepository(this._api);
  final ApiClient _api;

  /// Matches the backend FieldVisitCreate model.
  Future<Map<String, dynamic>> createVisit({
    required String schoolName,
    String? schoolId,
    required String contactPerson,
    required String contactPhone,
    required String visitDate,
    required String visitTime,
    String? purpose,
    double? lat,
    double? lng,
  }) async {
    final r = await _api.dio.post(Endpoints.visits, data: {
      'school_name': schoolName,
      'school_id': schoolId,
      'contact_person': contactPerson,
      'contact_phone': contactPhone,
      'visit_date': visitDate,
      'visit_time': visitTime,
      'purpose': purpose,
      'lat': lat,
      'lng': lng,
    });
    return Map<String, dynamic>.from(r.data as Map);
  }

  Future<List<dynamic>> listVisits() async {
    final r = await _api.dio.get(Endpoints.visits);
    return r.data is List ? r.data as List : const [];
  }
}
