import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartshape_sales/core/api/api_client.dart';
import 'package:smartshape_sales/features/quotations/data/quotations_repository.dart';

import '../helpers/mem_token_store.dart';
import '../helpers/stub_adapter.dart';

void main() {
  test('create posts lines with computed line_subtotal and returns quote', () async {
    Map<String, dynamic>? body;
    final dio = Dio(BaseOptions(baseUrl: 'http://test/api'));
    dio.httpClientAdapter = StubAdapter((o) {
      if (o.method == 'POST' && o.path.endsWith('/quotations')) {
        body = bodyAsMap(o);
        return (200, {'quotation_id': 'quot_1', 'quote_number': 'Q-100'});
      }
      return (404, {});
    });
    final repo = QuotationsRepository(ApiClient(MemTokenStore(access: 't'), dio: dio));

    final res = await repo.create(
      schoolName: 'ABC School',
      lines: [QuoteLine(description: 'Item A', qty: 2, rate: 50)],
    );

    expect(res['quote_number'], 'Q-100');
    final lines = body!['lines'] as List;
    expect(lines.first['line_subtotal'], 100); // 2 * 50
    expect(body!['school_name'], 'ABC School');
  });
}
