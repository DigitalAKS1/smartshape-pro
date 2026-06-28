import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/api_failure.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../application/attendance_providers.dart';
import 'field_visit_sheet.dart';

class AttendanceScreen extends ConsumerStatefulWidget {
  const AttendanceScreen({super.key});

  @override
  ConsumerState<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends ConsumerState<AttendanceScreen> {
  bool _busy = false;

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _refresh() async {
    ref.invalidate(todayAttendanceProvider);
    ref.invalidate(dashboardProvider);
  }

  Future<void> _checkIn(String workType) async {
    setState(() => _busy = true);
    try {
      double? lat, lng;
      if (workType != 'wfh') {
        final pos = await ref.read(locationServiceProvider).current();
        lat = pos.lat;
        lng = pos.lng;
      }
      final res = await ref
          .read(attendanceRepositoryProvider)
          .checkIn(workType: workType, lat: lat, lng: lng);
      _snack(res['geofence_warning']?.toString() ?? 'Checked in ($workType).');
      await _refresh();
    } on ApiFailure catch (f) {
      _snack(f.message);
    } catch (e) {
      _snack('Check-in failed: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _checkOut() async {
    setState(() => _busy = true);
    try {
      final pos = await ref.read(locationServiceProvider).current();
      await ref
          .read(attendanceRepositoryProvider)
          .checkOut(lat: pos.lat, lng: pos.lng);
      _snack('Checked out.');
      await _refresh();
    } on ApiFailure catch (f) {
      _snack(f.message);
    } catch (e) {
      _snack('Check-out failed: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final today = ref.watch(todayAttendanceProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Attendance')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            today.when(
              loading: () => const LinearProgressIndicator(),
              error: (e, _) => Text('Could not load today: $e'),
              data: (a) => _StatusCard(today: a),
            ),
            const SizedBox(height: 16),
            if (_busy) const Center(child: Padding(
              padding: EdgeInsets.all(8), child: CircularProgressIndicator())),
            today.maybeWhen(
              data: (a) {
                final checkedIn = a != null && a['check_in_time'] != null;
                final checkedOut = a != null && a['check_out_time'] != null;
                if (!checkedIn) {
                  return Column(children: [
                    _BigButton(
                      icon: Icons.business,
                      label: 'Check in — Office',
                      onPressed: _busy ? null : () => _checkIn('office'),
                    ),
                    _BigButton(
                      icon: Icons.directions_car,
                      label: 'Check in — Field',
                      onPressed: _busy ? null : () => _checkIn('field'),
                    ),
                    _BigButton(
                      icon: Icons.home_work,
                      label: 'Check in — WFH',
                      onPressed: _busy ? null : () => _checkIn('wfh'),
                    ),
                  ]);
                }
                if (!checkedOut) {
                  return _BigButton(
                    icon: Icons.logout,
                    label: 'Check out',
                    onPressed: _busy ? null : _checkOut,
                  );
                }
                return const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Text('You have completed attendance for today.'),
                );
              },
              orElse: () => const SizedBox.shrink(),
            ),
            const Divider(height: 32),
            _BigButton(
              icon: Icons.add_location_alt,
              label: 'Log a field visit',
              onPressed: _busy
                  ? null
                  : () => showModalBottomSheet<void>(
                        context: context,
                        isScrollControlled: true,
                        builder: (_) => const FieldVisitSheet(),
                      ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({this.today});
  final Map<String, dynamic>? today;

  @override
  Widget build(BuildContext context) {
    final a = today;
    final checkedIn = a != null && a['check_in_time'] != null;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text("Today's status",
                style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text(checkedIn
                ? 'Checked in (${a['work_type'] ?? ''}) at ${_t(a['check_in_time'])}'
                : 'Not checked in yet'),
            if (a != null && a['check_out_time'] != null)
              Text('Checked out at ${_t(a['check_out_time'])}'),
            if (a != null && a['check_in_address'] != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('${a['check_in_address']}',
                    style: const TextStyle(color: Colors.black54, fontSize: 12)),
              ),
          ],
        ),
      ),
    );
  }

  String _t(dynamic iso) {
    if (iso == null) return '';
    final d = DateTime.tryParse('$iso')?.toLocal();
    if (d == null) return '';
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }
}

class _BigButton extends StatelessWidget {
  const _BigButton({required this.icon, required this.label, this.onPressed});
  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: SizedBox(
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: onPressed,
          icon: Icon(icon),
          label: Text(label),
        ),
      ),
    );
  }
}
