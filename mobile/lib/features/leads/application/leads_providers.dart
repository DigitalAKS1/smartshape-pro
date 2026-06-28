import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/auth/auth_providers.dart';
import '../data/lead_model.dart';
import '../data/leads_repository.dart';

final leadsRepositoryProvider =
    Provider<LeadsRepository>((ref) => LeadsRepository(ref.read(apiClientProvider)));

final leadsListProvider =
    FutureProvider.autoDispose<List<LeadModel>>(
        (ref) => ref.read(leadsRepositoryProvider).list());

/// Notes for a single lead.
final leadNotesProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>(
        (ref, leadId) => ref.read(leadsRepositoryProvider).notes(leadId));
