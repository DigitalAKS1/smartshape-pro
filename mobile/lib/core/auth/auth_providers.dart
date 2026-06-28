import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_client.dart';
import '../error/api_failure.dart';
import '../push/push_providers.dart';
import '../../features/login/data/auth_repository.dart';
import 'auth_state.dart';
import 'device_identity.dart';
import 'token_store.dart';

final secureStorageProvider =
    Provider<FlutterSecureStorage>((_) => const FlutterSecureStorage());

final tokenStoreProvider =
    Provider<TokenStore>((ref) => TokenStore(ref.read(secureStorageProvider)));

final deviceIdentityProvider =
    Provider<DeviceIdentity>((ref) => DeviceIdentity(ref.read(secureStorageProvider)));

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    ref.read(tokenStoreProvider),
    onSessionExpired: () =>
        ref.read(authControllerProvider.notifier).onSessionExpired(),
  );
});

final authRepositoryProvider = Provider<AuthRepository>((ref) => AuthRepository(
      ref.read(apiClientProvider),
      ref.read(tokenStoreProvider),
      ref.read(deviceIdentityProvider),
    ));

final authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>((ref) => AuthController(ref));

class AuthController extends StateNotifier<AuthState> {
  AuthController(this._ref) : super(const AuthState());

  final Ref _ref;
  AuthRepository get _repo => _ref.read(authRepositoryProvider);

  /// Called once at startup to resolve the persisted session.
  Future<void> bootstrap() async {
    final user = await _repo.currentUser();
    state = AuthState(
      status: user == null ? AuthStatus.unauthenticated : AuthStatus.authenticated,
      user: user,
    );
    if (user != null) {
      unawaited(_registerPush());
    }
  }

  Future<bool> login(String email, String password) async {
    state = state.copyWith(busy: true, errorMessage: null, errorCode: null);
    try {
      final user = await _repo.login(email, password);
      state = AuthState(status: AuthStatus.authenticated, user: user);
      unawaited(_registerPush());
      return true;
    } on ApiFailure catch (f) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: f.message,
        errorCode: f.code,
      );
      return false;
    } catch (e) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: 'Something went wrong. Please try again.',
      );
      return false;
    }
  }

  Future<void> logout() async {
    try {
      await _ref.read(pushServiceProvider).unregisterToken();
    } catch (_) {}
    await _repo.logout();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  void onSessionExpired() {
    state = const AuthState(
      status: AuthStatus.unauthenticated,
      errorMessage: 'Your session has expired. Please log in again.',
    );
  }

  Future<void> _registerPush() async {
    try {
      final push = _ref.read(pushServiceProvider);
      await push.init();
      await push.registerToken();
    } catch (_) {/* push is best-effort; never block auth */}
  }
}
