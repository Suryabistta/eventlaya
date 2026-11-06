import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../ui/ui.dart';
import '../data/vendor_models.dart';

/// First day shown on a Monday-first grid for [month] (may be in the previous month).
DateTime gridStart(DateTime month) {
  final first = DateTime(month.year, month.month, 1);
  return first.subtract(Duration(days: first.weekday - 1));
}

/// Last day shown on the grid for [month] (6 weeks are always shown).
DateTime gridEnd(DateTime month) => gridStart(month).add(const Duration(days: 41));

/// Month header with previous / next buttons.
class MonthHeader extends StatelessWidget {
  final DateTime month;
  final ValueChanged<DateTime> onChanged;

  /// Earliest month that can be shown (null = no limit).
  final DateTime? firstMonth;
  const MonthHeader({super.key, required this.month, required this.onChanged, this.firstMonth});

  @override
  Widget build(BuildContext context) {
    final canBack =
        firstMonth == null || DateTime(month.year, month.month).isAfter(DateTime(firstMonth!.year, firstMonth!.month));
    return Row(children: [
      Expanded(
        child: Text(DateFormat('MMMM y').format(month), style: AppType.heading(19, weight: FontWeight.w700)),
      ),
      AppIconButton(
        icon: Icons.chevron_left_rounded,
        tooltip: 'Previous month',
        color: canBack ? AppColors.brand : AppColors.ink300,
        onPressed: canBack ? () => onChanged(DateTime(month.year, month.month - 1)) : null,
      ),
      AppIconButton(
        icon: Icons.chevron_right_rounded,
        tooltip: 'Next month',
        onPressed: () => onChanged(DateTime(month.year, month.month + 1)),
      ),
    ]);
  }
}

/// Simple Monday-first month grid. Each day can show coloured status dots
/// and be selected (single or multi).
class MonthGrid extends StatelessWidget {
  final DateTime month;

  /// Day (midnight) → dot colours to show under the number (max 4 drawn).
  final Map<DateTime, List<Color>> dots;
  final Set<DateTime> selected;
  final ValueChanged<DateTime> onTap;

  /// Days that can't be tapped (e.g. past days when blocking).
  final bool Function(DateTime day)? isDisabled;

  /// Days drawn with a soft fill (e.g. fully blocked days).
  final Set<DateTime> muted;

  const MonthGrid({
    super.key,
    required this.month,
    required this.onTap,
    this.dots = const {},
    this.selected = const {},
    this.isDisabled,
    this.muted = const {},
  });

  static const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  @override
  Widget build(BuildContext context) {
    final start = gridStart(month);
    final today = dayOf(DateTime.now());
    return Column(children: [
      Row(children: [
        for (final w in _weekdays)
          Expanded(
            child: Center(
              child: Text(w.substring(0, 1), style: AppType.body(12, weight: FontWeight.w600, color: AppColors.ink400)),
            ),
          ),
      ]),
      const SizedBox(height: 6),
      for (var week = 0; week < 6; week++)
        Row(children: [
          for (var d = 0; d < 7; d++)
            Expanded(
              child: _DayCell(
                day: DateTime(start.year, start.month, start.day + week * 7 + d),
                month: month,
                today: today,
                dots: dots,
                selected: selected,
                muted: muted,
                isDisabled: isDisabled,
                onTap: onTap,
              ),
            ),
        ]),
    ]);
  }
}

class _DayCell extends StatelessWidget {
  final DateTime day;
  final DateTime month;
  final DateTime today;
  final Map<DateTime, List<Color>> dots;
  final Set<DateTime> selected;
  final Set<DateTime> muted;
  final bool Function(DateTime day)? isDisabled;
  final ValueChanged<DateTime> onTap;

  const _DayCell({
    required this.day,
    required this.month,
    required this.today,
    required this.dots,
    required this.selected,
    required this.muted,
    required this.isDisabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final inMonth = day.month == month.month;
    final disabled = isDisabled?.call(day) ?? false;
    final isSelected = selected.contains(day);
    final isToday = day == today;
    final isMuted = muted.contains(day);
    final colors = dots[day] ?? const <Color>[];
    final fg = isSelected
        ? Colors.white
        : !inMonth || disabled
            ? AppColors.ink300
            : isToday
                ? AppColors.brand
                : AppColors.textPrimary;

    return Semantics(
      button: !disabled,
      selected: isSelected,
      label: DateFormat('EEEE d MMMM').format(day),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: disabled ? null : () => onTap(day),
        child: Padding(
          padding: const EdgeInsets.all(2),
          child: AspectRatio(
            aspectRatio: 0.92,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              decoration: BoxDecoration(
                color: isSelected
                    ? AppColors.brand
                    : isMuted && inMonth
                        ? AppColors.ink100
                        : Colors.transparent,
                borderRadius: BorderRadius.circular(12),
                border: isToday && !isSelected ? Border.all(color: AppColors.brand.withValues(alpha: 0.5)) : null,
              ),
              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                Text(
                  '${day.day}',
                  textScaler: MediaQuery.textScalerOf(context).clamp(maxScaleFactor: 1.2),
                  style: AppType.body(15,
                      weight: isToday || isSelected ? FontWeight.w700 : FontWeight.w500, color: fg, height: 1.1),
                ),
                const SizedBox(height: 4),
                SizedBox(
                  height: 6,
                  child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                    for (final c in colors.take(4))
                      Container(
                        width: 6,
                        height: 6,
                        margin: const EdgeInsets.symmetric(horizontal: 1),
                        decoration: BoxDecoration(
                          color: isSelected ? Colors.white : (inMonth ? c : c.withValues(alpha: 0.35)),
                          shape: BoxShape.circle,
                        ),
                      ),
                  ]),
                ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
