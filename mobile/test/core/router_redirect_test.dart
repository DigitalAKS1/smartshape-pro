import 'package:flutter_test/flutter_test.dart';
import 'package:smartshape_sales/core/auth/auth_state.dart';
import 'package:smartshape_sales/core/router/app_router.dart';

void main() {
  test('unauthenticated is sent to /login', () {
    expect(computeRedirect(AuthStatus.unauthenticated, '/dashboard'), '/login');
  });

  test('unauthenticated already on /login stays', () {
    expect(computeRedirect(AuthStatus.unauthenticated, '/login'), isNull);
  });

  test('authenticated is sent away from /login', () {
    expect(computeRedirect(AuthStatus.authenticated, '/login'), '/dashboard');
  });

  test('authenticated on a valid route is left alone', () {
    expect(computeRedirect(AuthStatus.authenticated, '/leads'), isNull);
  });

  test('unknown status never redirects (waiting for bootstrap)', () {
    expect(computeRedirect(AuthStatus.unknown, '/dashboard'), isNull);
  });
}
