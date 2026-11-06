import 'package:flutter/material.dart';
import 'buttons.dart';
import 'tokens.dart';

/// Opens a bottom sheet with a drag handle, rounded top corners, keyboard and
/// safe-area insets handled. Use for quick actions; use full pages for long forms.
Future<T?> showAppSheet<T>(
  BuildContext context, {
  required WidgetBuilder builder,
  bool scrollable = true,
  Color? background,
}) {
  return showModalBottomSheet<T>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: background ?? AppColors.surface,
    constraints: const BoxConstraints(maxWidth: 560),
    builder: (ctx) {
      final insets = MediaQuery.viewInsetsOf(ctx).bottom;
      final safe = MediaQuery.paddingOf(ctx).bottom;
      final child = Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, insets + safe + 16),
        child: builder(ctx),
      );
      if (!scrollable) return child;
      return ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * 0.9),
        child: SingleChildScrollView(child: child),
      );
    },
  );
}

/// Title (and optional message) at the top of a sheet.
class SheetHeader extends StatelessWidget {
  final String title;
  final String? message;
  const SheetHeader({super.key, required this.title, this.message});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppType.heading(22)),
          if (message != null) ...[
            const SizedBox(height: 4),
            Text(message!, style: AppType.body(14, color: AppColors.textSecondary)),
          ],
        ],
      ),
    );
  }
}

/// A sheet action row (icon + label), used for action lists.
class SheetAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool destructive;
  final bool selected;

  /// Shown after the label (e.g. a status badge).
  final Widget? trailing;
  const SheetAction({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.destructive = false,
    this.selected = false,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    final color = destructive ? AppColors.danger : AppColors.textPrimary;
    return InkWell(
      borderRadius: BorderRadius.circular(AppRadius.md),
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 52),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          child: Row(
            children: [
              Icon(icon, color: destructive ? AppColors.danger : AppColors.ink600, size: 22),
              const SizedBox(width: 14),
              Expanded(child: Text(label, style: AppType.body(16, weight: FontWeight.w500, color: color))),
              if (trailing != null) ...[const SizedBox(width: 8), trailing!],
              if (selected) const Icon(Icons.check_rounded, color: AppColors.brand, size: 22),
            ],
          ),
        ),
      ),
    );
  }
}

/// Confirmation sheet. Returns true when confirmed.
Future<bool> confirmSheet(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  bool destructive = true,
}) async {
  final result = await showAppSheet<bool>(
    context,
    builder: (ctx) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        SheetHeader(title: title, message: message),
        PrimaryButton(
          label: confirmLabel,
          tone: destructive ? ButtonTone.danger : ButtonTone.brand,
          onPressed: () => Navigator.pop(ctx, true),
        ),
        const SizedBox(height: 8),
        PrimaryButton(
          label: 'Cancel',
          tone: ButtonTone.neutral,
          tonal: true,
          onPressed: () => Navigator.pop(ctx, false),
        ),
      ],
    ),
  );
  return result ?? false;
}
