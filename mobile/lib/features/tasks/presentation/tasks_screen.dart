import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../application/tasks_providers.dart';
import '../data/task_model.dart';

class TasksScreen extends ConsumerWidget {
  const TasksScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(myTasksProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('My Tasks')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(myTasksProvider),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [
            const SizedBox(height: 120),
            Center(child: Text('Could not load tasks.\n$e', textAlign: TextAlign.center)),
          ]),
          data: (tasks) {
            if (tasks.isEmpty) {
              return ListView(children: const [
                SizedBox(height: 120),
                Center(child: Text('No pending tasks. 🎉')),
              ]);
            }
            return ListView.separated(
              itemCount: tasks.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (_, i) => _TaskTile(task: tasks[i]),
            );
          },
        ),
      ),
    );
  }
}

class _TaskTile extends ConsumerWidget {
  const _TaskTile({required this.task});
  final TaskInstance task;

  Color _priorityColor() {
    switch (task.priority) {
      case 'high':
        return Colors.red;
      case 'medium':
        return Colors.orange;
      default:
        return Colors.blueGrey;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListTile(
      leading: Icon(Icons.flag, color: _priorityColor()),
      title: Text(task.title),
      subtitle: Text([
        if (task.dueDate.isNotEmpty) 'Due ${task.dueDate}${task.dueTime.isNotEmpty ? ' ${task.dueTime}' : ''}',
        if (task.lastOutcome != null) 'Last: ${task.lastOutcome}',
      ].join(' · ')),
      trailing: FilledButton(
        onPressed: () => _openActions(context, ref),
        child: const Text('Update'),
      ),
    );
  }

  void _openActions(BuildContext context, WidgetRef ref) {
    showModalBottomSheet<void>(
      context: context,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(task.title,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
            ListTile(
              leading: const Icon(Icons.check_circle, color: Colors.green),
              title: const Text('Done'),
              onTap: () => _done(context, ref),
            ),
            ListTile(
              leading: const Icon(Icons.timelapse, color: Colors.orange),
              title: const Text('Partial — still working on it'),
              onTap: () => _partial(context, ref),
            ),
            ListTile(
              leading: const Icon(Icons.cancel, color: Colors.red),
              title: const Text("Not done"),
              onTap: () => _notDone(context, ref),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  void _snack(BuildContext context, String m) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  Future<void> _done(BuildContext context, WidgetRef ref) async {
    Navigator.pop(context);
    try {
      await ref.read(tasksRepositoryProvider).markDone(task.instanceId);
      ref.invalidate(myTasksProvider);
      if (context.mounted) _snack(context, 'Marked done ✅');
    } catch (e) {
      if (context.mounted) _snack(context, 'Failed: $e');
    }
  }

  Future<void> _notDone(BuildContext context, WidgetRef ref) async {
    Navigator.pop(context);
    final note = await _askNote(context, 'Why couldn\'t it be done?');
    if (note == null || note.isEmpty) return;
    try {
      await ref.read(tasksRepositoryProvider)
          .report(task.instanceId, outcome: 'not_done', note: note);
      ref.invalidate(myTasksProvider);
      if (context.mounted) _snack(context, 'Reported as not done');
    } catch (e) {
      if (context.mounted) _snack(context, 'Failed: $e');
    }
  }

  Future<void> _partial(BuildContext context, WidgetRef ref) async {
    Navigator.pop(context);
    final note = await _askNote(context, 'What progress did you make?');
    if (note == null || note.isEmpty) return;
    if (!context.mounted) return;
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
      initialDate: now.add(const Duration(days: 1)),
      helpText: 'Expected finish date',
    );
    if (picked == null) return;
    final expected =
        '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    try {
      await ref.read(tasksRepositoryProvider).report(task.instanceId,
          outcome: 'partial', note: note, expectedDate: expected);
      ref.invalidate(myTasksProvider);
      if (context.mounted) _snack(context, 'Partial update saved · finish by $expected');
    } catch (e) {
      if (context.mounted) _snack(context, 'Failed: $e');
    }
  }

  Future<String?> _askNote(BuildContext context, String hint) {
    final ctrl = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(hint),
        content: TextField(
          controller: ctrl,
          maxLines: 3,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'Add a note (required)'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
              child: const Text('Submit')),
        ],
      ),
    );
  }
}
