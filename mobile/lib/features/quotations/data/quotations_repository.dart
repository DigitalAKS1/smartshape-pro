import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';

class QuoteLine {
  QuoteLine({required this.description, required this.qty, required this.rate, this.gstPct = 18});
  final String description;
  final double qty;
  final double rate;
  final double gstPct;

  double get subtotal => qty * rate;

  Map<String, dynamic> toJson() => {
        'description': description,
        'quantity': qty,
        'rate': rate,
        'gst_pct': gstPct,
        'line_subtotal': subtotal,
      };
}

class QuotationsRepository {
  QuotationsRepository(this._api);
  final ApiClient _api;

  /// Creates a quotation. The backend resolves the salesperson from the logged-in
  /// user and computes all totals from the line subtotals.
  Future<Map<String, dynamic>> create({
    required String schoolName,
    String principalName = '',
    String customerPhone = '',
    String customerEmail = '',
    required List<QuoteLine> lines,
    double discount1Pct = 0,
    double discount2Pct = 0,
    double freightAmount = 0,
  }) async {
    final r = await _api.dio.post(Endpoints.quotations, data: {
      'school_name': schoolName,
      'principal_name': principalName,
      'customer_phone': customerPhone,
      'customer_email': customerEmail,
      'lines': lines.map((l) => l.toJson()).toList(),
      'discount1_pct': discount1Pct,
      'discount2_pct': discount2Pct,
      'freight_amount': freightAmount,
    });
    return Map<String, dynamic>.from(r.data as Map);
  }
}
