import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartshape_sales/core/api/api_client.dart';
import 'package:smartshape_sales/features/tasks/data/tasks_repository.dart';

import '../helpers/mem_token_store.dart';
import '../helpers/stub_adapter.dart';

TasksRepository _repo(StubAdapter a) {
  final dio = Dio(BaseOptions(baseUrl: 'http://test/api'));
  dio.httpClientAdapter = a;
  return TasksRepository(ApiClient(MemTokenStore(access: 't'), dio: dio));
}

void main() {
  test('myTasks parses instances', () async {
    final repo = _repo(StubAdapter((o) {
      if (o.path.endsWith('/delegation/my-instances')) {
        return (200, [
          {'instance_id': 'i1', 'task_title': 'Call school', 'due_date': '2026-07-01', 'priority': 'high', 'status': 'pending'}
        ]);
      }
      return (404, {});
    }));
    final tasks = await repo.myTasks();
    expect(tasks.single.title, 'Call school');
    expect(tasks.single.priority, 'high');
  });

  test('markDone posts to complete', () async {
    var hit = false;
    final repo = _repo(StubAdapter((o) {
      if (o.path.endsWith('/delegation/instances/i1/complete')) {
        hit = true;
        return (200, {'status': 'completed'});
      }
      return (404, {});
    }));
    await repo.markDone('i1', note: 'ok');
    expect(hit, true);
  });

  test('report partial sends outcome + expected_date', () async {
    Map<String, dynamic>? body;
    final repo = _repo(StubAdapter((o) {
      if (o.path.endsWith('/delegation/instances/i1/report')) {
        body = bodyAsMap(o);
        return (200, {});
      }
      return (404, {});
    }));
    await repo.report('i1', outcome: 'partial', note: 'half done', expectedDate: '2026-07-05');
    expect(body!['outcome'], 'partial');
    expect(body!['expected_date'], '2026-07-05');
  });
}
