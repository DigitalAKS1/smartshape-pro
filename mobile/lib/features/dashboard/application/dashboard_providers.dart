import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/auth/auth_providers.dart';
import '../data/dashboard_repository.dart';

final dashboardRepositoryProvider =
    Provider<DashboardRepository>((ref) => DashboardRepository(ref.read(apiClientProvider)));

final dashboardProvider = FutureProvider.autoDispose<DashboardSummary>(
    (ref) => ref.read(dashboardRepositoryProvider).load());
