import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../application/notifications_providers.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(notificationsProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          IconButton(
            icon: const Icon(Icons.done_all),
            tooltip: 'Mark all read',
            onPressed: () async {
              await ref.read(notificationsRepositoryProvider).markAllRead();
              ref.invalidate(notificationsProvider);
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(notificationsProvider),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [
            const SizedBox(height: 120),
            Center(child: Text('Could not load notifications.\n$e',
                textAlign: TextAlign.center)),
          ]),
          data: (items) {
            if (items.isEmpty) {
              return ListView(children: const [
                SizedBox(height: 120),
                Center(child: Text("You're all caught up.")),
              ]);
            }
            return ListView.separated(
              itemCount: items.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (_, i) {
                final m = Map<String, dynamic>.from(items[i] as Map);
                final isRead = m['is_read'] == true;
                final id = (m['notif_id'] ?? m['id'] ?? '').toString();
                return ListTile(
                  leading: Icon(
                    isRead ? Icons.notifications_none : Icons.notifications_active,
                    color: isRead ? Colors.grey : null,
                  ),
                  title: Text('${m['title'] ?? m['message'] ?? 'Notification'}',
                      style: TextStyle(
                          fontWeight:
                              isRead ? FontWeight.normal : FontWeight.bold)),
                  subtitle: m['body'] != null ? Text('${m['body']}') : null,
                  onTap: id.isEmpty
                      ? null
                      : () async {
                          await ref
                              .read(notificationsRepositoryProvider)
                              .markRead(id);
                          ref.invalidate(notificationsProvider);
                        },
                );
              },
            );
          },
        ),
      ),
    );
  }
}
