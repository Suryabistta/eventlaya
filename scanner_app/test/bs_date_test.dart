import 'package:flutter_test/flutter_test.dart';
import 'package:eventlaya_scanner/core/bs_date.dart';

void main() {
  test('BS dates match the website (27 Oct 2026 = 10 Kartik 2083)', () {
    final d = DateTime(2026, 10, 27, 18, 42);
    expect(BsDate.format('d MMM y', d), '10 Kartik 2083');
    expect(BsDate.format('EEE d MMM', d), 'Tue 10 Kartik');
    expect(BsDate.format('d MMM, HH:mm', d), '10 Kartik, 18:42');
    expect(BsDate.format('HH:mm', d), '18:42'); // times stay as they are
  });
}
