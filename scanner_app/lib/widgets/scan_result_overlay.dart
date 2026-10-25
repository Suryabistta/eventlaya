import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../models/scan_result_model.dart';

class ScanResultOverlay extends StatefulWidget {
  final ScanResultModel result;

  const ScanResultOverlay({super.key, required this.result});

  @override
  State<ScanResultOverlay> createState() => _ScanResultOverlayState();
}

class _ScanResultOverlayState extends State<ScanResultOverlay>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  late Animation<double> _scaleAnim;
  late Animation<double> _fadeAnim;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 350));
    _scaleAnim = Tween<double>(begin: 0.6, end: 1.0).animate(
      CurvedAnimation(parent: _ctrl, curve: Curves.easeOutBack),
    );
    _fadeAnim = Tween<double>(begin: 0, end: 1).animate(
      CurvedAnimation(parent: _ctrl, curve: const Interval(0, 0.4)),
    );
    _ctrl.forward();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Color get _bgColor {
    if (widget.result.isSuccess) return AppColors.success.withOpacity(0.96);
    if (widget.result.isWarning) return AppColors.warning.withOpacity(0.96);
    return AppColors.error.withOpacity(0.96);
  }

  IconData get _icon {
    if (widget.result.isSuccess) return Icons.check_circle_rounded;
    if (widget.result.isWarning) return Icons.warning_amber_rounded;
    return Icons.cancel_rounded;
  }

  String get _title {
    switch (widget.result.outcome) {
      case ScanOutcome.success:
        return widget.result.scanType == 'gate_in' ? 'Welcome In! ✓' : 'Checked Out! ✓';
      case ScanOutcome.alreadyIn:
        return 'Already Inside';
      case ScanOutcome.alreadyOut:
        return 'Already Checked Out';
      case ScanOutcome.notCheckedIn:
        return 'Not Checked In';
      case ScanOutcome.invalidToken:
        return 'Invalid Ticket';
      case ScanOutcome.cancelled:
        return 'Ticket Cancelled';
      case ScanOutcome.wrongEvent:
        return 'Wrong Event';
      case ScanOutcome.capacityFull:
        return 'Capacity Reached';
      case ScanOutcome.networkError:
        return 'Queued Offline';
      default:
        return 'Scan Alert';
    }
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _fadeAnim,
      child: Container(
        color: _bgColor,
        width: double.infinity,
        height: double.infinity,
        child: SafeArea(
          child: Center(
            child: ScaleTransition(
              scale: _scaleAnim,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 28),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.2),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(_icon, size: 84, color: Colors.white),
                    ),
                    const SizedBox(height: 24),
                    Text(
                      _title,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 28,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.5,
                      ),
                    ),
                    if (widget.result.attendeeName != null &&
                        widget.result.attendeeName!.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text(
                        widget.result.attendeeName!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 22,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                    const SizedBox(height: 10),
                    Text(
                      widget.result.message,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white.withOpacity(0.92),
                        fontSize: 15,
                        height: 1.3,
                      ),
                    ),
                    if (widget.result.gateName != null) ...[
                      const SizedBox(height: 18),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        decoration: BoxDecoration(
                          color: Colors.black.withOpacity(0.25),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          '📍 ${widget.result.gateName}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
