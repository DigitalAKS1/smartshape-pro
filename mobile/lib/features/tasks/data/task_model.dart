class TaskInstance {
  TaskInstance({
    required this.instanceId,
    required this.title,
    required this.dueDate,
    required this.dueTime,
    required this.priority,
    required this.status,
    this.lastOutcome,
    this.delegatorName,
  });

  final String instanceId;
  final String title;
  final String dueDate;
  final String dueTime;
  final String priority;
  final String status;
  final String? lastOutcome;
  final String? delegatorName;

  factory TaskInstance.fromJson(Map<String, dynamic> j) => TaskInstance(
        instanceId: (j['instance_id'] ?? '').toString(),
        title: (j['task_title'] ?? j['title'] ?? 'Task').toString(),
        dueDate: (j['due_date'] ?? '').toString(),
        dueTime: (j['due_time'] ?? '').toString(),
        priority: (j['priority'] ?? '').toString(),
        status: (j['status'] ?? '').toString(),
        lastOutcome: j['last_outcome']?.toString(),
        delegatorName: j['delegator_name']?.toString(),
      );
}
