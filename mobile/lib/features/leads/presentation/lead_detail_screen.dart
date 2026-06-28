import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/util/dialer.dart';
import '../application/leads_providers.dart';
import '../data/lead_model.dart';

const _stages = [
  'New',
  'Contacted',
  'Qualified',
  'Proposal',
  'Negotiation',
  'Won',
  'Lost',
];

class LeadDetailScreen extends ConsumerStatefulWidget {
  const LeadDetailScreen({super.key, required this.leadId, this.initial});
  final String leadId;
  final LeadModel? initial;

  @override
  ConsumerState<LeadDetailScreen> createState() => _LeadDetailScreenState();
}

class _LeadDetailScreenState extends ConsumerState<LeadDetailScreen> {
  late String _stage = widget.initial?.stage ?? 'New';

  void _snack(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  Future<void> _changeStage(String s) async {
    setState(() => _stage = s);
    try {
      await ref.read(leadsRepositoryProvider).updateStage(widget.leadId, s);
      _snack('Stage updated to $s');
    } catch (e) {
      _snack('Could not update stage: $e');
    }
  }

  Future<void> _call() async {
    final phone = widget.initial?.contactPhone ?? '';
    if (phone.isEmpty) {
      _snack('No phone number on this lead.');
      return;
    }
    await Dialer.call(phone);
    if (!mounted) return;
    await _logCallDialog();
  }

  Future<void> _logCallDialog() async {
    final ctrl = TextEditingController();
    final save = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Log this call?'),
        content: TextField(
          controller: ctrl,
          decoration: const InputDecoration(hintText: 'What happened on the call?'),
          maxLines: 3,
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Skip')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Save note')),
        ],
      ),
    );
    if (save == true && ctrl.text.trim().isNotEmpty) {
      try {
        await ref
            .read(leadsRepositoryProvider)
            .addNote(widget.leadId, ctrl.text.trim());
        ref.invalidate(leadNotesProvider(widget.leadId));
        _snack('Call note saved.');
      } catch (e) {
        _snack('Could not save note: $e');
      }
    }
  }

  Future<void> _addFollowup() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      firstDate: now.subtract(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 365)),
      initialDate: now.add(const Duration(days: 1)),
    );
    if (picked == null) return;
    final date =
        '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    try {
      await ref
          .read(leadsRepositoryProvider)
          .addFollowup(leadId: widget.leadId, date: date);
      _snack('Follow-up set for $date');
    } catch (e) {
      _snack('Could not add follow-up: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = widget.initial;
    final notesAsync = ref.watch(leadNotesProvider(widget.leadId));
    return Scaffold(
      appBar: AppBar(title: Text(l?.companyName ?? 'Lead')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (l != null) ...[
            Text(l.contactName, style: const TextStyle(fontSize: 16)),
            if (l.contactPhone.isNotEmpty)
              Text(l.contactPhone, style: const TextStyle(color: Colors.black54)),
            const SizedBox(height: 16),
          ],
          Row(children: [
            Expanded(
              child: ElevatedButton.icon(
                onPressed: _call,
                icon: const Icon(Icons.call),
                label: const Text('Call'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _addFollowup,
                icon: const Icon(Icons.event),
                label: const Text('Follow-up'),
              ),
            ),
          ]),
          const SizedBox(height: 20),
          const Text('Stage', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 6),
          DropdownButtonFormField<String>(
            initialValue: _stages.contains(_stage) ? _stage : null,
            items: _stages
                .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                .toList(),
            onChanged: (s) => s == null ? null : _changeStage(s),
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Notes', style: TextStyle(fontWeight: FontWeight.bold)),
              TextButton.icon(
                onPressed: _logCallDialog,
                icon: const Icon(Icons.add, size: 18),
                label: const Text('Add note'),
              ),
            ],
          ),
          notesAsync.when(
            loading: () => const Padding(
                padding: EdgeInsets.all(8), child: LinearProgressIndicator()),
            error: (e, _) => Text('Could not load notes: $e'),
            data: (notes) => notes.isEmpty
                ? const Padding(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    child: Text('No notes yet.'))
                : Column(
                    children: notes.map((n) {
                      final m = Map<String, dynamic>.from(n as Map);
                      return ListTile(
                        dense: true,
                        leading: const Icon(Icons.sticky_note_2_outlined),
                        title: Text('${m['content'] ?? ''}'),
                        subtitle: Text('${m['created_by_name'] ?? ''}'),
                      );
                    }).toList(),
                  ),
          ),
        ],
      ),
    );
  }
}
