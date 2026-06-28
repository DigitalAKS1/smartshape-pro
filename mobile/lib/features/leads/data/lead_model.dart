class LeadModel {
  LeadModel({
    required this.leadId,
    required this.companyName,
    required this.contactName,
    required this.contactPhone,
    required this.stage,
    required this.schoolName,
    this.schoolId,
  });

  final String leadId;
  final String companyName;
  final String contactName;
  final String contactPhone;
  final String stage;
  final String schoolName;
  final String? schoolId;

  factory LeadModel.fromJson(Map<String, dynamic> j) {
    final school = (j['school_name'] ?? '').toString();
    final company = (j['company_name'] ?? '').toString();
    return LeadModel(
      leadId: (j['lead_id'] ?? '').toString(),
      companyName: company.isNotEmpty ? company : school,
      contactName: (j['contact_name'] ?? '').toString(),
      contactPhone: (j['contact_phone'] ?? '').toString(),
      stage: (j['stage'] ?? '').toString(),
      schoolName: school,
      schoolId: j['school_id']?.toString(),
    );
  }
}
