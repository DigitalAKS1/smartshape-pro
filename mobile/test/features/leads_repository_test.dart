import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartshape_sales/core/api/api_client.dart';
import 'package:smartshape_sales/features/leads/data/leads_repository.dart';

import '../helpers/mem_token_store.dart';
import '../helpers/stub_adapter.dart';

LeadsRepository _repo(StubAdapter adapter) {
  final dio = Dio(BaseOptions(baseUrl: 'http://test/api'));
  dio.httpClientAdapter = adapter;
  return LeadsRepository(ApiClient(MemTokenStore(access: 't'), dio: dio));
}

void main() {
  test('list() parses leads and falls back company<-school', () async {
    final repo = _repo(StubAdapter((o) {
      if (o.path.endsWith('/leads')) {
        return (200, [
          {'lead_id': 'l1', 'company_name': 'ABC School', 'contact_phone': '900'},
          {'lead_id': 'l2', 'school_name': 'XYZ School'},
        ]);
      }
      return (404, {});
    }));
    final leads = await repo.list();
    expect(leads.length, 2);
    expect(leads[0].companyName, 'ABC School');
    expect(leads[0].contactPhone, '900');
    expect(leads[1].companyName, 'XYZ School'); // fell back to school_name
  });

  test('search() reads the {leads:[...]} envelope', () async {
    final repo = _repo(StubAdapter((o) {
      if (o.path.contains('/leads/search')) {
        return (200, {
          'leads': [
            {'lead_id': 'l1', 'school_name': 'ABC'}
          ]
        });
      }
      return (404, {});
    }));
    final res = await repo.search('ab');
    expect(res.single.companyName, 'ABC');
  });

  test('create() posts contact fields and returns lead_id', () async {
    String? sentName;
    final repo = _repo(StubAdapter((o) {
      if (o.method == 'POST' && o.path.endsWith('/leads')) {
        sentName = bodyAsMap(o)['contact_name'] as String?;
        return (200, {'lead_id': 'l9'});
      }
      return (404, {});
    }));
    final id = await repo.create(contactName: 'Asha', contactPhone: '900');
    expect(id, 'l9');
    expect(sentName, 'Asha');
  });
}
