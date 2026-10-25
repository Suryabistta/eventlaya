import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:vibration/vibration.dart';
import '../../core/theme.dart';
import '../../models/scan_result_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/event_provider.dart';
import '../../providers/scan_provider.dart';
import '../../widgets/scan_result_overlay.dart';
import '../../widgets/stats_bar.dart';
import '../../widgets/offline_banner.dart';
import '../../widgets/gate_toggle.dart';
import '../../widgets/ticket_detail_sheet.dart';
import '../login_screen.dart';
import 'gate_select_screen.dart';

class ScannerScreen extends ConsumerStatefulWidget {
  const ScannerScreen({super.key});

  @override
  ConsumerState<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends ConsumerState<ScannerScreen>
    with WidgetsBindingObserver {
  late MobileScannerController _scannerCtrl;

  String _scanType = 'gate_in'; // 'gate_in' or 'gate_out'
  bool _showOverlay = false;
  ScanResultModel? _currentResult;
  bool _torchOn = false;
  final _manualCtrl = TextEditingController();
  bool _showManualInput = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _scannerCtrl = MobileScannerController(
      detectionSpeed: DetectionSpeed.noDuplicates,
      facing: CameraFacing.back,
      torchEnabled: false,
    );
    _enableWakelock();
  }

  Future<void> _enableWakelock() async {
    try {
      await WakelockPlus.enable();
    } catch (_) {}
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    try {
      WakelockPlus.disable();
    } catch (_) {}
    _scannerCtrl.dispose();
    _manualCtrl.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      _scannerCtrl.stop();
    } else if (state == AppLifecycleState.resumed) {
      if (!_showOverlay) _scannerCtrl.start();
    }
  }

  Future<void> _onQRDetected(BarcodeCapture capture) async {
    if (_showOverlay) return; // Locked while overlay is showing
    final code = capture.barcodes.firstOrNull?.rawValue;
    if (code == null || code.trim().isEmpty) return;

    await _processScan(code.trim());
  }

  Future<void> _processScan(String token) async {
    if (_showOverlay) return;

    final eventState = ref.read(eventProvider);
    if (eventState.currentEvent == null) return;

    setState(() {
      _showOverlay = true;
      _showManualInput = false;
    });

    try {
      await _scannerCtrl.stop();
    } catch (_) {}

    final result = await ref.read(scanProvider.notifier).scan(
      qrToken: token,
      scanType: _scanType,
      gateName: eventState.selectedGate ?? 'Main Gate',
      eventId: eventState.currentEvent!.id,
    );

    if (!mounted) return;
    setState(() => _currentResult = result);
    _triggerHaptics(result);

    // Refresh gate stats immediately
    ref.read(eventProvider.notifier).fetchStats(eventState.currentEvent!.id);

    // Auto-dismiss overlay after 2.5 seconds to resume scanner
    await Future.delayed(const Duration(milliseconds: 2500));
    if (mounted) {
      setState(() {
        _showOverlay = false;
        _currentResult = null;
      });
      try {
        await _scannerCtrl.start();
      } catch (_) {}
    }
  }

  Future<void> _triggerHaptics(ScanResultModel result) async {
    try {
      final hasVibrator = await Vibration.hasVibrator() ?? false;
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

  @override
  Widget build(BuildContext context) {
    final eventState = ref.watch(eventProvider);
    final scanState = ref.watch(scanProvider);
    final user = ref.watch(authProvider).user;

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // 1. Live Camera Feed
          MobileScanner(
            controller: _scannerCtrl,
            onDetect: _onQRDetected,
          ),

          // 2. Top Vignette Gradient
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: Container(
              height: 190,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Colors.black.withOpacity(0.9), Colors.transparent],
                ),
              ),
            ),
          ),

          // 3. Top Header Bar & Stats
          SafeArea(
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.arrow_back_ios_new, color: Colors.white, size: 20),
                        onPressed: () => Navigator.of(context).pushReplacement(
                          MaterialPageRoute(builder: (_) => const GateSelectScreen()),
                        ),
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              eventState.currentEvent?.title ?? 'Eventlaya Gate',
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w700,
                                fontSize: 15,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              '${eventState.selectedGate ?? "Main Gate"} • ${user?.fullName ?? ""}',
                              style: TextStyle(
                                color: Colors.white.withOpacity(0.7),
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                      // Flashlight toggle
                      IconButton(
                        icon: Icon(
                          _torchOn ? Icons.flash_on_rounded : Icons.flash_off_rounded,
                          color: _torchOn ? Colors.amberAccent : Colors.white70,
                        ),
                        onPressed: () {
                          _scannerCtrl.toggleTorch();
                          setState(() => _torchOn = !_torchOn);
                        },
                      ),
                      // Camera flip
                      IconButton(
                        icon: const Icon(Icons.flip_camera_android_rounded, color: Colors.white70),
                        onPressed: () => _scannerCtrl.switchCamera(),
                      ),
                      // Logout
                      IconButton(
                        icon: const Icon(Icons.logout_rounded, color: Colors.white70, size: 20),
                        onPressed: () async {
                          await ref.read(authProvider.notifier).logout();
                          if (context.mounted) {
                            Navigator.of(context).pushReplacement(
                              MaterialPageRoute(builder: (_) => const LoginScreen()),
                            );
                          }
                        },
                      ),
                    ],
                  ),
                ),

                // Offline status banner if disconnected
                if (!scanState.isOnline)
                  OfflineBanner(queuedCount: scanState.offlineQueueCount),

                // Real-time Attendance Stats Bar
                if (eventState.currentEvent != null)
                  StatsBar(stats: eventState.stats, scanType: _scanType),
              ],
            ),
          ),

          // 4. Scanner Reticle Box Guide
          if (!_showOverlay)
            Center(
              child: Container(
                width: 260,
                height: 260,
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.white.withOpacity(0.4), width: 1.5),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Stack(
                  children: [
                    // Corner highlights
                    ...[(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)].map((pos) {
                      return Positioned(
                        left: pos.$1 == 0 ? -2 : null,
                        right: pos.$1 == 1 ? -2 : null,
                        top: pos.$2 == 0 ? -2 : null,
                        bottom: pos.$2 == 1 ? -2 : null,
                        child: Container(
                          width: 28,
                          height: 28,
                          decoration: BoxDecoration(
                            border: Border(
                              left: pos.$1 == 0
                                  ? const BorderSide(color: AppColors.primary, width: 4)
                                  : BorderSide.none,
                              right: pos.$1 == 1
                                  ? const BorderSide(color: AppColors.primary, width: 4)
                                  : BorderSide.none,
                              top: pos.$2 == 0
                                  ? const BorderSide(color: AppColors.primary, width: 4)
                                  : BorderSide.none,
                              bottom: pos.$2 == 1
                                  ? const BorderSide(color: AppColors.primary, width: 4)
                                  : BorderSide.none,
                            ),
                          ),
                        ),
                      );
                    }),
                    Center(
                      child: Text(
                        'Align QR Code',
                        style: TextStyle(
                          color: Colors.white.withOpacity(0.5),
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

          // 5. Bottom Controls Gradient
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: Container(
              height: 290,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: [Colors.black.withOpacity(0.95), Colors.transparent],
                ),
              ),
            ),
          ),

          // 6. Bottom Action Controls
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Gate In / Gate Out Switcher
                    GateToggle(
                      value: _scanType,
                      onChanged: (v) => setState(() => _scanType = v),
                    ),

                    const SizedBox(height: 14),

                    // Manual Entry Button + Offline Queue Indicator
                    Row(
                      children: [
                        Expanded(
                          child: InkWell(
                            onTap: () => setState(() => _showManualInput = !_showManualInput),
                            borderRadius: BorderRadius.circular(12),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.12),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: Colors.white.withOpacity(0.2)),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  const Icon(Icons.keyboard_outlined, color: Colors.white70, size: 20),
                                  const SizedBox(width: 8),
                                  Text(
                                    _showManualInput ? 'Hide Manual Input' : 'Enter Ticket Token Manually',
                                    style: TextStyle(
                                      color: Colors.white.withOpacity(0.85),
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        if (scanState.offlineQueueCount > 0) ...[
                          const SizedBox(width: 10),
                          InkWell(
                            onTap: () => ref.read(scanProvider.notifier).flushOfflineQueue(),
                            borderRadius: BorderRadius.circular(12),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                              decoration: BoxDecoration(
                                color: AppColors.warning.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: AppColors.warning.withOpacity(0.4)),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.cloud_upload_outlined, color: AppColors.warning, size: 18),
                                  const SizedBox(width: 6),
                                  Text(
                                    '${scanState.offlineQueueCount} queued',
                                    style: const TextStyle(
                                      color: AppColors.warning,
                                      fontWeight: FontWeight.w700,
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),

                    // Manual input field
                    if (_showManualInput) ...[
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _manualCtrl,
                              autofocus: true,
                              style: const TextStyle(color: Colors.white, fontSize: 14),
                              decoration: InputDecoration(
                                hintText: 'Paste or type QR token / TKT-XXXX...',
                                hintStyle: TextStyle(color: Colors.white.withOpacity(0.4)),
                                filled: true,
                                fillColor: Colors.white.withOpacity(0.12),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(10),
                                  borderSide: BorderSide.none,
                                ),
                                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                              ),
                              onSubmitted: (v) {
                                if (v.trim().isNotEmpty) {
                                  _manualCtrl.clear();
                                  _processScan(v.trim());
                                }
                              },
                            ),
                          ),
                          const SizedBox(width: 8),
                          ElevatedButton(
                            onPressed: () {
                              final token = _manualCtrl.text.trim();
                              if (token.isNotEmpty) {
                                _manualCtrl.clear();
                                _processScan(token);
                              }
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.primary,
                              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                            child: const Icon(Icons.send_rounded, size: 18),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),

          // 7. Full-Screen Feedback Overlay
          if (_showOverlay && _currentResult != null)
            GestureDetector(
              onTap: () => TicketDetailSheet.show(context, _currentResult!),
              child: ScanResultOverlay(result: _currentResult!),
            ),
        ],
      ),
    );
  }
}
