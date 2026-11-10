import 'package:clock/clock.dart';
import 'package:intl/intl.dart';
import '../../core/bs_date.dart';

/// Formatting helpers shared by screens.
class Fmt {
  Fmt._();

  static DateTime? parse(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    return DateTime.tryParse(iso)?.toLocal();
  }

  /// "18:42" today, otherwise "12 Mar, 18:42".
  static String time(DateTime? t) {
    if (t == null) return '';
    final local = t.toLocal();
    final now = clock.now();
    final sameDay = local.year == now.year && local.month == now.month && local.day == now.day;
    return sameDay ? DateFormat('HH:mm').format(local) : BsDate.format('d MMM, HH:mm', local);
  }

  static String timeIso(String? iso) => time(parse(iso));

  /// "Sat 12 Apr 2025" from an ISO date or date-time; falls back to the raw text.
  static String date(String? iso) {
    final d = parse(iso);
    if (d == null) return iso ?? '';
    return BsDate.format('EEE d MMM y', d);
  }

  static String number(int n) => NumberFormat.decimalPattern().format(n);

  static String plural(int n, String one, [String? many]) =>
      '${number(n)} ${n == 1 ? one : (many ?? '${one}s')}';
}
