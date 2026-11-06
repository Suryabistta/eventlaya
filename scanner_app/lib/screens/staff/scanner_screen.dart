import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:vibration/vibration.dart';
import '../../models/gate_model.dart';
import '../../models/gate_stats_model.dart';
import '../../models/scan_result_model.dart';
import '../../providers/event_provider.dart';
import '../../providers/scan_provider.dart';
import '../../ui/ui.dart';
import '../common/event_phase.dart';
import '../common/format.dart';
import '../common/passes.dart';
import '../common/pickers.dart';
import 'gate_select_screen.dart';

/// Injectable scanner settings (tests replace the camera with a placeholder).
class ScannerConfig {
  final bool useCamera;

  /// Shows this result immediately and keeps it on screen (previews/tests).
  final ScanResultModel? debugResult;

  const ScannerConfig({this.useCamera = true, this.debugResult});
}

final scannerConfigProvider = Provider<ScannerConfig>((ref) => const ScannerConfig());

class ScannerScreen extends ConsumerStatefulWidget {
  /// False while the tab is hidden: the camera and wakelock are released.
  final bool active;
  const ScannerScreen({super.key, this.active = true});

  @override
  ConsumerState<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends ConsumerState<ScannerScreen>
    with WidgetsBindingObserver, TickerProviderStateMixin {
  MobileScannerController? _scannerCtrl;
  late final ScannerConfig _config = ref.read(scannerConfigProvider);

  String _scanType = 'gate_in'; // 'gate_in' or 'gate_out'
  bool _busy = false;
  ScanResultModel? _currentResult;
  bool _torchOn = false;

  static const _resultHold = Duration(milliseconds: 2500);

  late final AnimationController _panelAnim;
  late final AnimationController _countdown;

  bool get _locked => _busy || _currentResult != null;

  @override
  void initState() {
    super.initState();
    _panelAnim = AnimationController(vsync: this, duration: const Duration(milliseconds: 240));
    _countdown = AnimationController(vsync: this, duration: _resultHold)
      ..addStatusListener((s) {
        if (s == AnimationStatus.completed) _dismissResult();
      });
    WidgetsBinding.instance.addObserver(this);
    if (_config.useCamera) {
      _scannerCtrl = MobileScannerController(
        autoStart: false,
        detectionSpeed: DetectionSpeed.noDuplicates,
        facing: CameraFacing.back,
        torchEnabled: false,
      );
    }
    // Exit-only assigned gates start in gate-out mode.
    final gate = ref.read(eventProvider).gate;
    if (gate != null && !gate.allowsEntry) _scanType = 'gate_out';
    if (_config.debugResult != null) {
      _scanType = _config.debugResult!.scanType ?? _scanType;
      _currentResult = _config.debugResult;
      _panelAnim.value = 1;
    }
    if (widget.active) _activate();
  }

  @override
  void didUpdateWidget(covariant ScannerScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active != oldWidget.active) {
      widget.active ? _activate() : _deactivate();
    }
  }

  /// Keeps the screen on while scanning. A failure (plugin missing or not
  /// supported) only means the screen may dim, so it is swallowed here.
  static Future<void> _setWakelock(bool on) => WakelockPlus.toggle(enable: on).catchError((Object _) {});

  Future<void> _activate() async {
    await _setWakelock(true);
    if (!_locked) await _startCamera();
  }

  Future<void> _deactivate() async {
    await _setWakelock(false);
    await _stopCamera();
    if (_torchOn && mounted) setState(() => _torchOn = false);
  }

  Future<void> _startCamera() async {
    try {
      await _scannerCtrl?.start();
    } catch (_) {}
  }

