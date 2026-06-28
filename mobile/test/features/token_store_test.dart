import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mocktail/mocktail.dart';
import 'package:smartshape_sales/core/auth/token_store.dart';

class _FakeStorage extends Mock implements FlutterSecureStorage {}

void main() {
  late _FakeStorage storage;
  late TokenStore store;
  final mem = <String, String>{};

  setUp(() {
    storage = _FakeStorage();
    mem.clear();
    when(() => storage.write(
            key: any(named: 'key'), value: any(named: 'value')))
        .thenAnswer((i) async =>
            mem[i.namedArguments[#key] as String] =
                i.namedArguments[#value] as String);
    when(() => storage.read(key: any(named: 'key')))
        .thenAnswer((i) async => mem[i.namedArguments[#key] as String]);
    when(() => storage.delete(key: any(named: 'key')))
        .thenAnswer((i) async => mem.remove(i.namedArguments[#key] as String));
    store = TokenStore(storage);
  });

  test('saves and reads tokens', () async {
    await store.save(access: 'a1', refresh: 'r1');
    expect(await store.accessToken, 'a1');
    expect(await store.refreshToken, 'r1');
  });

  test('clear removes tokens', () async {
    await store.save(access: 'a1', refresh: 'r1');
    await store.clear();
    expect(await store.accessToken, isNull);
    expect(await store.refreshToken, isNull);
  });
}
