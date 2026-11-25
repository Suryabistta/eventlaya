import 'package:flutter/material.dart';
import 'tokens.dart';

enum ButtonTone { brand, success, warning, danger, neutral, onDark }

/// Full-width (by default) filled button with optional icon and loading state.
class PrimaryButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool loading;
  final ButtonTone tone;
  final bool expand;
  final bool tonal;

  const PrimaryButton({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.loading = false,
    this.tone = ButtonTone.brand,
    this.expand = true,
    this.tonal = false,
  });

  (Color bg, Color fg) get _colors {
    final base = switch (tone) {
      ButtonTone.brand => AppColors.brand,
      ButtonTone.success => AppColors.success,
      ButtonTone.warning => AppColors.marigold,
      ButtonTone.danger => AppColors.danger,
      ButtonTone.neutral => AppColors.ink900,
      ButtonTone.onDark => Colors.white,
    };
    if (tone == ButtonTone.onDark) {
      return tonal
          ? (Colors.white.withValues(alpha: 0.14), Colors.white)
          : (Colors.white, AppColors.ink900);
    }
    if (tonal) {
      final tint = switch (tone) {
        ButtonTone.brand => AppColors.brandTint,
        ButtonTone.success => AppColors.successTint,
        ButtonTone.warning => AppColors.marigoldTint,
        ButtonTone.danger => AppColors.dangerTint,
        _ => AppColors.ink100,
      };
      final fg = tone == ButtonTone.warning ? AppColors.marigoldDark : base;
      return (tint, fg);
    }
    // Neutral is a light grey button — no near-black surfaces.
    if (tone == ButtonTone.neutral) return (AppColors.ink100, AppColors.textPrimary);
    return (base, Colors.white);
  }

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = _colors;
    final child = loading
        ? SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2.2, color: fg),
          )
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 20, color: fg),
                const SizedBox(width: 8),
              ],
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.body(16, weight: FontWeight.w600, color: fg),
                ),
              ),
            ],
          );

    final button = FilledButton(
      onPressed: loading ? null : onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: bg,
        foregroundColor: fg,
        disabledBackgroundColor: loading ? bg : AppColors.ink200,
        disabledForegroundColor: loading ? fg : AppColors.ink400,
        minimumSize: const Size(AppSpace.tap, 50),
      ),
      child: child,
    );
    return expand ? SizedBox(width: double.infinity, child: button) : button;
  }
}

/// 44pt circular icon button used in nav bars and the scanner.
class AppIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onPressed;
  final String tooltip;
  final Color? color;
  final Color? background;
  final double size;

  const AppIconButton({
    super.key,
    required this.icon,
    required this.tooltip,
    this.onPressed,
    this.color,
    this.background,
    this.size = AppSpace.tap,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Semantics(
        button: true,
        label: tooltip,
        child: Material(
          color: background ?? Colors.transparent,
          shape: const CircleBorder(),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onPressed,
            child: SizedBox(
              width: size,
              height: size,
              child: Icon(icon, size: 22, color: color ?? AppColors.brand),
            ),
          ),
        ),
      ),
    );
  }
}

/// Plain text action for nav bars ("Add", "Done", "Sign out").
class NavTextButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final bool bold;
  final Color color;
  const NavTextButton({
    super.key,
    required this.label,
    this.onPressed,
    this.bold = false,
    this.color = AppColors.brand,
  });

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        foregroundColor: color,
        padding: const EdgeInsets.symmetric(horizontal: 12),
      ),
      child: Text(
        label,
        style: AppType.body(16, weight: bold ? FontWeight.w600 : FontWeight.w500, color: color),
      ),
    );
  }
}


/// Compact rounded "View details →" button for cards: outlined (default) or filled.
class PillButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final IconData? trailingIcon;
  final bool filled;
  final bool dense;
  const PillButton({
    super.key,
    required this.label,
    this.onPressed,
    this.trailingIcon = Icons.arrow_forward_rounded,
    this.filled = false,
    this.dense = false,
  });

  @override
  Widget build(BuildContext context) {
    final fg = filled ? Colors.white : AppColors.brand;
    return Material(
      color: filled ? AppColors.brand : AppColors.surface,
      shape: StadiumBorder(side: BorderSide(color: AppColors.brand, width: filled ? 0 : 1.4)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onPressed,
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: dense ? 12 : 16, vertical: dense ? 6 : 9),
          child: Row(mainAxisSize: MainAxisSize.min, mainAxisAlignment: MainAxisAlignment.center, children: [
            Flexible(
              child: Text(label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.body(dense ? 12.5 : 13.5, weight: FontWeight.w600, color: fg, height: 1.2)),
            ),
            if (trailingIcon != null) ...[
              const SizedBox(width: 6),
              Icon(trailingIcon, size: dense ? 15 : 17, color: fg),
            ],
          ]),
        ),
      ),
    );
  }
}

/// "See all →" link for section headers.
class SeeAllButton extends StatelessWidget {
  final VoidCallback onPressed;
  final String label;
  const SeeAllButton({super.key, required this.onPressed, this.label = 'See all'});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(99),
      onTap: onPressed,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Text(label, style: AppType.body(14, weight: FontWeight.w600, color: AppColors.brand)),
          const SizedBox(width: 4),
          const Icon(Icons.arrow_forward_rounded, size: 18, color: AppColors.brand),
        ]),
      ),
    );
  }
}

/// Soft card shadow used across the attendee app.
List<BoxShadow> get softShadow => [
      BoxShadow(color: AppColors.ink900.withValues(alpha: 0.06), blurRadius: 18, offset: const Offset(0, 6)),
    ];
