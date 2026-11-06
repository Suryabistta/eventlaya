import 'package:flutter/material.dart';
import 'tokens.dart';

enum Tone { success, warning, danger, brand, neutral }

extension ToneColors on Tone {
  Color get color => switch (this) {
        Tone.success => AppColors.success,
        Tone.warning => AppColors.marigold,
        Tone.danger => AppColors.danger,
        Tone.brand => AppColors.brand,
        Tone.neutral => AppColors.ink500,
      };

  /// Foreground colour with enough contrast on the tint background.
  Color get strong => switch (this) {
        Tone.warning => AppColors.marigoldDark,
        _ => color,
      };

  Color get tint => switch (this) {
        Tone.success => AppColors.successTint,
        Tone.warning => AppColors.marigoldTint,
        Tone.danger => AppColors.dangerTint,
        Tone.brand => AppColors.brandTint,
        Tone.neutral => AppColors.ink100,
      };
}

/// Small rounded pill with a dot, e.g. "Checked in".
class StatusBadge extends StatelessWidget {
  final String label;
  final Tone tone;
  final bool dot;
  final bool onDark;

  const StatusBadge(this.label, {super.key, this.tone = Tone.neutral, this.dot = true, this.onDark = false});

  @override
  Widget build(BuildContext context) {
    final fg = onDark ? Colors.white : tone.strong;
    final bg = onDark ? tone.color.withValues(alpha: 0.28) : tone.tint;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot) ...[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(color: onDark ? tone.color : tone.color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppType.body(12, weight: FontWeight.w500, color: fg, height: 1.3),
            ),
          ),
        ],
      ),
    );
  }
}

/// Ticket status helpers shared across screens.
class TicketStatus {
  TicketStatus._();

  static String label(String? status) => switch (status) {
        'checked_in' => 'Checked in',
        'checked_out' => 'Checked out',
        'valid' => 'Registered',
        'cancelled' => 'Cancelled',
        null || '' => 'Unknown',
        _ => _sentence(status),
      };

  static Tone tone(String? status) => switch (status) {
        'checked_in' => Tone.success,
        'checked_out' => Tone.warning,
        'cancelled' => Tone.danger,
        _ => Tone.neutral,
      };

  static String _sentence(String s) {
    final t = s.replaceAll('_', ' ').trim();
    if (t.isEmpty) return t;
    return t[0].toUpperCase() + t.substring(1).toLowerCase();
  }

  static String sentence(String s) => _sentence(s);
}

/// Big number tile for dashboards.
class StatTile extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Tone tone;
  final String? caption;
  final bool onDark;

  const StatTile({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.tone = Tone.neutral,
    this.caption,
    this.onDark = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      decoration: BoxDecoration(
        color: onDark ? Colors.white.withValues(alpha: 0.08) : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md + 2),
        border: Border.all(
          color: onDark ? Colors.white.withValues(alpha: 0.1) : AppColors.ink200.withValues(alpha: 0.7),
          width: 0.5,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: onDark ? tone.color.withValues(alpha: 0.25) : tone.tint,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, size: 16, color: onDark ? Colors.white : tone.strong),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.body(13,
                      weight: FontWeight.w500,
                      color: onDark ? AppColors.ink300 : AppColors.textSecondary),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: AppType.heading(30,
                  weight: FontWeight.w800, color: onDark ? Colors.white : AppColors.textPrimary),
            ),
          ),
          if (caption != null) ...[
            const SizedBox(height: 2),
            Text(
              caption!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppType.caption.copyWith(color: onDark ? AppColors.ink300 : null),
            ),
          ],
        ],
      ),
    );
  }
}
