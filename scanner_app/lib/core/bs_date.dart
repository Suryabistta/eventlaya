import 'package:intl/intl.dart';
import 'package:nepali_utils/nepali_utils.dart';

/// Dates in Bikram Sambat (BS), the calendar people use in Nepal, matching the website (lib/dates.ts).
/// Data is still AD; only what people read changes.
class BsDate {
  BsDate._();

  static const months = ['Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];

  static final _time = RegExp(r'(?:,\s*|\s+)?([Hh]{1,2}:mm(?::ss)?(?:\s*a)?)');

  /// Formats [d] like `DateFormat(pattern)` but with the BS day, month and year. Patterns without a day
  /// (times only, "MMM y" headers) are formatted in AD as before.
  ///   'EEE d MMM'      -> "Sat 28 Kartik"
  ///   'EEE d MMM y'    -> "Sat 28 Kartik 2083"
  ///   'd MMM, HH:mm'   -> "28 Kartik, 18:42"
  static String format(String pattern, DateTime d) {
    if (!pattern.contains('d') || !pattern.contains('M')) return DateFormat(pattern).format(d);
    final NepaliDateTime bs;
    try {
      bs = d.toNepaliDateTime();
    } catch (_) {
      return DateFormat(pattern).format(d); // outside the converter's range
    }
    final parts = <String>[];
    if (pattern.contains('EEEE')) {
      parts.add(DateFormat('EEEE').format(d));
    } else if (pattern.contains('EEE')) {
      parts.add(DateFormat('EEE').format(d));
    }
    final weekdaySep = pattern.contains('EEE,') ? ', ' : ' ';
    var main = '${bs.day} ${months[bs.month - 1]}';
    if (pattern.contains('y')) main += ' ${bs.year}';
    var out = parts.isEmpty ? main : '${parts.first}$weekdaySep$main';
    final t = _time.firstMatch(pattern);
    if (t != null) out += ', ${DateFormat(t.group(1)!).format(d)}';
    return out;
  }
}
