import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/auth/auth_providers.dart';
import '../data/task_model.dart';
import '../data/tasks_repository.dart';

final tasksRepositoryProvider =
    Provider<TasksRepository>((ref) => TasksRepository(ref.read(apiClientProvider)));

final myTasksProvider = FutureProvider.autoDispose<List<TaskInstance>>(
    (ref) => ref.read(tasksRepositoryProvider).myTasks());
