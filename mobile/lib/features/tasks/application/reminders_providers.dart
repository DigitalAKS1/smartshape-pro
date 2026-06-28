import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/auth/auth_providers.dart';
import '../data/reminders_repository.dart';

final remindersRepositoryProvider = Provider<RemindersRepository>(
    (ref) => RemindersRepository(ref.read(apiClientProvider)));

final remindersProvider = FutureProvider.autoDispose<List<dynamic>>(
    (ref) => ref.read(remindersRepositoryProvider).list());
