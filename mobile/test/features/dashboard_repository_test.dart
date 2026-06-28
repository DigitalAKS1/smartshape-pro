import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartshape_sales/core/api/api_client.dart';
import 'package:smartshape_sales/features/dashboard/data/dashboard_repository.dart';

import '../helpers/mem_token_store.dart';
import '../helpers/stub_adapter.dart';

void main() {
  test('load() combines the four endpoints and tolerates null attendance', () async {
    final dio = Dio(BaseOptions(baseUrl: 'http://test/api'));
    dio.httpClientAdapter = StubAdapter((o) {
      if (o.path.endsWith('/sales/attendance/today')) return (200, null);
      if (o.path.endsWith('/sales/targets/progress')) {
        return (200, {'achieved': 3, 'target': 10});
      }
      if (o.path.endsWith('/leads/needs-attention')) {
        return (200, [
          {'lead_id': 'a'},
          {'lead_id': 'b'}
        ]);
      }
      if (o.path.endsWith('/followups')) {
        return (200, [
          {'followup_id': 'f1'}
        ]);
      }
      return (404, {});
    });

    final repo = DashboardRepository(ApiClient(MemTokenStore(access: 't'), dio: dio));
    final s = await repo.load();

    expect(s.attendanceToday, isNull);
    expect(s.needsAttentionCount, 2);
    expect(s.todayFollowups.length, 1);
    expect(s.targetProgress['achieved'], 3);
  });
}
