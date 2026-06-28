import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/auth/auth_providers.dart';
import '../data/quotations_repository.dart';

final quotationsRepositoryProvider = Provider<QuotationsRepository>(
    (ref) => QuotationsRepository(ref.read(apiClientProvider)));
