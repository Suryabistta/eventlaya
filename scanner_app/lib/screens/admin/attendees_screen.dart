import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../core/api_client.dart';
import '../../providers/event_provider.dart';
import '../../ui/ui.dart';
import '../common/passes.dart';

class AttendeesScreen extends ConsumerStatefulWidget {
  const AttendeesScreen({super.key});

  @override
  ConsumerState<AttendeesScreen> createState() => _AttendeesScreenState();
}

class _AttendeesScreenState extends ConsumerState<AttendeesScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();
  Timer? _debounce;
  int _requestId = 0;

  List<Map<String, dynamic>> _attendees = [];
  bool _loading = false;
  bool _loadedOnce = false;
  String? _error;
  String _statusFilter = 'all';
  final Set<String> _busyTokens = {};

  @override
  void initState() {
    super.initState();
    _load();
    // Reload when the organizer switches events.
    ref.listenManual(eventProvider.select((s) => s.currentEvent?.id), (prev, next) {
      if (prev != next) {
        _searchCtrl.clear();
        _load();
      }
    });
  }

  Future<void> _load([String? search]) async {
    final eventId = ref.read(eventProvider).currentEvent?.id;
    if (eventId == null) return;
    final id = ++_requestId;
    setState(() {
      _loading = true;
      _error = null;
    });
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
      if (!mounted || id != _requestId) return; // a newer search is in flight
      setState(() {
        _attendees = List<Map<String, dynamic>>.from(list);
        _loadedOnce = true;
      });
    } on DioException catch (e) {
      if (!mounted || id != _requestId) return;
      setState(() => _error = _api.errorMessage(e));
    } catch (e) {
      if (!mounted || id != _requestId) return;
      setState(() => _error = 'Something went wrong: $e');
    } finally {
      if (mounted && id == _requestId) setState(() => _loading = false);
    }
  }

  void _onSearchChanged(String v) {
    setState(() {});
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () => _load(v.trim()));
  }

  Future<void> _quickGateScan(String qrToken, String scanType, String attendeeName) async {
    final eventId = ref.read(eventProvider).currentEvent?.id;
    if (eventId == null) return;

    setState(() => _busyTokens.add(qrToken));
    try {
      final resp = await _api.post('/api/events/$eventId/gate/scan/', data: {
        'qr_token': qrToken,
        'scan_type': scanType,
        'gate_name': 'Admin Override',
      });
      final msg = resp.data is Map ? resp.data['message']?.toString() : null;
      if (mounted) {
        AppToast.success(
          context,
          msg ?? (scanType == 'gate_in' ? '$attendeeName checked in' : '$attendeeName checked out'),
        );
      }
      _load(_searchCtrl.text.trim());
      ref.read(eventProvider.notifier).fetchStats(eventId);
    } on DioException catch (e) {
      if (mounted) AppToast.error(context, _api.errorMessage(e));
    } finally {
      if (mounted) setState(() => _busyTokens.remove(qrToken));
    }
  }

  void _openPass(Map<String, dynamic> a) {
    final status = a['status']?.toString();
    final qrToken = a['qr_token']?.toString() ?? a['ticket_number']?.toString() ?? '';
    final name = a['attendee_name']?.toString() ?? 'Attendee';
    final isInside = status == 'checked_in';
    final event = ref.read(eventProvider).currentEvent;

    showTicketPassSheet(
      context,
      pass: passFromAttendee(a, event: event),
      actions: [
        if (qrToken.isNotEmpty && status != 'cancelled')
          Builder(
            builder: (ctx) => PrimaryButton(
              label: isInside ? 'Check out' : 'Check in',
              icon: isInside ? Icons.logout_rounded : Icons.login_rounded,
              tone: isInside ? ButtonTone.warning : ButtonTone.success,
              onPressed: () {
                Navigator.pop(ctx);
                _quickGateScan(qrToken, isInside ? 'gate_out' : 'gate_in', name);
              },
            ),
          ),
      ],
    );
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  int _count(String status) => _attendees.where((a) => a['status'] == status).length;

  @override
  Widget build(BuildContext context) {
    final event = ref.watch(eventProvider).currentEvent;
    final filtered = _attendees.where((a) {
      if (_statusFilter == 'all') return true;
      return a['status'] == _statusFilter;
    }).toList();
    final searching = _searchCtrl.text.trim().isNotEmpty;

    return AppScaffold(
      title: 'Attendees',
      onRefresh: event == null ? null : () => _load(_searchCtrl.text.trim()),
      slivers: [
        if (event == null)
          const SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.event_outlined,
              title: 'No event selected',
              message: 'Pick an event on the Home tab to see who registered.',
            ),
          )
        else ...[
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _SearchField(
                controller: _searchCtrl,
                onChanged: _onSearchChanged,
                onClear: () {
                  _searchCtrl.clear();
                  _onSearchChanged('');
                },
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: FilterPills<String>(
                selected: _statusFilter,
                onChanged: (v) => setState(() => _statusFilter = v),
                segments: [
                  Segment('all', 'All', count: _attendees.length),
                  Segment('checked_in', 'Checked in', count: _count('checked_in')),
                  Segment('checked_out', 'Checked out', count: _count('checked_out')),
                  Segment('valid', 'Registered', count: _count('valid')),
                ],
              ),
            ),
          ),
          if (_error != null && _attendees.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: ErrorState(
                title: "Couldn't load attendees",
                message: _error!,
                onRetry: () => _load(_searchCtrl.text.trim()),
              ),
            )
          else if (_loading && !_loadedOnce)
            const SliverToBoxAdapter(child: LoadingList())
          else if (filtered.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: searching || _statusFilter != 'all'
                  ? EmptyState(
                      icon: Icons.person_search_outlined,
                      title: 'No matches',
                      message: searching
                          ? 'No one matches "${_searchCtrl.text.trim()}". Try a name, email or ticket code.'
                          : 'No attendees with this status yet.',
                      actionLabel: 'Show everyone',
                      onAction: () {
                        _searchCtrl.clear();
                        setState(() => _statusFilter = 'all');
                        _load();
                      },
                    )
                  : const EmptyState(
                      icon: Icons.people_outline_rounded,
                      title: 'No registrations yet',
                      message: 'Share the event link so people can register. Their passes appear here.',
                    ),
            )
          else
            _AttendeeList(
              attendees: filtered,
              busyTokens: _busyTokens,
              onTap: _openPass,
            ),
        ],
      ],
    );
  }
}

