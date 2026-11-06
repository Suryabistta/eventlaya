import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../core/api_client.dart';
import '../../models/gate_model.dart';
import '../../models/team_member.dart';
import '../../providers/event_provider.dart';
import '../../ui/ui.dart';
import '../common/pickers.dart';
import 'broadcast_sheet.dart';
import 'staff_credentials_sheet.dart';
import 'team_screen.dart' show fetchTeamMembers;

const _setUpGatesMessage = 'Set up gates on the web dashboard (Gates & staff).';

/// Gate staff for the current event, grouped by gate.
class StaffScreen extends ConsumerStatefulWidget {
  const StaffScreen({super.key});

  @override
  ConsumerState<StaffScreen> createState() => _StaffScreenState();
}

class _StaffScreenState extends ConsumerState<StaffScreen> {
  final _api = ApiClient();
  List<Map<String, dynamic>> _assignments = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadAssignments();
  }

  Future<void> _loadAssignments() async {
    final eventId = ref.read(eventProvider).currentEvent?.id;
    if (eventId == null) {
      setState(() => _loading = false);
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get(
        '/api/events/staff-assign/',
        queryParameters: {'event_id': eventId},
      );
      final data = resp.data;
      final list = (data is List) ? data : [];
      if (mounted) setState(() => _assignments = List<Map<String, dynamic>>.from(list));
    } on DioException catch (e) {
      if (mounted) setState(() => _error = _api.errorMessage(e));
    } catch (e) {
      if (mounted) setState(() => _error = 'Something went wrong: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _refresh() async {
    final eventId = ref.read(eventProvider).currentEvent?.id;
    if (eventId != null) ref.invalidate(gatesProvider(eventId));
    await _loadAssignments();
  }

  Future<void> _openAssignSheet() async {
    final event = ref.read(eventProvider).currentEvent;
    if (event == null) {
      AppToast.error(context, 'Pick an event first');
      return;
    }
    final emailCtrl = TextEditingController();
    final nameCtrl = TextEditingController();
    GateModel? gate;
    var assigning = false;
    // Existing team members, offered as quick picks for the email field.
    final teamFuture = fetchTeamMembers(_api).catchError((_) => <TeamMember>[]);

    await showAppSheet<void>(
      context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) {
          return Consumer(builder: (ctx, ref, _) {
            final gates = ref.watch(gatesProvider(event.id));
            final legacy = gates.maybeWhen(data: (g) => g == null, orElse: () => false);
            final noGates = gates.maybeWhen(data: (g) => g != null && g.isEmpty, orElse: () => false);

            Future<void> assign() async {
              final email = emailCtrl.text.trim();
              if (email.isEmpty || !email.contains('@')) {
                AppToast.error(ctx, "Enter the staff member's email");
                return;
              }
              final g = gate;
              if (g == null || g.name.trim().isEmpty || (!legacy && g.id.isEmpty)) {
                AppToast.error(ctx, 'Choose a gate');
                return;
              }
              setSheet(() => assigning = true);
              try {
                final resp = await _api.post('/api/events/staff-assign/', data: {
                  'event_id': event.id,
                  'staff_email': email,
                  'email': email,
                  if (nameCtrl.text.trim().isNotEmpty) 'name': nameCtrl.text.trim(),
                  if (g.id.isNotEmpty) 'gate_id': g.id else 'gate_name': g.name.trim(),
                });
                final data = resp.data is Map ? resp.data as Map : const {};
                final msg = data['message']?.toString();
                final temp = data['temporary_password']?.toString();
                if (ctx.mounted) Navigator.pop(ctx);
                _refresh();
                if (!mounted) return;
                if (temp != null && temp.isNotEmpty) {
                  await showStaffCredentialsSheet(
                    context,
                    email: email,
                    password: temp,
                    name: nameCtrl.text.trim(),
                    title: 'Account created',
                  );
                } else {
                  AppToast.success(context, msg ?? '$email can now scan at ${g.name}');
                }
              } on DioException catch (e) {
                if (ctx.mounted) {
                  setSheet(() => assigning = false);
                  AppToast.error(ctx, _api.errorMessage(e));
                }
              }
            }

            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                const SheetHeader(
                  title: 'Add gate staff',
                  message: 'They sign in to this app with their own account and scan at the gate you choose.',
                ),
                if (noGates)
                  const GroupedSurface(
                    child: EmptyState(
                      icon: Icons.door_front_door_outlined,
                      title: 'No gates yet',
                      message: _setUpGatesMessage,
                    ),
                  )
                else ...[
                  TextField(
                    controller: emailCtrl,
                    autofocus: true,
                    keyboardType: TextInputType.emailAddress,
                    autocorrect: false,
                    decoration: const InputDecoration(
                      labelText: 'Email',
                      hintText: 'staff@example.com',
                      prefixIcon: Icon(Icons.mail_outline_rounded),
                    ),
                  ),
                  FutureBuilder<List<TeamMember>>(
                    future: teamFuture,
                    builder: (ctx, snap) {
                      final team = (snap.data ?? const <TeamMember>[]).where((m) => m.isActive).take(8).toList();
                      if (team.isEmpty) return const SizedBox.shrink();
                      return Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            for (final m in team)
                              ChoiceChip(
                                label: Text(m.displayName),
                                avatar: InitialsAvatar(name: m.displayName, size: 22),
                                showCheckmark: false,
                                selected: emailCtrl.text.trim().toLowerCase() == m.email.toLowerCase(),
                                onSelected: (_) => setSheet(() {
                                  emailCtrl.text = m.email;
                                  if (m.displayName != m.email) nameCtrl.text = m.displayName;
                                }),
                              ),
                          ],
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: nameCtrl,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Name (optional)',
                      prefixIcon: Icon(Icons.person_outline_rounded),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: Text('Gate', style: AppType.groupHeader),
                  ),
                  GateList(
                    eventId: event.id,
                    selected: gate,
                    selectedName: gate?.name,
                    onSelected: (g) => setSheet(() => gate = g),
                  ),
                  const SizedBox(height: 20),
                  PrimaryButton(
                    label: 'Add to gate',
                    icon: Icons.person_add_alt_1_rounded,
                    loading: assigning,
                    onPressed: assign,
                  ),
                ],
              ],
            );
          });
        },
      ),
    );
  }

  /// Assignments grouped by the event's gates (in gate order), then any
  /// assignments on closed gates, then unassigned.
  List<Widget> _groups(List<GateModel> gates) {
    String? gateIdOf(Map<String, dynamic> a) =>
        (a['gate'] is Map ? (a['gate'] as Map)['id'] : a['gate_id'])?.toString();

    final widgets = <Widget>[];
    final used = <Map<String, dynamic>>{};
    for (final g in gates) {
      final members = _assignments.where((a) => gateIdOf(a) == g.id).toList();
      used.addAll(members);
      widgets.add(GroupedSection(
        header: g.name,
        headerTrailing: Padding(
          padding: const EdgeInsets.only(right: 8),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            if (g.isVip) ...[const StatusBadge('VIP', tone: Tone.warning, dot: false), const SizedBox(width: 6)],
            StatusBadge(g.kindLabel, dot: false),
          ]),
        ),
        separatorInset: 68,
        children: members.isEmpty
            ? [const ListRow(title: 'No staff yet', subtitle: 'Add someone to scan at this gate.')]
            : [for (final a in members) _staffRow(a)],
      ));
    }
    final rest = _assignments.where((a) => !used.contains(a)).toList();
    final onOtherGate = rest.where((a) => gateIdOf(a) != null).toList();
    final unassigned = rest.where((a) => gateIdOf(a) == null).toList();
    if (onOtherGate.isNotEmpty) {
      widgets.add(GroupedSection(
        header: 'Closed gates',
        separatorInset: 68,
        children: [for (final a in onOtherGate) _staffRow(a, showGate: true)],
      ));
    }
    if (unassigned.isNotEmpty) {
      widgets.add(GroupedSection(
        header: 'Unassigned',
        separatorInset: 68,
        children: [for (final a in unassigned) _staffRow(a)],
      ));
    }
    return widgets;
  }

  Widget _staffRow(Map<String, dynamic> a, {bool showGate = false}) {
    final name = a['staff_name']?.toString();
    final email = a['staff_email']?.toString() ?? '';
    final gateName = (a['gate'] is Map ? (a['gate'] as Map)['name'] : a['gate_name'])?.toString();
    return ListRow(
      leading: InitialsAvatar(name: (name?.isNotEmpty ?? false) ? name! : email),
      title: (name?.isNotEmpty ?? false) ? name! : email,
      subtitle: email,
      trailing: showGate && gateName != null ? StatusBadge(gateName, tone: Tone.neutral, dot: false) : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    final event = ref.watch(eventProvider).currentEvent;
    final gatesAsync = event == null ? null : ref.watch(gatesProvider(event.id));
    final gates = gatesAsync?.valueOrNull; // null = legacy server (no per-event gates)
    final legacy = gatesAsync?.hasValue == true && gates == null;
    final noGates = gates != null && gates.isEmpty;

    return AppScaffold(
      title: 'Gate staff',
      onRefresh: _refresh,
      actions: [
        AppIconButton(icon: Icons.campaign_outlined, tooltip: 'Message gate staff', onPressed: () => showBroadcastSheet(context)),
        if (!noGates)
          AppIconButton(icon: Icons.person_add_alt_1_rounded, tooltip: 'Add gate staff', onPressed: _openAssignSheet),
      ],
      slivers: [
        if (event == null)
          const SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.event_outlined,
              title: 'No event selected',
              message: 'Pick an event on the Home tab first.',
            ),
          )
        else if ((_error != null && _assignments.isEmpty) || gatesAsync?.hasError == true)
          SliverFillRemaining(
            hasScrollBody: false,
            child: ErrorState(
              title: "Couldn't load staff",
              message: _error ?? gatesAsync!.error.toString(),
              onRetry: _refresh,
            ),
          )
        else if ((_loading && _assignments.isEmpty) || gatesAsync?.isLoading == true && gates == null && !legacy)
          const SliverToBoxAdapter(child: LoadingList(rows: 4))
        else if (noGates)
          const SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.door_front_door_outlined,
              title: 'No gates yet',
              message: _setUpGatesMessage,
            ),
          )
        else if (gates != null)
          SliverToBoxAdapter(child: Column(children: _groups(gates)))
        else if (_assignments.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.badge_outlined,
              title: 'No gate staff yet',
              message: 'Add the people who will scan passes at your gates.',
              actionLabel: 'Add gate staff',
              actionIcon: Icons.person_add_alt_1_rounded,
              onAction: _openAssignSheet,
            ),
          )
        else
          // Legacy server: flat list with the gate name from each assignment.
          SliverToBoxAdapter(
            child: GroupedSection(
              header: 'Scanning for ${event.title}',
              separatorInset: 68,
              children: [for (final a in _assignments) _staffRow(a, showGate: true)],
            ),
          ),
      ],
    );
  }
}
