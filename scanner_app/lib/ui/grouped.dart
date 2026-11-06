import 'package:flutter/material.dart';
import 'tokens.dart';

/// iOS "inset grouped" section: optional header, white rounded surface with
/// hairline separators between rows, optional footer.
class GroupedSection extends StatelessWidget {
  final String? header;
  final Widget? headerTrailing;
  final String? footer;
  final List<Widget> children;

  /// Left inset of the separator line (aligns with row text when rows have a leading icon).
  final double separatorInset;
  final EdgeInsetsGeometry margin;

  const GroupedSection({
    super.key,
    this.header,
    this.headerTrailing,
    this.footer,
    required this.children,
    this.separatorInset = 16,
    this.margin = const EdgeInsets.only(bottom: 24),
  });

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < children.length; i++) {
      rows.add(children[i]);
      if (i < children.length - 1) {
        rows.add(Padding(
          padding: EdgeInsetsDirectional.only(start: separatorInset),
          child: const Divider(height: 0.5, thickness: 0.5, color: AppColors.separator),
        ));
      }
    }

    return Padding(
      padding: margin,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (header != null || headerTrailing != null)
            Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 8, headerTrailing == null ? 8 : 0),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: Text(header ?? '', style: AppType.groupHeader),
                  ),
                  if (headerTrailing != null) headerTrailing!,
                ],
              ),
            ),
          GroupedSurface(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: rows,
            ),
          ),
          if (footer != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Text(footer!, style: AppType.caption),
            ),
        ],
      ),
    );
  }
}

/// The white rounded surface used by grouped sections and cards.
class GroupedSurface extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final Color color;
  const GroupedSurface({
    super.key,
    required this.child,
    this.padding,
    this.color = AppColors.surface,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(AppRadius.md + 2),
        border: Border.all(color: AppColors.ink200.withValues(alpha: 0.7), width: 0.5),
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(type: MaterialType.transparency, child: child),
    );
  }
}

/// Leading icon tile used in list rows (iOS Settings style).
class RowIcon extends StatelessWidget {
  final IconData icon;
  final Color color;
  final Color? background;
  const RowIcon(this.icon, {super.key, this.color = Colors.white, this.background});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 30,
      height: 30,
      decoration: BoxDecoration(
        color: background ?? AppColors.brand,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Icon(icon, size: 18, color: color),
    );
  }
}

/// Circular initials avatar.
class InitialsAvatar extends StatelessWidget {
  final String name;
  final double size;
  final Color background;
  final Color foreground;
  const InitialsAvatar({
    super.key,
    required this.name,
    this.size = 40,
    this.background = AppColors.brandTint,
    this.foreground = AppColors.brand,
  });

  static String initialsOf(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1)).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: background, shape: BoxShape.circle),
      child: Text(
        initialsOf(name),
        textScaler: TextScaler.noScaling,
        style: AppType.body(size * 0.38, weight: FontWeight.w600, color: foreground),
      ),
    );
  }
}

/// A row inside a [GroupedSection].
class ListRow extends StatelessWidget {
  final Widget? leading;
  final String title;
  final Widget? titleWidget;
  final String? subtitle;
  final Widget? subtitleWidget;
  final Widget? trailing;
  final String? value;
  final bool chevron;
  final bool destructive;
  final bool centered;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;

  const ListRow({
    super.key,
    required this.title,
    this.titleWidget,
    this.leading,
    this.subtitle,
    this.subtitleWidget,
    this.trailing,
    this.value,
    this.chevron = false,
    this.destructive = false,
    this.centered = false,
    this.onTap,
    this.padding = const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
  });

  @override
  Widget build(BuildContext context) {
    final titleStyle = AppType.rowTitle.copyWith(
      color: destructive ? AppColors.danger : (centered ? AppColors.brand : AppColors.textPrimary),
    );

    final content = ConstrainedBox(
      constraints: const BoxConstraints(minHeight: AppSpace.tap + 8),
      child: Padding(
        padding: padding,
        child: Row(
          children: [
            if (leading != null) ...[leading!, const SizedBox(width: 12)],
            Expanded(
              child: Column(
                crossAxisAlignment:
                    centered ? CrossAxisAlignment.center : CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  titleWidget ??
                      Text(
                        title,
                        style: titleStyle,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        textAlign: centered ? TextAlign.center : TextAlign.start,
                      ),
                  if (subtitleWidget != null) ...[
                    const SizedBox(height: 2),
                    subtitleWidget!,
                  ] else if (subtitle != null && subtitle!.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle!,
                      style: AppType.rowSubtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            if (value != null) ...[
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  value!,
                  textAlign: TextAlign.end,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.body(15, color: AppColors.textSecondary),
                ),
              ),
            ],
            if (trailing != null) ...[const SizedBox(width: 8), trailing!],
            if (chevron) ...[
              const SizedBox(width: 4),
              const Icon(Icons.chevron_right_rounded, color: AppColors.ink300, size: 22),
            ],
          ],
        ),
      ),
    );

    if (onTap == null) return content;
    return InkWell(onTap: onTap, child: content);
  }
}

/// A text field styled to sit inside a [GroupedSection] (no border).
class FieldRow extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final String? hint;
  final IconData? icon;
  final bool obscure;
  final Widget? suffix;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;
  final ValueChanged<String>? onChanged;
  final FormFieldValidator<String>? validator;
  final int maxLines;
  final bool autofocus;
  final Iterable<String>? autofillHints;
  final TextCapitalization textCapitalization;

  const FieldRow({
    super.key,
    required this.controller,
    required this.label,
    this.hint,
    this.icon,
    this.obscure = false,
    this.suffix,
    this.keyboardType,
    this.textInputAction,
    this.onSubmitted,
    this.onChanged,
    this.validator,
    this.maxLines = 1,
    this.autofocus = false,
    this.autofillHints,
    this.textCapitalization = TextCapitalization.none,
  });

  @override
  Widget build(BuildContext context) {
    const none = InputBorder.none;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
      child: TextFormField(
        controller: controller,
        obscureText: obscure,
        keyboardType: keyboardType,
        textInputAction: textInputAction,
        onFieldSubmitted: onSubmitted,
        onChanged: onChanged,
        validator: validator,
        maxLines: maxLines,
        minLines: 1,
        autofocus: autofocus,
        autofillHints: autofillHints,
        textCapitalization: textCapitalization,
        style: AppType.body(16),
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          filled: false,
          border: none,
          enabledBorder: none,
          focusedBorder: none,
          errorBorder: none,
          focusedErrorBorder: none,
          contentPadding: const EdgeInsets.symmetric(vertical: 10),
          prefixIcon: icon == null ? null : Icon(icon, size: 20),
          prefixIconConstraints: const BoxConstraints(minWidth: 34, minHeight: 24),
          suffixIcon: suffix,
          floatingLabelStyle: AppType.body(13, color: AppColors.textSecondary),
        ),
      ),
    );
  }
}
