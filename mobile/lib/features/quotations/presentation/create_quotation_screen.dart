import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../application/quotations_providers.dart';
import '../data/quotations_repository.dart';

class _LineCtrl {
  final desc = TextEditingController();
  final qty = TextEditingController(text: '1');
  final rate = TextEditingController();
  void dispose() {
    desc.dispose();
    qty.dispose();
    rate.dispose();
  }
}

class CreateQuotationScreen extends ConsumerStatefulWidget {
  const CreateQuotationScreen({super.key});

  @override
  ConsumerState<CreateQuotationScreen> createState() => _CreateQuotationScreenState();
}

class _CreateQuotationScreenState extends ConsumerState<CreateQuotationScreen> {
  final _formKey = GlobalKey<FormState>();
  final _school = TextEditingController();
  final _principal = TextEditingController();
  final _phone = TextEditingController();
  final _lines = <_LineCtrl>[_LineCtrl()];
  bool _busy = false;

  @override
  void dispose() {
    _school.dispose();
    _principal.dispose();
    _phone.dispose();
    for (final l in _lines) {
      l.dispose();
    }
    super.dispose();
  }

  double get _grandApprox {
    double t = 0;
    for (final l in _lines) {
      final q = double.tryParse(l.qty.text) ?? 0;
      final r = double.tryParse(l.rate.text) ?? 0;
      t += q * r;
    }
    return t;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final lines = <QuoteLine>[];
    for (final l in _lines) {
      final desc = l.desc.text.trim();
      final q = double.tryParse(l.qty.text) ?? 0;
      final r = double.tryParse(l.rate.text) ?? 0;
      if (desc.isEmpty || q <= 0) continue;
      lines.add(QuoteLine(description: desc, qty: q, rate: r));
    }
    if (lines.isEmpty) {
      _snack('Add at least one item with a description and quantity.');
      return;
    }
    setState(() => _busy = true);
    try {
      final res = await ref.read(quotationsRepositoryProvider).create(
            schoolName: _school.text.trim(),
            principalName: _principal.text.trim(),
            customerPhone: _phone.text.trim(),
            lines: lines,
          );
      if (mounted) {
        Navigator.of(context).pop(true);
        _snack('Quotation ${res['quote_number'] ?? ''} created');
      }
    } catch (e) {
      _snack('Could not create quotation: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _snack(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New Quotation')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _school,
              decoration: const InputDecoration(labelText: 'School / company name'),
              validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _principal,
              decoration: const InputDecoration(labelText: 'Principal / contact (optional)'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Phone (optional)'),
            ),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Items', style: TextStyle(fontWeight: FontWeight.bold)),
                TextButton.icon(
                  onPressed: () => setState(() => _lines.add(_LineCtrl())),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Add item'),
                ),
              ],
            ),
            ..._lines.asMap().entries.map((e) => _lineRow(e.key)),
            const SizedBox(height: 12),
            Card(
              color: const Color(0x11123C69),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Items total (excl. GST/discounts)'),
                    Text('₹${_grandApprox.toStringAsFixed(0)}',
                        style: const TextStyle(fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            const Text('Discounts, GST and freight are applied by the server.',
                style: TextStyle(fontSize: 11, color: Colors.black54)),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Create quotation'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _lineRow(int i) {
    final l = _lines[i];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: TextFormField(
                  controller: l.desc,
                  decoration: InputDecoration(
                    labelText: 'Item ${i + 1} description',
                    isDense: true,
                  ),
                ),
              ),
              if (_lines.length > 1)
                IconButton(
                  icon: const Icon(Icons.remove_circle_outline, color: Colors.red),
                  onPressed: () => setState(() {
                    _lines.removeAt(i).dispose();
                  }),
                ),
            ],
          ),
          Row(
            children: [
              Expanded(
                child: TextFormField(
                  controller: l.qty,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Qty', isDense: true),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextFormField(
                  controller: l.rate,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Rate', isDense: true),
                  onChanged: (_) => setState(() {}),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
