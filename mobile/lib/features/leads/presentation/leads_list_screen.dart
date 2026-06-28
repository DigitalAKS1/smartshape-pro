import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../application/leads_providers.dart';
import '../data/lead_model.dart';

class LeadsListScreen extends ConsumerStatefulWidget {
  const LeadsListScreen({super.key});

  @override
  ConsumerState<LeadsListScreen> createState() => _LeadsListScreenState();
}

class _LeadsListScreenState extends ConsumerState<LeadsListScreen> {
  final _searchCtrl = TextEditingController();
  Timer? _debounce;
  List<LeadModel>? _searchResults;
  bool _searching = false;

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onSearchChanged(String q) {
    _debounce?.cancel();
    if (q.trim().length < 2) {
      setState(() => _searchResults = null);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      setState(() => _searching = true);
      try {
        final res = await ref.read(leadsRepositoryProvider).search(q.trim());
        if (mounted) setState(() => _searchResults = res);
      } finally {
        if (mounted) setState(() => _searching = false);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final listAsync = ref.watch(leadsListProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Leads'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(60),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
            child: TextField(
              controller: _searchCtrl,
              onChanged: _onSearchChanged,
              decoration: InputDecoration(
                hintText: 'Search leads…',
                prefixIcon: const Icon(Icons.search),
                filled: true,
                fillColor: Colors.white,
                contentPadding: EdgeInsets.zero,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final created = await context.push<bool>('/leads/add');
          if (created == true) ref.invalidate(leadsListProvider);
        },
        icon: const Icon(Icons.add),
        label: const Text('Add lead'),
      ),
      body: _searching
          ? const Center(child: CircularProgressIndicator())
          : _searchResults != null
              ? _LeadList(leads: _searchResults!, onTapRefresh: _refresh)
              : listAsync.when(
                  loading: () => const Center(child: CircularProgressIndicator()),
                  error: (e, _) => Center(child: Text('Could not load leads.\n$e')),
                  data: (leads) => RefreshIndicator(
                    onRefresh: () async => ref.invalidate(leadsListProvider),
                    child: _LeadList(leads: leads, onTapRefresh: _refresh),
                  ),
                ),
    );
  }

  void _refresh() => ref.invalidate(leadsListProvider);
}

class _LeadList extends StatelessWidget {
  const _LeadList({required this.leads, required this.onTapRefresh});
  final List<LeadModel> leads;
  final VoidCallback onTapRefresh;

  @override
  Widget build(BuildContext context) {
    if (leads.isEmpty) {
      return ListView(children: const [
        SizedBox(height: 120),
        Center(child: Text('No leads yet.')),
      ]);
    }
    return ListView.separated(
      itemCount: leads.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (_, i) {
        final l = leads[i];
        return ListTile(
          title: Text(l.companyName.isNotEmpty ? l.companyName : l.contactName),
          subtitle: Text([l.contactName, l.contactPhone]
              .where((s) => s.isNotEmpty)
              .join(' · ')),
          trailing: l.stage.isEmpty
              ? null
              : Chip(
                  label: Text(l.stage, style: const TextStyle(fontSize: 11)),
                  backgroundColor: const Color(0x1F123C69),
                  side: BorderSide.none,
                ),
          onTap: () async {
            await context.push('/leads/${l.leadId}', extra: l);
            onTapRefresh();
          },
        );
      },
    );
  }
}
