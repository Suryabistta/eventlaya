import 'package:flutter/material.dart';
import 'tokens.dart';

class Segment<T> {
  final T value;
  final String label;
  final int? count;
  const Segment(this.value, this.label, {this.count});
}

/// Horizontally scrolling filter pills ("All 120 · Checked in 48 …").
class FilterPills<T> extends StatelessWidget {
  final List<Segment<T>> segments;
  final T selected;
  final ValueChanged<T> onChanged;
  final EdgeInsetsGeometry padding;

  const FilterPills({
    super.key,
    required this.segments,
    required this.selected,
    required this.onChanged,
    this.padding = EdgeInsets.zero,
  });

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: padding,
      child: Row(
        children: [
          for (final s in segments) ...[
            _Pill(
              label: s.label,
              count: s.count,
              selected: s.value == selected,
              onTap: () => onChanged(s.value),
            ),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  final String label;
  final int? count;
  final bool selected;
  final VoidCallback onTap;
  const _Pill({required this.label, required this.count, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final fg = selected ? Colors.white : AppColors.ink700;
    const active = AppColors.brand;
    return Semantics(
      selected: selected,
      button: true,
      child: Material(
        color: selected ? active : AppColors.surface,
        shape: StadiumBorder(
          side: BorderSide(color: selected ? active : AppColors.ink200),
        ),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 36),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(label, style: AppType.body(14, weight: FontWeight.w500, color: fg)),
                  if (count != null) ...[
                    const SizedBox(width: 6),
                    Text(
                      '$count',
                      style: AppType.body(13,
                          weight: FontWeight.w500,
                          color: selected ? Colors.white.withValues(alpha: 0.8) : AppColors.ink400),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// iOS-style segmented control (two to four options).
class SegmentedControl<T> extends StatelessWidget {
  final List<Segment<T>> segments;
  final T selected;
  final ValueChanged<T> onChanged;
  final Map<T, Color>? activeColors;
  final bool onDark;

  const SegmentedControl({
    super.key,
    required this.segments,
    required this.selected,
    required this.onChanged,
    this.activeColors,
    this.onDark = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: onDark ? Colors.white.withValues(alpha: 0.12) : AppColors.ink100,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Row(
        children: [
          for (final s in segments)
            Expanded(
              child: Semantics(
                selected: s.value == selected,
                button: true,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => onChanged(s.value),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 180),
                    curve: Curves.easeOut,
                    constraints: const BoxConstraints(minHeight: AppSpace.tap),
                    alignment: Alignment.center,
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                    decoration: BoxDecoration(
                      color: s.value == selected
                          ? (activeColors?[s.value] ?? (onDark ? Colors.white : AppColors.surface))
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(AppRadius.md - 3),
                      boxShadow: s.value == selected && !onDark
                          ? [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 6, offset: const Offset(0, 2))]
                          : null,
                    ),
                    child: Text(
                      s.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppType.body(
                        15,
                        weight: FontWeight.w600,
                        color: s.value == selected
                            ? (activeColors?[s.value] != null
                                ? Colors.white
                                : (onDark ? AppColors.ink900 : AppColors.textPrimary))
                            : (onDark ? Colors.white.withValues(alpha: 0.75) : AppColors.ink500),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
