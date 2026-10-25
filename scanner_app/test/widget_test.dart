import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:eventlaya_scanner/main.dart';

void main() {
  testWidgets('App launches smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: EventlayaApp()));
    expect(find.byType(EventlayaApp), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
  });
}
