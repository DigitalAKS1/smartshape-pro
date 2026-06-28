import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../application/leads_providers.dart';

class AddLeadScreen extends ConsumerStatefulWidget {
  const AddLeadScreen({super.key});

  @override
  ConsumerState<AddLeadScreen> createState() => _AddLeadScreenState();
}

class _AddLeadScreenState extends ConsumerState<AddLeadScreen> {
  final _formKey = GlobalKey<FormState>();
  final _contactName = TextEditingController();
  final _contactPhone = TextEditingController();
  final _schoolName = TextEditingController();
  final _city = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _contactName.dispose();
    _contactPhone.dispose();
    _schoolName.dispose();
    _city.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await ref.read(leadsRepositoryProvider).create(
        contactName: _contactName.text.trim(),
        contactPhone: _contactPhone.text.trim(),
        newSchool: {
          'school_name': _schoolName.text.trim(),
          'city': _city.text.trim(),
        },
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Could not create lead: $e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add lead')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _schoolName,
              decoration: const InputDecoration(labelText: 'School / company name'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _city,
              decoration: const InputDecoration(labelText: 'City (optional)'),
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _contactName,
              decoration: const InputDecoration(labelText: 'Contact person'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _contactPhone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Contact phone'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Text('Create lead'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