  Future<void> _stopCamera() async {
    try {
      await _scannerCtrl?.stop();
    } catch (_) {}
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_setWakelock(false));
    _scannerCtrl?.dispose();
    _panelAnim.dispose();
    _countdown.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      _stopCamera();
    } else if (state == AppLifecycleState.resumed) {
      if (!_locked && widget.active) _startCamera();
    }
  }

  Future<void> _onQRDetected(BarcodeCapture capture) async {
    if (_locked) return; // Locked while a result is showing
    final code = capture.barcodes.firstOrNull?.rawValue;
    if (code == null || code.trim().isEmpty) return;
    await _processScan(code.trim());
  }

  Future<void> _processScan(String token) async {
    if (_locked) return;

    final eventState = ref.read(eventProvider);
    final event = eventState.currentEvent;
    if (event == null) {
      AppToast.error(context, 'Choose an event before scanning');
      return;
    }
    final gates = ref.read(gatesProvider(event.id)).valueOrNull;
    if (gates != null && gates.isEmpty) {
      AppToast.error(context, 'Ask your organizer to set up gates for this event');
      return;
    }
    final gate = eventState.gate;
    if (gate != null && !gate.allows(_scanType)) {
      AppToast.error(context, '${gate.name} is ${gate.kindLabel.toLowerCase()}. Switch mode or change gate.');
      return;
    }

    setState(() => _busy = true);
    await _stopCamera();

    final result = await ref.read(scanProvider.notifier).scan(
          qrToken: token,
          scanType: _scanType,
          gateName: eventState.selectedGate ?? '',
          gateId: (gate?.id.isNotEmpty ?? false) ? gate!.id : null,
          eventId: event.id,
        );

    if (!mounted) return;
    setState(() {
      _busy = false;
      _currentResult = result;
    });
    _triggerHaptics(result);
    _panelAnim.forward(from: 0);
    _countdown.forward(from: 0);

    // Refresh gate stats immediately
    ref.read(eventProvider.notifier).fetchStats(event.id);
  }

  Future<void> _dismissResult() async {
    if (!mounted || _currentResult == null) return;
    _countdown.stop();
    await _panelAnim.reverse();
    if (!mounted) return;
    setState(() => _currentResult = null);
    if (widget.active) await _startCamera();
  }

  Future<void> _viewPass() async {
    final result = _currentResult;
    if (result == null) return;
    _countdown.stop(); // keep the result while the pass is open
    final eventState = ref.read(eventProvider);
    await showTicketPassSheet(
      context,
      pass: passFromScan(result, event: eventState.currentEvent, gate: eventState.selectedGate),
    );
    if (mounted) _dismissResult();
  }

  Future<void> _triggerHaptics(ScanResultModel result) async {
    try {
      final hasVibrator = await Vibration.hasVibrator();
      if (!hasVibrator) {
        HapticFeedback.mediumImpact();
        return;
      }

      if (result.isSuccess) {
        Vibration.vibrate(duration: 140);
      } else if (result.isWarning) {
        Vibration.vibrate(pattern: [0, 80, 80, 80]);
      } else {
        Vibration.vibrate(pattern: [0, 60, 60, 60, 60, 60]);
      }
    } catch (_) {
      HapticFeedback.selectionClick();
    }
  }

  Future<void> _openManualEntry() async {
    final ctrl = TextEditingController();
    final token = await showAppSheet<String>(
      context,
      builder: (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          SheetHeader(
            title: 'Type a ticket code',
            message: 'Use this when a QR code won\'t scan. ${scanTypeLabel(_scanType)}${ref.read(eventProvider).selectedGate == null ? '' : ' at ${ref.read(eventProvider).selectedGate}'}.',
          ),
          TextField(
            controller: ctrl,
            autofocus: true,
            autocorrect: false,
            textCapitalization: TextCapitalization.characters,
            style: AppType.mono(17, weight: FontWeight.w600),
            decoration: const InputDecoration(
              labelText: 'Ticket code or QR token',
              hintText: 'TKT-XXXX',
              prefixIcon: Icon(Icons.confirmation_number_outlined),
            ),
            onSubmitted: (v) => Navigator.pop(ctx, v),
          ),
          const SizedBox(height: 20),
          PrimaryButton(label: 'Check ticket', onPressed: () => Navigator.pop(ctx, ctrl.text)),
        ],
      ),
    );
    final t = token?.trim() ?? '';
    if (t.isEmpty || !mounted) return;
    await _processScan(t);
  }

  Future<void> _changeGate() async {
    final s = ref.read(eventProvider);
    final event = s.currentEvent;
    if (event == null) return;
    if (s.gateLocked) {
      AppToast.info(context, 'Your gate was assigned by your organizer.');
      return;
    }
    final gate = await showGatePicker(
      context,
      eventId: event.id,
      scanType: _scanType,
      current: s.gate,
      currentName: s.selectedGate,
    );
    if (gate == null || !mounted) return;
    await ref.read(eventProvider.notifier).selectGate(gate);
    if (mounted) AppToast.success(context, 'Scanning at ${gate.name}');
  }

  /// Switch gate in / gate out, keeping the gate compatible with the mode.
  void _setMode(String mode) {
    if (mode == _scanType) return;
    final s = ref.read(eventProvider);
    final gate = s.gate;
    final what = mode == 'gate_out' ? 'exit' : 'entry';
    if (gate != null && !gate.allows(mode)) {
      if (s.gateLocked) {
        AppToast.warning(context, '${gate.name} is ${gate.kindLabel.toLowerCase()}. Ask your organizer if you need to scan $what.');
        return;
      }
      final gates = s.currentEvent == null ? null : ref.read(gatesProvider(s.currentEvent!.id)).valueOrNull;
      final next = gates?.where((g) => g.allows(mode)).firstOrNull;
      if (next == null) {
        AppToast.error(context, 'No gate allows $what. Ask your organizer to set one up.');
        return;
      }
      ref.read(eventProvider.notifier).selectGate(next);
      AppToast.info(context, '${gate.name} is ${gate.kindLabel.toLowerCase()}. Switched to ${next.name}.');
    }
    HapticFeedback.selectionClick();
    setState(() => _scanType = mode);
  }

  /// Picks a gate automatically when the event has gates but none is chosen.
  void _autoSelectGate(List<GateModel>? gates) {
    final s = ref.read(eventProvider);
    if (gates == null || gates.isEmpty || s.gateLocked) return;
    if (s.gate != null && gates.any((g) => g.id == s.gate!.id)) return;
    final compatible = gates.where((g) => g.allows(_scanType)).toList();
    if (compatible.isEmpty) return;
    final byName = compatible.where((g) => g.name == s.selectedGate).firstOrNull;
    ref.read(eventProvider.notifier).selectGate(byName ?? compatible.first);
  }

  Future<void> _syncQueue() async {
    AppToast.info(context, 'Syncing saved scans…');
    final r = await ref.read(scanProvider.notifier).flushOfflineQueue();
    if (!mounted) return;
    if (r.remaining == 0) {
      AppToast.success(context, 'Synced ${Fmt.plural(r.synced, 'scan')}');
    } else {
      AppToast.error(context,
          "Couldn't sync ${Fmt.plural(r.remaining, 'scan')}. We'll try again when you're back online.");
    }
  }

  @override
  Widget build(BuildContext context) {
    final eventState = ref.watch(eventProvider);
    final scanState = ref.watch(scanProvider);
    final event = eventState.currentEvent;
    final bottomInset = MediaQuery.paddingOf(context).bottom;

    if (event == null) {
      return Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: EmptyState(
            icon: Icons.event_outlined,
            title: 'No event selected',
            message: 'Choose the event and gate you are scanning for.',
            actionLabel: 'Choose event',
            onAction: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => const GateSelectScreen(returnOnDone: true),
            )),
          ),
        ),
      );
    }

    final gatesAsync = ref.watch(gatesProvider(event.id));
    final gates = gatesAsync.valueOrNull;
    if (gates != null && gates.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _autoSelectGate(gates);
      });
    }
    final noGates = gates != null && gates.isEmpty;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Stack(
          children: [
            Positioned.fill(
              child: SafeArea(
                bottom: false,
                child: Padding(
                  padding: EdgeInsets.only(bottom: bottomInset),
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 600),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _HeaderCard(
                              title: event.title,
                              gateName: noGates ? 'No gates set up' : (eventState.selectedGate ?? 'Choose a gate'),
                              gate: noGates ? null : eventState.gate,
                              locked: eventState.gateLocked,
                              warning: noGates,
                              stats: eventState.stats,
                              torchOn: _torchOn,
                              hasCamera: _scannerCtrl != null,
                              onGateTap: _changeGate,
                              onTorch: () {
                                _scannerCtrl?.toggleTorch();
                                setState(() => _torchOn = !_torchOn);
                              },
                              onFlip: () => _scannerCtrl?.switchCamera(),
                            ),
                            if (noGates) ...[
                              const SizedBox(height: 10),
                              const _Notice(
                                icon: Icons.door_front_door_outlined,
                                text: 'Ask your organizer to set up gates for this event before scanning.',
                              ),
                            ],
                            ScanWindowNotice(event, padding: const EdgeInsets.only(top: 10)),
                            if (!scanState.isOnline || scanState.offlineQueueCount > 0) ...[
                              const SizedBox(height: 10),
                              _OfflineNotice(
                                online: scanState.isOnline,
                                queued: scanState.offlineQueueCount,
                                onSync: _syncQueue,
                              ),
                            ],
                            const SizedBox(height: 12),
                            Expanded(
                              child: _Viewfinder(
                                camera: _camera(),
                                onCamera: _scannerCtrl != null && widget.active,
                                busy: _busy,
                                scanType: _scanType,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Point the camera at the QR code on the pass',
                              textAlign: TextAlign.center,
                              style: AppType.body(13, color: AppColors.textSecondary),
                            ),
                            const SizedBox(height: 12),
                            SegmentedControl<String>(
                              segments: const [
                                Segment('gate_in', 'Gate in'),
                                Segment('gate_out', 'Gate out'),
                              ],
                              activeColors: const {
                                'gate_in': AppColors.success,
                                'gate_out': AppColors.marigold,
                              },
                              selected: _scanType,
                              onChanged: _setMode,
                            ),
                            const SizedBox(height: 10),
                            PrimaryButton(
                              label: 'Type a code',
                              icon: Icons.keyboard_outlined,
                              tonal: true,
                              onPressed: _locked ? null : _openManualEntry,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),

            // Result panel: a floating card that stops above the tab bar (and
            // its raised Scan button), so the bar never sits on the colour.
            if (_currentResult != null)
              Positioned(
                left: 12,
                right: 12,
                bottom: bottomInset + (bottomInset > 60 ? 22 : 12),
                child: SlideTransition(
                  position: Tween(begin: const Offset(0, 1.5), end: Offset.zero).animate(
                    CurvedAnimation(parent: _panelAnim, curve: Curves.easeOutCubic),
                  ),
                  child: _ResultPanel(
                    result: _currentResult!,
                    countdown: _countdown,
                    onViewPass: _viewPass,
                    onNext: _dismissResult,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _camera() {
    final ctrl = _scannerCtrl;
    if (ctrl == null || !widget.active) return const _CameraPlaceholder();
    return MobileScanner(
      controller: ctrl,
      onDetect: _onQRDetected,
      placeholderBuilder: (_) => const _CameraPlaceholder(starting: true),
      errorBuilder: (context, error) => ColoredBox(
        color: AppColors.ink100,
        child: EmptyState(
          icon: Icons.no_photography_outlined,
          title: 'Camera unavailable',
          message: 'Allow camera access in Settings, or type the ticket code instead.',
          actionLabel: 'Type a code',
          onAction: _openManualEntry,
        ),
      ),
    );
  }
}

class _CameraPlaceholder extends StatelessWidget {
  final bool starting;
  const _CameraPlaceholder({this.starting = false});
  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: AppColors.ink100,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: const BoxDecoration(color: AppColors.brandTint, shape: BoxShape.circle),
              child: const Icon(Icons.photo_camera_outlined, color: AppColors.brand, size: 28),
            ),
            const SizedBox(height: 10),
            Text(starting ? 'Starting camera…' : 'Camera is off',
                style: AppType.body(13, weight: FontWeight.w500, color: AppColors.ink500)),
          ],
        ),
      ),
    );
  }
}

class _Viewfinder extends StatelessWidget {
  final Widget camera;
  final bool onCamera;
  final bool busy;
  final String scanType;
  const _Viewfinder({required this.camera, required this.onCamera, required this.busy, required this.scanType});

  @override
  Widget build(BuildContext context) {
    final accent = scanType == 'gate_out' ? AppColors.marigold : (onCamera ? Colors.white : AppColors.brand);
    return ClipRRect(
      borderRadius: BorderRadius.circular(24),
      child: Stack(
        fit: StackFit.expand,
        children: [
          camera,
          IgnorePointer(
            child: Center(
              child: LayoutBuilder(builder: (context, c) {
                final side = (c.biggest.shortestSide * 0.72).clamp(120.0, 280.0);
                return SizedBox(
                  width: side,
                  height: side,
                  child: CustomPaint(painter: _CornerPainter(color: accent)),
                );
              }),
            ),
          ),
          if (busy)
            Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(999),
                  boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.12), blurRadius: 12)],
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.brand),
                    ),
                    const SizedBox(width: 10),
                    Text('Checking pass…', style: AppType.body(14, weight: FontWeight.w500)),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _HeaderCard extends StatelessWidget {
  final String title;
  final String gateName;
  final GateModel? gate;
  final bool locked;
  final bool warning;
  final GateStatsModel stats;
  final bool torchOn;
  final bool hasCamera;
  final VoidCallback onGateTap;
  final VoidCallback onTorch;
  final VoidCallback onFlip;

  const _HeaderCard({
    required this.title,
    required this.gateName,
    required this.gate,
    required this.locked,
    required this.warning,
    required this.stats,
    required this.torchOn,
    required this.hasCamera,
    required this.onGateTap,
    required this.onTorch,
    required this.onFlip,
  });

  @override
  Widget build(BuildContext context) {
    Widget stat(String label, int value, Color dot) => Expanded(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(Fmt.number(value), style: AppType.heading(20)),
              ),
              const SizedBox(height: 2),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(width: 6, height: 6, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
                  const SizedBox(width: 5),
                  Flexible(
                    child: Text(label,
                        maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.body(12, color: AppColors.ink500)),
                  ),
                ],
              ),
            ],
          ),
        );
    Widget divider() => Container(width: 0.5, height: 28, color: AppColors.separator);
    final gateColor = warning ? AppColors.marigoldDark : AppColors.brand;

    return GroupedSurface(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: Semantics(
                    button: true,
                    label: locked ? 'Gate $gateName, assigned by your organizer' : 'Change gate. Now scanning at $gateName',
                    child: InkWell(
                      borderRadius: BorderRadius.circular(10),
                      onTap: onGateTap,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.heading(19)),
                            const SizedBox(height: 4),
                            Row(
                              children: [
                                Icon(gate == null ? Icons.door_front_door_outlined : gateIcon(gate!),
                                    size: 16, color: gateColor),
                                const SizedBox(width: 5),
                                Flexible(
                                  child: Text(
                                    gateName,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: AppType.body(14, weight: FontWeight.w600, color: gateColor),
                                  ),
                                ),
                                if (gate?.isVip ?? false) ...[
                                  const SizedBox(width: 6),
                                  const StatusBadge('VIP', tone: Tone.warning, dot: false),
                                ],
                                const SizedBox(width: 2),
                                Icon(locked ? Icons.lock_outline_rounded : Icons.expand_more_rounded,
                                    size: locked ? 15 : 18, color: locked ? AppColors.ink400 : gateColor),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                if (hasCamera) ...[
                  AppIconButton(
                    icon: torchOn ? Icons.flashlight_on_rounded : Icons.flashlight_off_rounded,
                    tooltip: torchOn ? 'Turn off torch' : 'Turn on torch',
                    color: torchOn ? AppColors.marigoldDark : AppColors.brand,
                    background: torchOn ? AppColors.marigoldTint : AppColors.ink100,
                    onPressed: onTorch,
                  ),
                  const SizedBox(width: 8),
                  AppIconButton(
                    icon: Icons.cameraswitch_outlined,
                    tooltip: 'Switch camera',
                    background: AppColors.ink100,
                    onPressed: onFlip,
                  ),
                ],
              ],
            ),
          ),
          const Divider(height: 0.5),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
            child: Row(
              children: [
                stat('Inside', stats.currentlyInside, AppColors.brand),
                divider(),
                stat('Checked in', stats.checkedIn, AppColors.success),
                divider(),
                stat('Out', stats.checkedOut, AppColors.marigold),
                divider(),
                stat('Registered', stats.totalRegistered, AppColors.ink300),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  final IconData icon;
  final String text;
  final Widget? action;
  const _Notice({required this.icon, required this.text, this.action});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(12, 8, action == null ? 12 : 6, 8),
      constraints: const BoxConstraints(minHeight: 48),
      decoration: BoxDecoration(
        color: AppColors.marigoldTint,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.marigold.withValues(alpha: 0.35), width: 0.5),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.marigoldDark),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: AppType.body(13, weight: FontWeight.w500, color: AppColors.ink800))),
          if (action != null) action!,
        ],
      ),
    );
  }
}

