/// Backend endpoint paths, relative to [AppConfig.apiPrefix] (`.../api`).
class Endpoints {
  // Auth
  static const String login = '/auth/login';
  static const String refresh = '/auth/refresh';
  static const String logout = '/auth/logout';
  static const String me = '/auth/me';

  // Attendance / field
  static const String attendanceToday = '/sales/attendance/today';
  static const String attendanceCheckIn = '/sales/attendance/check-in';
  static const String attendanceCheckOut = '/sales/attendance/check-out';
  static const String visits = '/sales/visits';
  static const String targetsProgress = '/sales/targets/progress';

  // Leads / CRM
  static const String leads = '/leads';
  static const String leadsSearch = '/leads/search';
  static const String leadsNeedsAttention = '/leads/needs-attention';
  static const String followups = '/followups';
  static const String crmNotifications = '/crm/notifications';

  // Delegation / My Tasks (Phase 2)
  static const String myInstances = '/delegation/my-instances';
  static const String reminders = '/delegation/reminders';
  static String instanceComplete(String id) => '/delegation/instances/$id/complete';
  static String instanceReport(String id) => '/delegation/instances/$id/report';
  static String reminder(String id) => '/delegation/reminders/$id';

  // Quotations (Phase 2)
  static const String quotations = '/quotations';

  // Push (mobile FCM)
  static const String fcmRegister = '/push/fcm/register';
  static const String fcmUnregister = '/push/fcm/unregister';

  static String lead(String id) => '/leads/$id';
  static String leadNotes(String id) => '/leads/$id/notes';
  static String crmNotifRead(String id) => '/crm/notifications/$id/read';
  static String crmNotifReadAll() => '/crm/notifications/read-all';
}