class _SearchField extends StatelessWidget {
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;
  const _SearchField({required this.controller, required this.onChanged, required this.onClear});

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      textInputAction: TextInputAction.search,
      style: AppType.body(16),
      decoration: InputDecoration(
        hintText: 'Search name, email or ticket code',
        prefixIcon: const Icon(Icons.search_rounded),
        filled: true,
        fillColor: AppColors.ink100,
        contentPadding: const EdgeInsets.symmetric(vertical: 12),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.md), borderSide: BorderSide.none),
        enabledBorder:
            OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.md), borderSide: BorderSide.none),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          borderSide: const BorderSide(color: AppColors.brand, width: 1.5),
        ),
        suffixIcon: controller.text.isEmpty
            ? null
            : IconButton(tooltip: 'Clear search', icon: const Icon(Icons.cancel_rounded, size: 20), onPressed: onClear),
      ),
    );
  }
}

/// Phones: one inset-grouped list. Tablets: two grouped columns.
class _AttendeeList extends StatelessWidget {
  final List<Map<String, dynamic>> attendees;
  final Set<String> busyTokens;
  final ValueChanged<Map<String, dynamic>> onTap;
  const _AttendeeList({required this.attendees, required this.busyTokens, required this.onTap});

  Widget _row(Map<String, dynamic> a) {
    final status = a['status']?.toString();
    final name = a['attendee_name']?.toString() ?? 'Attendee';
    final code = a['ticket_number']?.toString() ?? '';
    final email = a['attendee_email']?.toString() ?? '';
    final token = a['qr_token']?.toString() ?? code;
    final type = a['ticket_type_name']?.toString().trim() ?? '';
    return ListRow(
      leading: InitialsAvatar(name: name),
      title: name,
      subtitleWidget: Text.rich(
        TextSpan(children: [
          if (type.isNotEmpty)
            TextSpan(text: type, style: AppType.body(13, weight: FontWeight.w600, color: AppColors.brand, height: 1.35)),
          if (type.isNotEmpty && (code.isNotEmpty || email.isNotEmpty)) const TextSpan(text: '  ·  '),
          if (code.isNotEmpty) TextSpan(text: code, style: AppType.mono(12, color: AppColors.ink600)),
          if (code.isNotEmpty && email.isNotEmpty) const TextSpan(text: '  ·  '),
          if (email.isNotEmpty) TextSpan(text: email),
        ]),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppType.rowSubtitle,
      ),
      trailing: busyTokens.contains(token)
          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
          : StatusBadge(TicketStatus.label(status), tone: TicketStatus.tone(status)),
      onTap: () => onTap(a),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SliverLayoutBuilder(builder: (context, c) {
      final twoCol = c.crossAxisExtent >= 720;
      if (!twoCol) {
        // Lazily built inset-grouped list.
        return DecoratedSliver(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadius.md + 2),
            border: Border.all(color: AppColors.ink200.withValues(alpha: 0.7), width: 0.5),
          ),
          sliver: SliverList.separated(
            itemCount: attendees.length,
            itemBuilder: (_, i) => Material(type: MaterialType.transparency, child: _row(attendees[i])),
            separatorBuilder: (_, __) => const Padding(
              padding: EdgeInsets.only(left: 68),
              child: Divider(height: 0.5),
            ),
          ),
        );
      }
      final half = (attendees.length / 2).ceil();
      return SliverToBoxAdapter(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: GroupedSection(
                separatorInset: 68,
                children: [for (final a in attendees.take(half)) _row(a)],
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: half < attendees.length
                  ? GroupedSection(
                      separatorInset: 68,
                      children: [for (final a in attendees.skip(half)) _row(a)],
                    )
                  : const SizedBox(),
            ),
          ],
        ),
      );
    });
  }
}
