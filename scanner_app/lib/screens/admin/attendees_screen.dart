import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../core/api_client.dart';
import '../../core/theme.dart';
import '../../providers/event_provider.dart';

class AttendeesScreen extends ConsumerStatefulWidget {
  const AttendeesScreen({super.key});

  @override
  ConsumerState<AttendeesScreen> createState() => _AttendeesScreenState();
}

class _AttendeesScreenState extends ConsumerState<AttendeesScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();
  List<Map<String, dynamic>> _attendees = [];
  bool _loading = false;
  String _statusFilter = 'all';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load([String? search]) async {
    final eventId = ref.read(eventProvider).currentEvent?.id;
    if (eventId == null) return;
    setState(() => _loading = true);
    try {
      final resp = await _api.get(
        '/api/events/$eventId/tickets/',
        queryParameters: search != null && search.isNotEmpty ? {'search': search} : null,
      );
      final data = resp.data;
      final list = (data is List)
          ? data
          : (data is Map && data['results'] is List)
              ? data['results'] as List
              : [];
      setState(() => _attendees = List<Map<String, dynamic>>.from(list));
    } catch (_) {} finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _quickGateScan(String qrToken, String scanType, String attendeeName) async {
    final eventId = ref.read(eventProvider).currentEvent?.id;
    if (eventId == null) return;

    try {
      final resp = await _api.post('/api/events/$eventId/gate/scan/', data: {
        'qr_token': qrToken,
        'scan_type': scanType,
        'gate_name': 'Admin Override',
      });
      final msg = resp.data['message']?.toString() ?? 'Scan recorded';
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(msg),
            backgroundColor: AppColors.success,
            duration: const Duration(seconds: 2),
          ),
        );
      }
      _load(_searchCtrl.text);
      ref.read(eventProvider.notifier).fetchStats(eventId);
    } on DioException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_api.errorMessage(e)),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  String _statusLabel(String? status) {
    switch (status) {
      case 'checked_in':
        return 'CHECKED IN';
      case 'checked_out':
        return 'CHECKED OUT';
      case 'valid':
        return 'REGISTERED';
      case 'cancelled':
        return 'CANCELLED';
      default:
        return status?.toUpperCase() ?? '—';
    }
  }

  Color _statusColor(String? status) {
    switch (status) {
      case 'checked_in':
        return AppColors.success;
      case 'checked_out':
        return AppColors.warning;
      case 'cancelled':
        return AppColors.error;
      default:
        return AppColors.textSecondary;
    }
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _attendees.where((a) {
      if (_statusFilter == 'all') return true;
      return a['status'] == _statusFilter;
    }).toList();

    return Column(
      children: [
        // Search & Filter Box
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: TextField(
            controller: _searchCtrl,
            style: const TextStyle(color: AppColors.textPrimary),
            onChanged: (v) => _load(v),
            decoration: InputDecoration(
              hintText: 'Search by attendee name or ticket code...',
              prefixIcon: const Icon(Icons.search, color: AppColors.textSecondary),
              suffixIcon: _searchCtrl.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear, color: AppColors.textSecondary),
                      onPressed: () {
                        _searchCtrl.clear();
                        _load();
                      },
                    )
                  : null,
            ),
          ),
        ),

        // Filter chips row
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Row(
            children: [
              _FilterChip(
                label: 'All (${_attendees.length})',
                selected: _statusFilter == 'all',
                onSelected: () => setState(() => _statusFilter = 'all'),
              ),
              const SizedBox(width: 8),
              _FilterChip(
                label: 'Checked In',
                selected: _statusFilter == 'checked_in',
                color: AppColors.success,
                onSelected: () => setState(() => _statusFilter = 'checked_in'),
              ),
              const SizedBox(width: 8),
              _FilterChip(
                label: 'Checked Out',
                selected: _statusFilter == 'checked_out',
                color: AppColors.warning,
                onSelected: () => setState(() => _statusFilter = 'checked_out'),
              ),
              const SizedBox(width: 8),
              _FilterChip(
                label: 'Registered',
                selected: _statusFilter == 'valid',
                onSelected: () => setState(() => _statusFilter = 'valid'),
              ),
            ],
          ),
        ),

        const SizedBox(height: 6),

        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : filtered.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.person_off_outlined, size: 48, color: AppColors.textSecondary),
                          const SizedBox(height: 12),
                          const Text(
                            'No matching attendees found',
                            style: TextStyle(color: AppColors.textSecondary, fontSize: 14),
                          ),
                          const SizedBox(height: 12),
                          ElevatedButton(
                            onPressed: () {
                              _searchCtrl.clear();
                              _load();
                            },
                            child: const Text('Reset Search'),
                          ),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: () => _load(_searchCtrl.text),
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                        itemCount: filtered.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) {
                          final a = filtered[i];
                          final status = a['status']?.toString();
                          final qrToken = a['qr_token']?.toString() ?? a['ticket_number']?.toString() ?? '';
                          final name = a['attendee_name']?.toString() ?? 'Attendee';
                          final isInside = status == 'checked_in';

                          return Container(
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              color: AppColors.cardBg,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: AppColors.divider, width: 0.5),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    CircleAvatar(
                                      radius: 20,
                                      backgroundColor: AppColors.primary.withOpacity(0.18),
                                      child: Text(
                                        name.substring(0, 1).toUpperCase(),
                                        style: const TextStyle(
                                          color: AppColors.primary,
                                          fontWeight: FontWeight.w700,
                                          fontSize: 15,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            name,
                                            style: const TextStyle(
                                              color: AppColors.textPrimary,
                                              fontWeight: FontWeight.w600,
                                              fontSize: 14,
                                            ),
                                          ),
                                          const SizedBox(height: 2),
                                          Text(
                                            a['attendee_email']?.toString() ?? '',
                                            style: const TextStyle(
                                              color: AppColors.textSecondary,
                                              fontSize: 12,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: _statusColor(status).withOpacity(0.12),
                                        borderRadius: BorderRadius.circular(6),
                                        border: Border.all(
                                          color: _statusColor(status).withOpacity(0.3),
                                          width: 0.5,
                                        ),
                                      ),
                                      child: Text(
                                        _statusLabel(status),
                                        style: TextStyle(
                                          color: _statusColor(status),
                                          fontSize: 10,
                                          fontWeight: FontWeight.w800,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                const Divider(color: AppColors.divider, height: 1),
                                const SizedBox(height: 10),
                                Row(
                                  children: [
                                    Text(
                                      a['ticket_number']?.toString() ?? '',
                                      style: TextStyle(
                                        color: Colors.white.withOpacity(0.6),
                                        fontSize: 12,
                                        fontFamily: 'monospace',
                                      ),
                                    ),
                                    const Spacer(),
                                    // Quick check-in / check-out button
                                    if (qrToken.isNotEmpty)
                                      TextButton.icon(
                                        onPressed: () => _quickGateScan(
                                          qrToken,
                                          isInside ? 'gate_out' : 'gate_in',
                                          name,
                                        ),
                                        icon: Icon(
                                          isInside ? Icons.logout : Icons.login,
                                          size: 14,
                                          color: isInside ? AppColors.warning : AppColors.success,
                                        ),
                                        label: Text(
                                          isInside ? 'Check Out' : 'Check In',
                                          style: TextStyle(
                                            color: isInside ? AppColors.warning : AppColors.success,
                                            fontSize: 12,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                      ),
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

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final Color? color;
  final VoidCallback onSelected;

  const _FilterChip({
    required this.label,
    required this.selected,
    this.color,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    final activeColor = color ?? AppColors.primary;
    return GestureDetector(
      onTap: onSelected,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? activeColor.withOpacity(0.2) : AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? activeColor : AppColors.divider,
            width: selected ? 1.5 : 0.5,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? activeColor : AppColors.textSecondary,
            fontSize: 12,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}
