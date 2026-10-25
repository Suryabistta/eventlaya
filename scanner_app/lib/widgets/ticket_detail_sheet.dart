import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../models/scan_result_model.dart';

class TicketDetailSheet extends StatelessWidget {
  final ScanResultModel result;

  const TicketDetailSheet({super.key, required this.result});

  static void show(BuildContext context, ScanResultModel result) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.cardBg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => TicketDetailSheet(result: result),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 44,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.divider,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 20),
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: (result.isSuccess
                          ? AppColors.success
                          : result.isWarning
                              ? AppColors.warning
                              : AppColors.error)
                      .withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  result.isSuccess
                      ? Icons.check_circle_rounded
                      : result.isWarning
                          ? Icons.warning_rounded
                          : Icons.error_rounded,
                  color: result.isSuccess
                      ? AppColors.success
                      : result.isWarning
                          ? AppColors.warning
                          : AppColors.error,
                  size: 28,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      result.attendeeName ?? 'Unknown Attendee',
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w700,
                        fontSize: 16,
                      ),
                    ),
                    Text(
                      result.message,
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          const Divider(color: AppColors.divider),
          const SizedBox(height: 12),
          if (result.ticketCode != null)
            _Row('Ticket Code', result.ticketCode!),
          if (result.scanType != null)
            _Row('Scan Type', result.scanType == 'gate_in' ? '⬇ Gate In' : '⬆ Gate Out'),
          if (result.gateName != null)
            _Row('Gate', result.gateName!),
          if (result.scannedAt != null)
            _Row('Timestamp', result.scannedAt!.toLocal().toString().substring(0, 19)),
          const SizedBox(height: 16),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final String label;
  final String value;
  const _Row(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