class _OfflineNotice extends StatelessWidget {
  final bool online;
  final int queued;
  final VoidCallback onSync;
  const _OfflineNotice({required this.online, required this.queued, required this.onSync});

  @override
  Widget build(BuildContext context) {
    final text = !online
        ? (queued > 0
            ? "You're offline. ${Fmt.plural(queued, 'scan')} saved on this phone."
            : "You're offline. Scans will be saved on this phone.")
        : '${Fmt.plural(queued, 'scan')} waiting to sync.';
    return _Notice(
      icon: online ? Icons.cloud_upload_outlined : Icons.wifi_off_rounded,
      text: text,
      action: queued > 0
          ? TextButton(
              onPressed: onSync,
              style: TextButton.styleFrom(
                foregroundColor: AppColors.marigoldDark,
                minimumSize: const Size(64, AppSpace.tap),
              ),
              child: Text('Sync now', style: AppType.body(14, weight: FontWeight.w600, color: AppColors.marigoldDark)),
            )
          : null,
    );
  }
}

class _CornerPainter extends CustomPainter {
  final Color color;
  _CornerPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = color
      ..strokeWidth = 4
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    const len = 34.0, r = 18.0;
    final w = size.width, h = size.height;
    // top-left
    canvas.drawPath(
        Path()
          ..moveTo(0, len)
          ..lineTo(0, r)
          ..arcToPoint(const Offset(r, 0), radius: const Radius.circular(r))
          ..lineTo(len, 0),
        p);
    // top-right
    canvas.drawPath(
        Path()
          ..moveTo(w - len, 0)
          ..lineTo(w - r, 0)
          ..arcToPoint(Offset(w, r), radius: const Radius.circular(r))
          ..lineTo(w, len),
        p);
    // bottom-right
    canvas.drawPath(
        Path()
          ..moveTo(w, h - len)
          ..lineTo(w, h - r)
          ..arcToPoint(Offset(w - r, h), radius: const Radius.circular(r))
          ..lineTo(w - len, h),
        p);
    // bottom-left
    canvas.drawPath(
        Path()
          ..moveTo(len, h)
          ..lineTo(r, h)
          ..arcToPoint(Offset(0, h - r), radius: const Radius.circular(r))
          ..lineTo(0, h - len),
        p);
  }

  @override
  bool shouldRepaint(_CornerPainter old) => old.color != color;
}

