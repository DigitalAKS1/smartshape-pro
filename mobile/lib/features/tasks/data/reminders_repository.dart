import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';

class RemindersRepository {
  RemindersRepository(this._api);
  final ApiClient _api;

  Future<List<dynamic>> list() async {
    final r = await _api.dio.get(Endpoints.reminders);
    final data = r.data;
    if (data is Map && data['reminders'] is List) return data['reminders'] as List;
    if (data is List) return data;
    return const [];
  }

  Future<void> markDone(String id) =>
      _api.dio.patch(Endpoints.reminder(id), data: {'status': 'done'});
}
