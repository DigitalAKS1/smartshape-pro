import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';

class NotificationsRepository {
  NotificationsRepository(this._api);
  final ApiClient _api;

  Future<List<dynamic>> list() async {
    final r = await _api.dio.get(Endpoints.crmNotifications);
    return r.data is List ? r.data as List : const [];
  }

  Future<void> markRead(String id) => _api.dio.post(Endpoints.crmNotifRead(id));

  Future<void> markAllRead() => _api.dio.post(Endpoints.crmNotifReadAll());
}