/// Full-width solid result panel: colour, icon and headline say what to do.
class _ResultPanel extends StatelessWidget {
  final ScanResultModel result;
  final Animation<double> countdown;
  final VoidCallback onViewPass;
  final VoidCallback onNext;

  const _ResultPanel({
    required this.result,
    required this.countdown,
    required this.onViewPass,
    required this.onNext,
  });

  @override
  Widget build(BuildContext context) {
    final copy = ScanCopy.of(result);
    final bg = switch (copy.tone) {
      Tone.success => AppColors.success,
      Tone.warning => AppColors.marigold,
      _ => AppColors.danger,
    };
    final onWarning = copy.tone == Tone.warning;
    final fg = onWarning ? AppColors.ink950 : Colors.white;
    final fgSoft = onWarning ? AppColors.ink900.withValues(alpha: 0.8) : Colors.white.withValues(alpha: 0.88);
    final name = result.attendeeName;
    final type = result.ticketType;
    // Payment and ID checks only apply when letting someone in for the first time.
    final admitting = result.isSuccess && result.scanType != 'gate_out' && result.rawData?['status'] != 're_entry';
    final collect = admitting && type.hasPriceDue;
    final note = admitting && type.hasGateNote;

    return Semantics(
      liveRegion: true,
      label: [
        copy.title,
        if (name != null && name.isNotEmpty) name,
        if (type.hasName) '${type.name} ticket',
        if (note) type.gateNote,
        if (collect) 'Collect ${type.priceLabel}',
      ].join('. '),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(28),
          boxShadow: [BoxShadow(color: bg.withValues(alpha: 0.35), blurRadius: 24, offset: const Offset(0, 8))],
        ),
        child: Material(
          color: bg,
          borderRadius: BorderRadius.circular(28),
          clipBehavior: Clip.antiAlias,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AnimatedBuilder(
                animation: countdown,
                builder: (_, __) => LinearProgressIndicator(
                  value: 1 - countdown.value,
                  minHeight: 3,
                  backgroundColor: Colors.transparent,
                  color: fg.withValues(alpha: 0.45),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 22, 24, 20),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 56,
                            height: 56,
                            decoration: BoxDecoration(
                              color: onWarning ? AppColors.ink950.withValues(alpha: 0.12) : Colors.white.withValues(alpha: 0.2),
                              shape: BoxShape.circle,
                            ),
                            child: Icon(copy.icon, size: 34, color: fg),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Text(
                              copy.title,
                              style: AppType.heading(32, weight: FontWeight.w800, color: fg),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      if (name != null && name.isNotEmpty)
                        Text(name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: AppType.heading(26, weight: FontWeight.w700, color: fg)),
                      if (result.ticketCode != null && result.ticketCode!.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(result.ticketCode!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppType.mono(18, weight: FontWeight.w600, color: fg)),
                      ],
                      if (type.hasName) ...[
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [_TypePill(label: type.name.toUpperCase(), onWarning: onWarning)],
                        ),
                      ],
                      if (collect) ...[
                        const SizedBox(height: 12),
                        _CollectBanner(amount: type.priceLabel, promoCode: type.promoCode),
                      ] else if (admitting && type.paymentNote != null) ...[
                        const SizedBox(height: 10),
                        Row(children: [
                          Icon(Icons.verified_rounded, size: 18, color: fg),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(type.paymentNote!,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: AppType.body(14, weight: FontWeight.w600, color: fg)),
                          ),
                        ]),
                      ],
                      if (note) ...[
                        const SizedBox(height: 12),
                        _GateNote(text: type.gateNote),
                      ],
                      const SizedBox(height: 8),
                      Text(result.message,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: AppType.body(14, color: fgSoft)),
                      const SizedBox(height: 18),
                      Row(
                        children: [
                          Expanded(
                            child: _PanelButton(
                              label: 'View pass',
                              filled: false,
                              dark: onWarning,
                              onTap: onViewPass,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: _PanelButton(
                              label: 'Scan next',
                              filled: true,
                              dark: onWarning,
                              onTap: onNext,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Pay-at-the-venue ticket: the money to take before letting them in, impossible to miss.
class _CollectBanner extends StatelessWidget {
  final String amount;
  final String? promoCode;
  const _CollectBanner({required this.amount, this.promoCode});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18)),
      child: Row(children: [
        const Icon(Icons.payments_rounded, size: 34, color: AppColors.success),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text('COLLECT AT THE GATE',
                style: AppType.body(12, weight: FontWeight.w700, color: AppColors.ink600).copyWith(letterSpacing: 1.1)),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(amount, style: AppType.heading(34, weight: FontWeight.w800, color: AppColors.ink950)),
            ),
            Text(
              promoCode == null ? 'Not paid yet: pay at the venue' : 'Not paid yet: pay at the venue (code $promoCode)',
              style: AppType.body(12.5, weight: FontWeight.w500, color: AppColors.ink600),
            ),
          ]),
        ),
      ]),
    );
  }
}

