import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartshape_sales/core/theme/app_theme.dart';

void main() {
  testWidgets('theme + a trivial widget render', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light,
        home: const Scaffold(body: Center(child: Text('SmartShape Sales'))),
      ),
    );
    expect(find.text('SmartShape Sales'), findsOneWidget);
  });
}
