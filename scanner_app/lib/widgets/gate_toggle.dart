import 'package:flutter/material.dart';
import '../core/theme.dart';

class GateToggle extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;

  const GateToggle({super.key, required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.65),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withOpacity(0.15)),
      ),
      child: Row(
        children: [
          _Toggle(
            label: '⬇  Gate In',
            subLabel: 'Entry Verification',
            selected: value == 'gate_in',
            color: AppColors.gateIn,
            onTap: () => onChanged('gate_in'),
          ),
          const SizedBox(width: 6),
          _Toggle(
            label: '⬆  Gate Out',
            subLabel: 'Exit Audit',
            selected: value == 'gate_out',
            color: AppColors.gateOut,
            onTap: () => onChanged('gate_out'),
          ),
        ],
      ),
    );
  }
}

class _Toggle extends StatelessWidget {
  final String label;
  final String subLabel;
  final bool selected;
  final Color color;
  final VoidCallback onTap;

  const _Toggle({
    required this.label,
    required this.subLabel,
    required this.selected,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: selected ? color.withOpacity(0.2) : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: selected ? color : Colors.transparent,
              width: 1.5,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: selected ? color : Colors.white60,
                  fontWeight: selected ? FontWeight.w800 : FontWeight.w500,
                  fontSize: 15,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subLabel,
                style: TextStyle(
                  color: selected ? color.withOpacity(0.8) : Colors.white38,
                  fontSize: 10,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
