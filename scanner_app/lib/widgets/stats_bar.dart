import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../models/gate_stats_model.dart';

class StatsBar extends StatelessWidget {
  final GateStatsModel stats;
  final String scanType;

  const StatsBar({super.key, required this.stats, required this.scanType});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.75),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withOpacity(0.12)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.3),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _Stat(label: 'Registered', value: '${stats.totalRegistered}', color: Colors.white),
          _Divider(),
          _Stat(label: 'Checked In', value: '${stats.checkedIn}', color: AppColors.success),
          _Divider(),
          _Stat(label: 'Exited', value: '${stats.checkedOut}', color: AppColors.warning),
          _Divider(),
          _Stat(label: 'Inside Now', value: '${stats.currentlyInside}', color: AppColors.secondary),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _Stat({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(value, style: TextStyle(color: color, fontSize: 17, fontWeight: FontWeight.w700)),
        const SizedBox(height: 1),
        Text(label, style: const TextStyle(color: Colors.white60, fontSize: 10)),
      ],
    );
  }
}

class _Divider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(width: 1, height: 26, color: Colors.white.withOpacity(0.15));
  }
}
