import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';

class DashboardSummary {
  DashboardSummary({
    this.attendanceToday,
    required this.targetProgress,
    required this.needsAttentionCount,
    required this.todayFollowups,
  });

  final Map<String, dynamic>? attendanceToday;
  final Map<String, dynamic> targetProgress;
  final int needsAttentionCount;
  final List<dynamic> todayFollowups;
}

class DashboardRepository {
  DashboardRepository(this._api);
  final ApiClient _api;

  Future<DashboardSummary> load() async {
    final results = await Future.wait([
      _safeGet(Endpoints.attendanceToday),
      _safeGet(Endpoints.targetsProgress),
      _safeGet(Endpoints.leadsNeedsAttention),
      _safeGet(Endpoints.followups),
    ]);
    return DashboardSummary(
      attendanceToday: results[0] is Map
          ? Map<String, dynamic>.from(results[0] as Map)
          : null,
      targetProgress: results[1] is Map
          ? Map<String, dynamic>.from(results[1] as Map)
          : <String, dynamic>{},
      needsAttentionCount: results[2] is List ? (results[2] as List).length : 0,
      todayFollowups: results[3] is List ? results[3] as List : const [],
    );
  }

  /// One failing widget should not blank the whole dashboard.
  Future<dynamic> _safeGet(String path) async {
    try {
      final r = await _api.dio.get(path);
      return r.data;
    } catch (_) {
      return null;
    }
  }
}
