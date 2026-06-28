import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';
import 'task_model.dart';

class TasksRepository {
  TasksRepository(this._api);
  final ApiClient _api;

  Future<List<TaskInstance>> myTasks({String status = 'pending'}) async {
    final r = await _api.dio.get(Endpoints.myInstances,
        queryParameters: {'status': status});
    final items = r.data is List ? r.data as List : const [];
    return items
        .map((e) => TaskInstance.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  Future<void> markDone(String instanceId, {String note = ''}) =>
      _api.dio.post(Endpoints.instanceComplete(instanceId), data: {'note': note});

  /// outcome: 'not_done' or 'partial'. expectedDate required when partial.
  Future<void> report(
    String instanceId, {
    required String outcome,
    required String note,
    String? expectedDate,
  }) =>
      _api.dio.post(Endpoints.instanceReport(instanceId), data: {
        'outcome': outcome,
        'note': note,
        if (expectedDate != null) 'expected_date': expectedDate,
      });
}