/// Large pill on the result panel: the ticket type ("STUDENT").
class _TypePill extends StatelessWidget {
  final String label;
  final bool onWarning;
  const _TypePill({required this.label, required this.onWarning});

  @override
  Widget build(BuildContext context) {
    final fg = onWarning ? AppColors.ink950 : Colors.white;
    final style = AppType.heading(16, weight: FontWeight.w800, color: fg, height: 1.2);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: BoxDecoration(
        color: onWarning ? AppColors.ink950.withValues(alpha: 0.12) : Colors.white.withValues(alpha: 0.22),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: fg.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: style.copyWith(letterSpacing: 1.2),
            ),
          ),
        ],
      ),
    );
  }
}

/// Instruction the organizer set for this ticket type, e.g. "Check student ID".
class _GateNote extends StatelessWidget {
  final String text;
  const _GateNote({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 10, 14, 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Row(
        children: [
          const Icon(Icons.badge_outlined, size: 22, color: AppColors.ink900),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: AppType.body(16, weight: FontWeight.w700, color: AppColors.ink900),
            ),
          ),
        ],
      ),
    );
  }
}

class _PanelButton extends StatelessWidget {
  final String label;
  final bool filled;
  final bool dark;
  final VoidCallback onTap;
  const _PanelButton({required this.label, required this.filled, required this.dark, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final bg = filled ? Colors.white : (dark ? Colors.white.withValues(alpha: 0.35) : Colors.white.withValues(alpha: 0.16));
    final fg = filled ? AppColors.textPrimary : (dark ? AppColors.ink900 : Colors.white);
    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.md),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 50),
          child: Center(
            child: Text(label, style: AppType.body(16, weight: FontWeight.w600, color: fg)),
          ),
        ),
      ),
    );
  }
}
