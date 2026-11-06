import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../core/api_client.dart';
import '../../providers/event_provider.dart';
import '../../ui/ui.dart';
import '../common/format.dart';

class ScanLogsScreen extends ConsumerStatefulWidget {
  const ScanLogsScreen({super.key});

  @override
  ConsumerState<ScanLogsScreen> createState() => _ScanLogsScreenState();
}

class _ScanLogsScreenState extends ConsumerState<ScanLogsScreen> {
  final _api = ApiClient();
  List<Map<String, dynamic>> _logs = [];
  bool _loading = true;
  String? _error;
  String _filter = 'all'; // 'all', 'gate_in', 'gate_out'

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final event = ref.read(eventProvider).currentEvent;
    if (event == null) {
      setState(() => _loading = false);
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get('/api/events/${event.id}/gate/stats/');
      final data = resp.data as Map<String, dynamic>;
      final scans = (data['recent_scans'] as List? ?? [])
          .map((s) => Map<String, dynamic>.from(s as Map))
          .toList();
      if (mounted) setState(() => _logs = scans);
    } on DioException catch (e) {
      if (mounted) setState(() => _error = _api.errorMessage(e));
    } catch (e) {
      if (mounted) setState(() => _error = 'Something went wrong: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final event = ref.watch(eventProvider).currentEvent;
    final filtered = _filter == 'all' ? _logs : _logs.where((l) => l['scan_type'] == _filter).toList();

    return AppScaffold(
      title: 'Scan logs',
      onRefresh: _load,
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: FilterPills<String>(
              selected: _filter,
              onChanged: (v) => setState(() => _filter = v),
              segments: [
                Segment('all', 'All', count: _logs.length),
                Segment('gate_in', 'Gate in', count: _logs.where((l) => l['scan_type'] == 'gate_in').length),
                Segment('gate_out', 'Gate out', count: _logs.where((l) => l['scan_type'] == 'gate_out').length),
              ],
            ),
          ),
        ),
        if (event == null)
          const SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.event_outlined,
              title: 'No event selected',
              message: 'Pick an event on the Home tab first.',
            ),
          )
        else if (_error != null && _logs.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: ErrorState(title: "Couldn't load scan logs", message: _error!, onRetry: _load),
          )
        else if (_loading && _logs.isEmpty)
          const SliverToBoxAdapter(child: LoadingList())
        else if (filtered.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.history_toggle_off_rounded,
              title: 'No scans yet',
              message: 'Every gate in and gate out is listed here as it happens.',
              actionLabel: 'Refresh',
              actionIcon: Icons.refresh_rounded,
              onAction: _load,
            ),
          )
        else
          SliverToBoxAdapter(
            child: GroupedSection(
              header: 'Latest ${Fmt.plural(filtered.length, 'scan')}',
              separatorInset: 68,
              children: [for (final log in filtered) _LogRow(log: log)],
            ),
          ),
      ],
    );
  }
}

class _LogRow extends StatelessWidget {
  final Map<String, dynamic> log;
  const _LogRow({required this.log});

  @override
  Widget build(BuildContext context) {
    final isIn = log['scan_type'] == 'gate_in';
    final result = log['result']?.toString() ?? 'success';
    final tone = isIn ? Tone.success : Tone.warning;
    final ok = result == 'success' || result == 'gate_in' || result == 'gate_out' || result == 're_entry';
    final code = log['ticket_number']?.toString();

    return ListRow(
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(color: tone.tint, shape: BoxShape.circle),
        child: Icon(isIn ? Icons.login_rounded : Icons.logout_rounded, size: 20, color: tone.strong),
      ),
      title: log['attendee_name']?.toString() ?? 'Attendee',
      subtitleWidget: Text.rich(
        TextSpan(children: [
          if (code != null && code.isNotEmpty) ...[
            TextSpan(text: code, style: AppType.mono(12, color: AppColors.ink600)),
            const TextSpan(text: '  ·  '),
          ],
          TextSpan(
            text: [
              if ((log['gate_name']?.toString() ?? '').isNotEmpty) log['gate_name'].toString(),
              Fmt.timeIso(log['scanned_at']?.toString()),
            ].join(' · '),
          ),
        ]),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppType.rowSubtitle,
      ),
      trailing: ok
          ? StatusBadge(isIn ? 'In' : 'Out', tone: tone)
          : StatusBadge(result == 'duplicate' ? 'Duplicate' : TicketStatus.sentence(result), tone: Tone.danger),
    );
  }
}
