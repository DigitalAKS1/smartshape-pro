import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../application/reminders_providers.dart';

class RemindersScreen extends ConsumerWidget {
  const RemindersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(remindersProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Reminders')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(remindersProvider),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [
            const SizedBox(height: 120),
            Center(child: Text('Could not load reminders.\n$e', textAlign: TextAlign.center)),
          ]),
          data: (items) {
            if (items.isEmpty) {
              return ListView(children: const [
                SizedBox(height: 120),
                Center(child: Text('No active reminders.')),
              ]);
            }
            return ListView.separated(
              itemCount: items.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (_, i) {
                final m = Map<String, dynamic>.from(items[i] as Map);
                final id = (m['reminder_id'] ?? '').toString();
                final due = (m['next_occurrence'] ?? m['due_date'] ?? '').toString();
                final time = (m['due_time'] ?? '').toString();
                return ListTile(
                  leading: const Icon(Icons.alarm),
                  title: Text('${m['title'] ?? m['text'] ?? 'Reminder'}'),
                  subtitle: due.isEmpty ? null : Text('Due $due${time.isNotEmpty ? ' $time' : ''}'),
                  trailing: IconButton(
                    icon: const Icon(Icons.check_circle_outline),
                    tooltip: 'Mark done',
                    onPressed: id.isEmpty
                        ? null
                        : () async {
                            try {
                              await ref.read(remindersRepositoryProvider).markDone(id);
                              ref.invalidate(remindersProvider);
                            } catch (_) {}
                          },
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
