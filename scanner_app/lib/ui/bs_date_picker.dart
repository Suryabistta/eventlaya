import 'package:flutter/material.dart';
import 'package:nepali_utils/nepali_utils.dart';
import '../core/bs_date.dart';
import 'tokens.dart';

/// Nepali (BS) calendar picker, matching the website's BsDateInput. People pick in BS;
/// the result is a plain AD [DateTime] (midnight), so stored data stays AD.
Future<DateTime?> showBsDatePicker({
  required BuildContext context,
  required DateTime initialDate,
  required DateTime firstDate,
  required DateTime lastDate,
}) {
  // The converter covers BS 1970–2100; keep the range inside it
  final minAd = NepaliDateTime(1970, 1, 1).toDateTime();
  final maxAd = NepaliDateTime(2100, 12, 30).toDateTime();
  DateTime day(DateTime d) => DateTime(d.year, d.month, d.day);
  final first = day(firstDate.isBefore(minAd) ? minAd : firstDate);
  final last = day(lastDate.isAfter(maxAd) ? maxAd : lastDate);
  var initial = day(initialDate);
  if (initial.isBefore(first)) initial = first;
  if (initial.isAfter(last)) initial = last;
  return showDialog<DateTime>(
    context: context,
    builder: (_) => _BsPickerDialog(initial: initial, first: first, last: last),
  );
}

class _BsPickerDialog extends StatefulWidget {
  final DateTime initial;
  final DateTime first;
  final DateTime last;
  const _BsPickerDialog({required this.initial, required this.first, required this.last});

  @override
  State<_BsPickerDialog> createState() => _BsPickerDialogState();
}

class _BsPickerDialogState extends State<_BsPickerDialog> {
  late DateTime _selected = widget.initial;
  late int _year;
  late int _month; // 1-12, BS

  static const _weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  @override
  void initState() {
    super.initState();
    final bs = widget.initial.toNepaliDateTime();
    _year = bs.year;
    _month = bs.month;
  }

  NepaliDateTime get _firstBs => widget.first.toNepaliDateTime();
  NepaliDateTime get _lastBs => widget.last.toNepaliDateTime();

  bool get _canPrev => _year > _firstBs.year || (_year == _firstBs.year && _month > _firstBs.month);
  bool get _canNext => _year < _lastBs.year || (_year == _lastBs.year && _month < _lastBs.month);

  void _shift(int by) => setState(() {
        var m = _month + by, y = _year;
        if (m < 1) {
          m = 12;
          y--;
        }
        if (m > 12) {
          m = 1;
          y++;
        }
        _month = m;
        _year = y;
      });

  void _setYear(int y) => setState(() {
        _year = y;
        // Keep the shown month inside the allowed range
        if (y == _firstBs.year && _month < _firstBs.month) _month = _firstBs.month;
        if (y == _lastBs.year && _month > _lastBs.month) _month = _lastBs.month;
      });

  @override
  Widget build(BuildContext context) {
    final monthStart = NepaliDateTime(_year, _month, 1);
    final days = monthStart.totalDays;
    final offset = monthStart.toDateTime().weekday % 7; // Sunday first
    final selectedBs = _selected.toNepaliDateTime();

    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(BsDate.format('EEE d MMM y', _selected), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            Row(children: [
              IconButton(
                tooltip: 'Previous month',
                icon: const Icon(Icons.chevron_left_rounded),
                onPressed: _canPrev ? () => _shift(-1) : null,
              ),
              Expanded(
                child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Text(BsDate.months[_month - 1], style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                  const SizedBox(width: 6),
                  DropdownButton<int>(
                    value: _year,
                    underline: const SizedBox.shrink(),
                    items: [
                      for (var y = _lastBs.year; y >= _firstBs.year; y--) DropdownMenuItem(value: y, child: Text('$y')),
                    ],
                    onChanged: (y) => y == null ? null : _setYear(y),
                  ),
                ]),
              ),
              IconButton(
                tooltip: 'Next month',
                icon: const Icon(Icons.chevron_right_rounded),
                onPressed: _canNext ? () => _shift(1) : null,
              ),
            ]),
            Row(children: [
              for (final w in _weekdays)
                Expanded(
                  child: Center(child: Text(w, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary))),
                ),
            ]),
            const SizedBox(height: 4),
            GridView.count(
              crossAxisCount: 7,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              children: [
                for (var i = 0; i < offset; i++) const SizedBox.shrink(),
                for (var d = 1; d <= days; d++)
                  Builder(builder: (_) {
                    final ad = NepaliDateTime(_year, _month, d).toDateTime();
                    final adDay = DateTime(ad.year, ad.month, ad.day);
                    final enabled = !adDay.isBefore(widget.first) && !adDay.isAfter(widget.last);
                    final isSel = selectedBs.year == _year && selectedBs.month == _month && selectedBs.day == d;
                    return Padding(
                      padding: const EdgeInsets.all(2),
                      child: Material(
                        color: isSel ? AppColors.brand : Colors.transparent,
                        shape: const CircleBorder(),
                        child: InkWell(
                          customBorder: const CircleBorder(),
                          onTap: enabled ? () => setState(() => _selected = adDay) : null,
                          child: Center(
                            child: Text('$d',
                                style: TextStyle(
                                  fontWeight: isSel ? FontWeight.w700 : FontWeight.w500,
                                  color: isSel
                                      ? Colors.white
                                      : enabled
                                          ? AppColors.textPrimary
                                          : AppColors.ink300,
                                )),
                          ),
                        ),
                      ),
                    );
                  }),
              ],
            ),
            Row(mainAxisAlignment: MainAxisAlignment.end, children: [
              TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
              TextButton(onPressed: () => Navigator.pop(context, _selected), child: const Text('OK')),
            ]),
          ]),
        ),
      ),
    );
  }
}
