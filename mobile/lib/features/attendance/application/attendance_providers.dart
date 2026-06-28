import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/auth/auth_providers.dart';
import '../../../core/location/location_service.dart';
import '../data/attendance_repository.dart';
import '../data/visit_repository.dart';

final locationServiceProvider = Provider<LocationService>((_) => LocationService());

final attendanceRepositoryProvider = Provider<AttendanceRepository>(
    (ref) => AttendanceRepository(ref.read(apiClientProvider)));

final visitRepositoryProvider =
    Provider<VisitRepository>((ref) => VisitRepository(ref.read(apiClientProvider)));

final todayAttendanceProvider = FutureProvider.autoDispose<Map<String, dynamic>?>(
    (ref) => ref.read(attendanceRepositoryProvider).today());
