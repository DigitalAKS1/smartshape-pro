import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../attendance/presentation/attendance_screen.dart';
import '../../leads/presentation/leads_list_screen.dart';
import '../../notifications/presentation/notifications_screen.dart';
import 'dashboard_screen.dart';

/// Bottom-navigation shell. [tab] picks the active destination; tapping a
/// destination navigates to its route so deep links stay consistent.
class HomeShell extends ConsumerWidget {
  const HomeShell({super.key, required this.tab});
  final int tab;

  static const _routes = ['/dashboard', '/leads', '/attendance', '/notifications'];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final body = switch (tab) {
      1 => const LeadsListScreen(),
      2 => const AttendanceScreen(),
      3 => const NotificationsScreen(),
      _ => const DashboardScreen(),
    };
    return Scaffold(
      body: body,
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (i) => context.go(_routes[i]),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.people_outline), label: 'Leads'),
          NavigationDestination(icon: Icon(Icons.location_on_outlined), label: 'Attend'),
          NavigationDestination(
              icon: Icon(Icons.notifications_outlined), label: 'Alerts'),
        ],
      ),
    );
  }
}
