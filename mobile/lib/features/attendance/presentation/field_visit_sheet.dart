import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/api_failure.dart';
import '../application/attendance_providers.dart';

/// Bottom sheet to log a field visit (captures GPS at submit time).
class FieldVisitSheet extends ConsumerStatefulWidget {
  const FieldVisitSheet({super.key});

  @override
  ConsumerState<FieldVisitSheet> createState() => _FieldVisitSheetState();
}

class _FieldVisitSheetState extends ConsumerState<FieldVisitSheet> {
  final _formKey = GlobalKey<FormState>();
  final _school = TextEditingController();
  final _contact = TextEditingController();
  final _phone = TextEditingController();
  final _purpose = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _school.dispose();
    _contact.dispose();
    _phone.dispose();
    _purpose.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      final pos = await ref.read(locationServiceProvider).current();
      final now = DateTime.now();
      final date =
          '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
      final time =
          '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
      await ref.read(visitRepositoryProvider).createVisit(
            schoolName: _school.text.trim(),
            contactPerson: _contact.text.trim(),
            contactPhone: _phone.text.trim(),
            visitDate: date,
            visitTime: time,
            purpose: _purpose.text.trim(),
            lat: pos.lat,
            lng: pos.lng,
          );
      if (mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Visit logged.')));
      }
    } on ApiFailure catch (f) {
      _err(f.message);
    } catch (e) {
      _err('Could not log visit: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _err(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Log field visit',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            TextFormField(
              controller: _school,
              decoration: const InputDecoration(labelText: 'School / company'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _contact,
              decoration: const InputDecoration(labelText: 'Contact person'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Contact phone'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _purpose,
              decoration: const InputDecoration(labelText: 'Purpose (optional)'),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _busy ? null : _submit,
                icon: _busy
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.save),
                label: const Text('Save visit (captures location)'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
