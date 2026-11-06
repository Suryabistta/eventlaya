import 'dart:async';
import 'package:flutter/material.dart';
import 'tokens.dart';

enum ToastType { success, error, info, warning }

/// One consistent floating toast for every success, failure and error.
/// Shows at the top of the screen (above sheets and the tab bar), one at a time.
class AppToast {
  AppToast._();

  static OverlayEntry? _entry;
  static Timer? _timer;
  static final _key = GlobalKey<_ToastViewState>();

  static void success(BuildContext context, String message) =>
      show(context, message, type: ToastType.success);
  static void error(BuildContext context, String message) =>
      show(context, message, type: ToastType.error);
  static void info(BuildContext context, String message) =>
      show(context, message, type: ToastType.info);
  static void warning(BuildContext context, String message) =>
      show(context, message, type: ToastType.warning);

  static void show(
    BuildContext context,
    String message, {
    ToastType type = ToastType.info,
    Duration duration = const Duration(milliseconds: 3200),
  }) {
    final overlay = Overlay.maybeOf(context, rootOverlay: true);
    if (overlay == null) return;
    showIn(overlay, message, type: type, duration: duration);
  }

  /// Shows a toast in [overlay] directly (e.g. from above the navigator).
  static void showIn(
    OverlayState overlay,
    String message, {
    ToastType type = ToastType.info,
    Duration duration = const Duration(milliseconds: 3200),
  }) {
    dismiss(animated: false);

    _entry = OverlayEntry(
      builder: (_) => _ToastView(key: _key, message: message, type: type, onTap: dismiss),
    );
    overlay.insert(_entry!);
    _timer = Timer(duration, dismiss);
  }

  static Future<void> dismiss({bool animated = true}) async {
    _timer?.cancel();
    _timer = null;
    final entry = _entry;
    if (entry == null) return;
    _entry = null;
    if (animated) await _key.currentState?.hide();
    if (entry.mounted) entry.remove();
  }
}

class _ToastView extends StatefulWidget {
  final String message;
  final ToastType type;
  final VoidCallback onTap;
  const _ToastView({super.key, required this.message, required this.type, required this.onTap});

  @override
  State<_ToastView> createState() => _ToastViewState();
}

class _ToastViewState extends State<_ToastView> with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 220))..forward();

  Future<void> hide() async {
    if (!mounted) return;
    await _ctrl.reverse();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  (IconData, Color) get _style => switch (widget.type) {
        ToastType.success => (Icons.check_circle_rounded, AppColors.success),
        ToastType.error => (Icons.error_rounded, AppColors.danger),
        ToastType.warning => (Icons.warning_rounded, AppColors.marigold),
        ToastType.info => (Icons.info_rounded, AppColors.brand),
      };

  @override
  Widget build(BuildContext context) {
    final (icon, color) = _style;
    final top = MediaQuery.paddingOf(context).top + 8;
    final curve = CurvedAnimation(parent: _ctrl, curve: Curves.easeOutCubic);

    return Positioned(
      top: top,
      left: 0,
      right: 0,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: FadeTransition(
              opacity: curve,
              child: SlideTransition(
                position: Tween(begin: const Offset(0, -0.4), end: Offset.zero).animate(curve),
                child: Semantics(
                  liveRegion: true,
                  child: Material(
                    color: AppColors.surface,
                    elevation: 10,
                    shadowColor: AppColors.ink900.withValues(alpha: 0.25),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(AppRadius.lg),
                      side: BorderSide(color: color.withValues(alpha: 0.35)),
                    ),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(AppRadius.lg),
                      onTap: widget.onTap,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(14, 12, 16, 12),
                        child: Row(
                          children: [
                            Icon(icon, color: color, size: 22),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                widget.message,
                                style: AppType.body(14, weight: FontWeight.w500, color: AppColors.textPrimary),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
