import 'package:flutter/widgets.dart';
import 'package:screen_brightness/screen_brightness.dart';

/// Turns the screen to full brightness while [active] and this is on screen, so gate scanners read the QR
/// fast; restores the phone's own brightness after (also when the app goes to the background).
class BrightScreen extends StatefulWidget {
  final bool active;
  final Widget child;
  const BrightScreen({super.key, this.active = true, required this.child});

  /// Off in widget tests (no platform channel).
  static bool enabled = true;

  @override
  State<BrightScreen> createState() => _BrightScreenState();
}

class _BrightScreenState extends State<BrightScreen> with WidgetsBindingObserver {
  bool _raised = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _sync();
  }

  @override
  void didUpdateWidget(BrightScreen old) {
    super.didUpdateWidget(old);
    if (old.active != widget.active) _sync();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    state == AppLifecycleState.resumed ? _sync() : _set(false);
  }

  void _sync() => _set(widget.active);

  Future<void> _set(bool on) async {
    if (!BrightScreen.enabled || on == _raised) return;
    _raised = on;
    try {
      if (on) {
        await ScreenBrightness.instance.setApplicationScreenBrightness(1.0);
      } else {
        await ScreenBrightness.instance.resetApplicationScreenBrightness();
      }
    } catch (_) {
      // Brightness is a bonus; the QR still shows.
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _set(false);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
