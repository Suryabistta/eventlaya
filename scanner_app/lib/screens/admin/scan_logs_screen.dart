import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';
import '../../core/theme.dart';
import '../../providers/event_provider.dart';

class ScanLogsScreen extends ConsumerStatefulWidget {
  const ScanLogsScreen({super.key});

  @override
  ConsumerState<ScanLogsScreen> createState() => _ScanLogsScreenState();
}

class _ScanLogsScreenState extends ConsumerState<ScanLogsScreen> {
  final _api = ApiClient();
  List<Map<String, dynamic>> _logs = [];
  bool _loading = false;
  String _filter = 'all'; // 'all', 'gate_in', 'gate_out'

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final event = ref.read(eventProvider).currentEvent;
    if (event == null) return;
    setState(() => _loading = true);
    try {
      final resp = await _api.get('/api/events/${event.id}/gate/stats/');
      final data = resp.data as Map<String, dynamic>;
      final scans = (data['recent_scans'] as List? ?? [])
          .map((s) => Map<String, dynamic>.from(s as Map))
          .toList();
      setState(() => _logs = scans);
    } catch (_) {} finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filter == 'all'
        ? _logs
        : _logs.where((l) => l['scan_type'] == _filter).toList();

    return Column(
      children: [
        // Filter chips bar
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Row(
            children: [
              for (final f in [
                ('all', 'All Scans', AppColors.primary),
                ('gate_in', 'Gate In', AppColors.success),
                ('gate_out', 'Gate Out', AppColors.warning)
              ])
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(f.$2),
                    selected: _filter == f.$1,
                    selectedColor: f.$3.withOpacity(0.2),
                    labelStyle: TextStyle(
                      color: _filter == f.$1 ? f.$3 : AppColors.textSecondary,
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                    backgroundColor: AppColors.cardBg,
                    side: BorderSide(color: _filter == f.$1 ? f.$3 : AppColors.divider),
                    onSelected: (s) {
                      if (s) setState(() => _filter = f.$1);
                    },
                  ),
                ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.refresh, color: AppColors.textSecondary, size: 20),
                onPressed: _load,
              ),
            ],
          ),
        ),

        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : filtered.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.history_toggle_off, size: 48, color: AppColors.textSecondary),
                          const SizedBox(height: 12),
                          const Text(
                            'No scan activity recorded yet',
                            style: TextStyle(color: AppColors.textSecondary, fontSize: 14),
                          ),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                        itemCount: filtered.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) {
                          final log = filtered[i];
                          final isIn = log['scan_type'] == 'gate_in';
                          final timeStr = (log['scanned_at']?.toString() ?? '').replaceAll('T', ' ');
                          final result = log['result']?.toString() ?? 'success';

                          return Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: AppColors.cardBg,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: AppColors.divider, width: 0.5),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  width: 36,
                                  height: 36,
                                  decoration: BoxDecoration(
                                    color: (isIn ? AppColors.success : AppColors.warning)
                                        .withOpacity(0.12),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: Icon(
                                    isIn ? Icons.login_outlined : Icons.logout_outlined,
                                    size: 18,
                                    color: isIn ? AppColors.success : AppColors.warning,
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        log['attendee_name']?.toString() ?? 'Attendee',
                                        style: const TextStyle(
                                          color: AppColors.textPrimary,
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        '${log['gate_name'] ?? "Main Gate"} • ${timeStr.length > 16 ? timeStr.substring(0, 16) : timeStr}',
                                        style: const TextStyle(
                                          color: AppColors.textSecondary,
                                          fontSize: 11,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: (isIn ? AppColors.success : AppColors.warning)
                                            .withOpacity(0.12),
                                        borderRadius: BorderRadius.circular(6),
                                      ),
                                      child: Text(
                                        isIn ? 'IN' : 'OUT',
                                        style: TextStyle(
                                          color: isIn ? AppColors.success : AppColors.warning,
                                          fontSize: 10,
                                          fontWeight: FontWeight.w800,
                                        ),
                                      ),
                                    ),
                                    if (result == 'duplicate') ...[
                                      const SizedBox(height: 3),
                                      const Text(
                                        'DUPLICATE',
                                        style: TextStyle(
                                          color: AppColors.warning,
                                          fontSize: 9,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
        ),
      ],
    );
  }
}
