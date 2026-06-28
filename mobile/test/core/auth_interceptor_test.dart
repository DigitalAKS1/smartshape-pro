import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartshape_sales/core/api/api_client.dart';
import 'package:smartshape_sales/core/api/endpoints.dart';

import '../helpers/mem_token_store.dart';
import '../helpers/stub_adapter.dart';

void main() {
  test('attaches bearer token and refreshes + retries on 401', () async {
    final store = MemTokenStore(access: 'old-access', refresh: 'refresh-1');
    var protectedCalls = 0;

    final dio = Dio(BaseOptions(baseUrl: 'http://test/api'));
    dio.httpClientAdapter = StubAdapter((o) {
      if (o.path.contains(Endpoints.refresh)) {
        return (200, {'access_token': 'new-access', 'refresh_token': 'refresh-2'});
      }
      if (o.path.endsWith('/protected')) {
        protectedCalls++;
        return o.headers['Authorization'] == 'Bearer old-access'
            ? (401, {'detail': 'Token expired'})
            : (200, {'ok': true});
      }
      return (404, {});
    });

    final client = ApiClient(store, dio: dio);
    final res = await client.dio.get('/protected');

    expect(res.statusCode, 200);
    expect(await store.accessToken, 'new-access');
    expect(protectedCalls, 2); // first 401, then retry succeeds
  });

  test('clears tokens and surfaces SessionExpired when refresh fails', () async {
    final store = MemTokenStore(access: 'old-access', refresh: 'refresh-1');
    final dio = Dio(BaseOptions(baseUrl: 'http://test/api'));
    dio.httpClientAdapter = StubAdapter((o) {
      if (o.path.contains(Endpoints.refresh)) return (401, {'detail': 'expired'});
      return (401, {'detail': 'Token expired'});
    });

    final client = ApiClient(store, dio: dio);
    await expectLater(client.dio.get('/protected'), throwsA(isA<DioException>()));
    expect(await store.accessToken, isNull);
  });
}
