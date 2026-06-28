import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/auth/auth_providers.dart';
import '../../../core/theme/app_theme.dart';
import '../application/dashboard_providers.dart';
import '../data/dashboard_repository.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
    final async = ref.watch(dashboardProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text('Hi, ${user?.name.split(' ').first ?? 'there'}'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Log out',
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(dashboardProvider),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: [
            const SizedBox(height: 120),
            Center(child: Text('Could not load dashboard.\n$e',
                textAlign: TextAlign.center)),
          ]),
          data: (s) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _AttendanceCard(summary: s),
              const SizedBox(height: 12),
              _TargetCard(progress: s.targetProgress),
              const SizedBox(height: 12),
              Row(children: [
                Expanded(
                  child: _MiniStat(
                    label: 'Needs attention',
                    value: '${s.needsAttentionCount}',
                    icon: Icons.priority_high,
                    onTap: () => context.go('/leads'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _MiniStat(
                    label: "Today's follow-ups",
                    value: '${s.todayFollowups.length}',
                    icon: Icons.event_available,
                  ),
                ),
              ]),
            ],
          ),
        ),
      ),
    );
  }
}

class _AttendanceCard extends StatelessWidget {
  const _AttendanceCard({required this.summary});
  final DashboardSummary summary;

  @override
  Widget build(BuildContext context) {
    final a = summary.attendanceToday;
    final checkedIn = a != null && a['check_in_time'] != null;
    final checkedOut = a != null && a['check_out_time'] != null;
    final status = !checkedIn
        ? 'Not checked in'
        : checkedOut
            ? 'Checked out'
            : 'Checked in (${a['work_type'] ?? ''})';
    return Card(
      child: ListTile(
        leading: Icon(checkedIn ? Icons.how_to_reg : Icons.login,
            color: AppTheme.navy),
        title: const Text('Attendance'),
        subtitle: Text(status),
        trailing: FilledButton(
          onPressed: () => GoRouter.of(context).go('/attendance'),
          child: Text(checkedIn ? 'Manage' : 'Check in'),
        ),
      ),
    );
  }
}

class _TargetCard extends StatelessWidget {
  const _TargetCard({required this.progress});
  final Map<String, dynamic> progress;

  @override
  Widget build(BuildContext context) {
    final achieved = (progress['achieved'] ?? progress['achieved_value'] ?? 0);
    final target = (progress['target'] ?? progress['target_value'] ?? 0);
    final t = (target is num && target > 0) ? target.toDouble() : 0.0;
    final a = (achieved is num) ? achieved.toDouble() : 0.0;
    final pct = t > 0 ? (a / t).clamp(0.0, 1.0) : 0.0;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Sales target',
                style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            LinearProgressIndicator(value: pct, minHeight: 10),
            const SizedBox(height: 8),
            Text('${_fmt(a)} of ${_fmt(t)} (${(pct * 100).toStringAsFixed(0)}%)'),
          ],
        ),
      ),
    );
  }

  String _fmt(double v) => v >= 1000 ? '${(v / 1000).toStringAsFixed(1)}k' : v.toStringAsFixed(0);
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({
    required this.label,
    required this.value,
    required this.icon,
    this.onTap,
  });
  final String label;
  final String value;
  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: AppTheme.accent),
              const SizedBox(height: 8),
              Text(value,
                  style: const TextStyle(
                      fontSize: 24, fontWeight: FontWeight.bold)),
              Text(label, style: const TextStyle(color: Colors.black54)),
            ],
          ),
        ),
      ),
    );
  }
}
