import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/auth/auth_providers.dart';
import '../data/notifications_repository.dart';

final notificationsRepositoryProvider = Provider<NotificationsRepository>(
    (ref) => NotificationsRepository(ref.read(apiClientProvider)));

final notificationsProvider = FutureProvider.autoDispose<List<dynamic>>(
    (ref) => ref.read(notificationsRepositoryProvider).list());
