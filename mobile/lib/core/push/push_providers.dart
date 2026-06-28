import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../auth/auth_providers.dart';
import 'push_service.dart';

final pushServiceProvider =
    Provider<PushService>((ref) => PushService(ref.read(apiClientProvider)));
