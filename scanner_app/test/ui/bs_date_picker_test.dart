import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nepali_utils/nepali_utils.dart';
import 'package:eventlaya_scanner/ui/bs_date_picker.dart';

void main() {
  testWidgets('picking a BS day returns the matching AD date', (tester) async {
    DateTime? result;
    final initial = NepaliDateTime(2083, 8, 1).toDateTime(); // 1 Mangsir 2083
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => TextButton(
          onPressed: () async => result = await showBsDatePicker(
              context: context, initialDate: initial, firstDate: DateTime(2020), lastDate: DateTime(2030)),
          child: const Text('open'),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('Mangsir'), findsOneWidget);
    await tester.tap(find.text('15'));
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    final bs = result!.toNepaliDateTime();
    expect([bs.year, bs.month, bs.day], [2083, 8, 15]);
    expect(result, DateTime(result!.year, result!.month, result!.day)); // midnight, AD
  });
}
