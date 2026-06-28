import '../../features/login/data/user_model.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  const AuthState({
    this.status = AuthStatus.unknown,
    this.user,
    this.errorMessage,
    this.errorCode,
    this.busy = false,
  });

  final AuthStatus status;
  final UserModel? user;
  final String? errorMessage;
  final String? errorCode;
  final bool busy;

  AuthState copyWith({
    AuthStatus? status,
    UserModel? user,
    String? errorMessage,
    String? errorCode,
    bool? busy,
  }) =>
      AuthState(
        status: status ?? this.status,
        user: user ?? this.user,
        errorMessage: errorMessage,
        errorCode: errorCode,
        busy: busy ?? this.busy,
      );
}
