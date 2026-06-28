class UserModel {
  UserModel({
    required this.email,
    required this.name,
    required this.role,
    required this.assignedModules,
  });

  final String email;
  final String name;
  final String role;
  final List<String> assignedModules;

  factory UserModel.fromJson(Map<String, dynamic> j) => UserModel(
        email: (j['email'] ?? '').toString(),
        name: (j['name'] ?? '').toString(),
        role: (j['role'] ?? '').toString(),
        assignedModules:
            (j['assigned_modules'] as List?)?.map((e) => '$e').toList() ?? const [],
      );

  bool hasModule(String m) => assignedModules.contains(m) || role == 'admin';
}
