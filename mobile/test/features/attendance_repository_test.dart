import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartshape_sales/core/api/api_client.dart';
import 'package:smartshape_sales/features/attendance/data/attendance_repository.dart';

import '../helpers/mem_token_store.dart';
import '../helpers/stub_adapter.dart';

AttendanceRepository _repo(StubAdapter a) {
  final dio = Dio(BaseOptions(baseUrl: 'http://test/api'));
  dio.httpClientAdapter = a;
  return AttendanceRepository(ApiClient(MemTokenStore(access: 't'), dio: dio));
}

void main() {
  test('checkIn posts work_type + GPS in the body', () async {
    Map<String, dynamic>? sent;
    final repo = _repo(StubAdapter((o) {
      if (o.path.endsWith('/sales/attendance/check-in')) {
        sent = bodyAsMap(o);
        return (200, {'attendance_id': 'att_1'});
      }
      return (404, {});
    }));
    final res = await repo.checkIn(workType: 'field', lat: 12.9, lng: 77.6);
    expect(res['attendance_id'], 'att_1');
    expect(sent!['work_type'], 'field');
    expect(sent!['lat'], 12.9);
  });

  test('checkOut sends lat/lng as query params', () async {
    Map<String, dynamic>? query;
    final repo = _repo(StubAdapter((o) {
      if (o.path.endsWith('/sales/attendance/check-out')) {
        query = Map<String, dynamic>.from(o.queryParameters);
        return (200, {'message': 'Checked out successfully'});
      }
      return (404, {});
    }));
    await repo.checkOut(lat: 12.9, lng: 77.6);
    expect(query!['lat'], 12.9);
    expect(query!['lng'], 77.6);
  });
}
