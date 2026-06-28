import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/auth/auth_providers.dart';
import 'core/auth/auth_state.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';

class SmartShapeApp extends ConsumerStatefulWidget {
  const SmartShapeApp({super.key});

  @override
  ConsumerState<SmartShapeApp> createState() => _SmartShapeAppState();
}

class _SmartShapeAppState extends ConsumerState<SmartShapeApp> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(authControllerProvider.notifier).bootstrap();
    });
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(authControllerProvider).status;
    if (status == AuthStatus.unknown) {
      return MaterialApp(
        title: 'SmartShape Sales',
        theme: AppTheme.light,
        debugShowCheckedModeBanner: false,
        home: const Scaffold(
          backgroundColor: AppTheme.navy,
          body: Center(child: CircularProgressIndicator(color: Colors.white)),
        ),
      );
    }
    return MaterialApp.router(
      title: 'SmartShape Sales',
      theme: AppTheme.light,
      debugShowCheckedModeBanner: false,
      routerConfig: ref.watch(appRouterProvider),
    );
  }
}
