import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../features/dashboard/presentation/home_shell.dart';
import '../../features/leads/data/lead_model.dart';
import '../../features/leads/presentation/add_lead_screen.dart';
import '../../features/leads/presentation/lead_detail_screen.dart';
import '../../features/login/presentation/login_screen.dart';
import '../../features/tasks/presentation/reminders_screen.dart';
import '../../features/quotations/presentation/create_quotation_screen.dart';
import '../auth/auth_providers.dart';
import '../auth/auth_state.dart';

/// Pure redirect logic (unit-testable without a widget tree).
String? computeRedirect(AuthStatus status, String location) {
  if (status == AuthStatus.unknown) return null;
  final loggingIn = location == '/login';
  if (status == AuthStatus.unauthenticated) return loggingIn ? null : '/login';
  if (loggingIn) return '/dashboard';
  return null;
}

final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/dashboard',
    refreshListenable: _AuthListenable(ref),
    redirect: (context, state) => computeRedirect(
      ref.read(authControllerProvider).status,
      state.matchedLocation,
    ),
    routes: [
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/dashboard', builder: (_, __) => const HomeShell(tab: 0)),
      GoRoute(path: '/leads', builder: (_, __) => const HomeShell(tab: 1)),
      GoRoute(path: '/tasks', builder: (_, __) => const HomeShell(tab: 2)),
      GoRoute(path: '/attendance', builder: (_, __) => const HomeShell(tab: 3)),
      GoRoute(
          path: '/notifications', builder: (_, __) => const HomeShell(tab: 4)),
      GoRoute(path: '/reminders', builder: (_, __) => const RemindersScreen()),
      GoRoute(
          path: '/quotations/new',
          builder: (_, __) => const CreateQuotationScreen()),
      GoRoute(path: '/leads/add', builder: (_, __) => const AddLeadScreen()),
      GoRoute(
        path: '/leads/:id',
        builder: (_, state) => LeadDetailScreen(
          leadId: state.pathParameters['id']!,
          initial: state.extra is LeadModel ? state.extra as LeadModel : null,
        ),
      ),
    ],
  );
});

class _AuthListenable extends ChangeNotifier {
  _AuthListenable(Ref ref) {
    ref.listen(authControllerProvider, (_, __) => notifyListeners());
  }
}
