import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';
import 'lead_model.dart';

class LeadsRepository {
  LeadsRepository(this._api);
  final ApiClient _api;

  Future<List<LeadModel>> list() async {
    final r = await _api.dio.get(Endpoints.leads);
    final items = r.data is List ? r.data as List : const [];
    return items
        .map((e) => LeadModel.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  Future<List<LeadModel>> search(String q) async {
    final r = await _api.dio.get(Endpoints.leadsSearch, queryParameters: {'q': q});
    final items =
        (r.data is Map ? (r.data['leads'] as List?) : null) ?? const [];
    return items
        .map((e) => LeadModel.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  Future<String> create({
    required String contactName,
    required String contactPhone,
    String? schoolId,
    Map<String, dynamic>? newSchool,
  }) async {
    final body = <String, dynamic>{
      'contact_name': contactName,
      'contact_phone': contactPhone,
    };
    if (schoolId != null) body['school_id'] = schoolId;
    if (newSchool != null) body['new_school'] = newSchool;
    final r = await _api.dio.post(Endpoints.leads, data: body);
    return (r.data as Map)['lead_id'].toString();
  }

  Future<void> updateStage(String leadId, String stage) =>
      _api.dio.put(Endpoints.lead(leadId), data: {'stage': stage});

  Future<List<dynamic>> notes(String leadId) async {
    final r = await _api.dio.get(Endpoints.leadNotes(leadId));
    return r.data is List ? r.data as List : const [];
  }

  Future<void> addNote(String leadId, String content,
          {String type = 'call', String outcome = ''}) =>
      _api.dio.post(Endpoints.leadNotes(leadId),
          data: {'type': type, 'content': content, 'outcome': outcome});

  Future<void> addFollowup({
    required String leadId,
    required String date,
    String time = '',
    String type = 'call',
    String notes = '',
  }) =>
      _api.dio.post(Endpoints.followups, data: {
        'lead_id': leadId,
        'followup_date': date,
        'followup_time': time,
        'followup_type': type,
        'notes': notes,
      });
}
