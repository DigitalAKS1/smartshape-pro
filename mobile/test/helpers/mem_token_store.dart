import 'package:smartshape_sales/core/auth/token_store.dart';

/// In-memory [TokenStore] for tests.
class MemTokenStore implements TokenStore {
  MemTokenStore({String? access, String? refresh})
      : _a = access,
        _r = refresh;
  String? _a;
  String? _r;

  @override
  Future<String?> get accessToken async => _a;
  @override
  Future<String?> get refreshToken async => _r;
  @override
  Future<void> save({required String access, required String refresh}) async {
    _a = access;
    _r = refresh;
  }

  @override
  Future<void> clear() async {
    _a = null;
    _r = null;
  }
}
