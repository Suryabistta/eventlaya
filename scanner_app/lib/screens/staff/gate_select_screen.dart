import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/event_model.dart';
import '../../models/gate_model.dart';
import '../../providers/auth_provider.dart';
import '../../providers/event_provider.dart';
import '../../ui/ui.dart';
import '../common/event_phase.dart';
import '../common/format.dart';
import '../common/pickers.dart';
import '../common/session.dart';
import 'staff_shell.dart';

/// Staff pick (or confirm) their event and gate before scanning.
class GateSelectScreen extends ConsumerStatefulWidget {
  /// When opened from inside the scanner shell, pop back instead of replacing.
  final bool returnOnDone;
  const GateSelectScreen({super.key, this.returnOnDone = false});

  @override
  ConsumerState<GateSelectScreen> createState() => _GateSelectScreenState();
}

class _GateSelectScreenState extends ConsumerState<GateSelectScreen> {
  EventModel? _selectedEvent;

  /// Chosen gate. Empty id = free-text gate name (servers without per-event gates).
  GateModel? _gate;

  @override
  void initState() {
    super.initState();
    final s = ref.read(eventProvider);
    _selectedEvent = s.currentEvent;
    _gate = s.gate ?? (s.selectedGate == null ? null : GateModel(id: '', name: s.selectedGate!));
  }

  void _proceed() {
    final s = ref.read(eventProvider);
    final assigned = widget.returnOnDone ? null : s.currentEvent;
    final event = assigned ?? _selectedEvent ?? s.currentEvent;

    if (event == null) {
      AppToast.error(context, 'Choose an event first');
      return;
    }

    final notifier = ref.read(eventProvider.notifier);
    if (s.currentEvent != event) notifier.setCurrentEvent(event);

    String gateName;
    if (s.gateLocked && s.gate != null) {
      gateName = s.gate!.name;
    } else {
      final gates = ref.read(gatesProvider(event.id)).valueOrNull;
      final gate = _gate;
      final usesGateList = gates != null;
      if (gate == null || gate.name.trim().isEmpty || (usesGateList && gate.id.isEmpty)) {
        AppToast.error(context, usesGateList && gates.isEmpty ? 'Ask your organizer to set up gates first' : 'Choose a gate');
        return;
      }
      if (usesGateList && !gates.any((g) => g.id == gate.id)) {
        AppToast.error(context, 'Choose a gate for this event');
        return;
      }
      notifier.selectGate(gate);
      gateName = gate.name;
    }
    notifier.startPolling();

    AppToast.success(context, 'Scanning at $gateName');
    if (widget.returnOnDone) {
      Navigator.of(context).pop();
    } else {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const StaffShell()),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authProvider).user;
    final state = ref.watch(eventProvider);
    final assigned = state.currentEvent;
    final event = widget.returnOnDone ? (_selectedEvent ?? assigned) : (assigned ?? _selectedEvent);

    return AppScaffold(
      title: 'Choose your gate',
      actions: [
        if (!widget.returnOnDone)
          NavTextButton(label: 'Sign out', onPressed: () => confirmSignOut(context, ref)),
      ],
      bottomBar: PrimaryButton(
        label: widget.returnOnDone ? 'Save' : 'Start scanning',
        icon: widget.returnOnDone ? null : Icons.qr_code_scanner_rounded,
        onPressed: _proceed,
      ),
      onRefresh: () async {
        ref.invalidate(eventsProvider);
        if (event != null) ref.invalidate(gatesProvider(event.id));
      },
      slivers: [
        SliverToBoxAdapter(
          child: GroupedSection(
            children: [
              ListRow(
                leading: InitialsAvatar(name: user?.fullName ?? 'Staff'),
                title: user?.fullName ?? 'Gate staff',
                subtitle: user?.email,
                trailing: const StatusBadge('Gate staff', tone: Tone.brand, dot: false),
              ),
            ],
          ),
        ),
        SliverToBoxAdapter(child: _eventSection(assigned)),
        if (event != null)
          SliverToBoxAdapter(
            child: state.gateLocked && state.gate != null
                ? GroupedSection(
                    header: 'Gate',
                    footer: 'Assigned by your organizer.',
                    separatorInset: 58,
                    children: [
                      ListRow(
                        leading: RowIcon(gateIcon(state.gate!), background: AppColors.success),
                        title: state.gate!.name,
                        subtitle: state.gate!.kindLabel,
                        trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                          if (state.gate!.isVip) const StatusBadge('VIP', tone: Tone.warning, dot: false),
                          const SizedBox(width: 8),
                          const Icon(Icons.lock_outline_rounded, size: 20, color: AppColors.ink400),
                        ]),
                      ),
                    ],
                  )
                : Padding(
                    padding: const EdgeInsets.only(bottom: 24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                          child: Text('Gate', style: AppType.groupHeader),
                        ),
                        GateList(
                          eventId: event.id,
                          selected: _gate,
                          selectedName: _gate?.name,
                          onSelected: (g) => setState(() => _gate = g),
                        ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                          child: Text('Every scan from this phone is recorded against this gate.',
                              style: AppType.caption),
                        ),
                      ],
                    ),
                  ),
          ),
      ],
    );
  }

  Widget _eventSection(EventModel? assigned) {
    if (assigned != null && !widget.returnOnDone) {
      return GroupedSection(
        header: 'Your event',
        footer: PhaseCopy.scanNotice(assigned),
        children: [
          ListRow(
            leading: const RowIcon(Icons.event_available_rounded, background: AppColors.success),
            title: assigned.title,
            // Badges get their own line so they don't squeeze the title and venue.
            subtitleWidget: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  [assigned.venue, if (assigned.date != null) Fmt.date(assigned.date)].join(' · '),
                  style: AppType.rowSubtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 8),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  PhaseBadge(assigned),
                  const StatusBadge('Assigned', tone: Tone.success),
                ]),
              ],
            ),
          ),
        ],
      );
    }

    final events = ref.watch(eventsProvider);
    return events.when(
      loading: () => const LoadingList(rows: 3, avatar: false),
      error: (e, _) => Padding(
        padding: const EdgeInsets.only(bottom: 24),
        child: GroupedSurface(
          child: ErrorState(
            title: "Couldn't load events",
            message: e.toString(),
            onRetry: () => ref.invalidate(eventsProvider),
          ),
        ),
      ),
      data: (list) {
        if (list.isEmpty) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 24),
            child: GroupedSurface(
              child: EmptyState(
                icon: Icons.event_busy_outlined,
                title: 'No events to scan for',
                message: 'Ask your organizer to assign you to an event, then pull down to refresh.',
                actionLabel: 'Refresh',
                actionIcon: Icons.refresh_rounded,
                onAction: () => ref.invalidate(eventsProvider),
              ),
            ),
          );
        }
        final fallback = defaultEvent(list)!;
        if (_selectedEvent == null) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted && _selectedEvent == null) setState(() => _selectedEvent = fallback);
          });
        }
        final selected = _selectedEvent ?? fallback;
        return GroupedSection(
          header: 'Event',
          footer: PhaseCopy.scanNotice(selected),
          children: [
            for (final e in sortEventsByPhase(list))
              ListRow(
                title: e.title,
                subtitle: [e.venue, if (e.date != null) Fmt.date(e.date)].join(' · '),
                trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                  PhaseBadge(e),
                  if (e == selected) ...[
                    const SizedBox(width: 8),
                    const Icon(Icons.check_rounded, color: AppColors.brand),
                  ],
                ]),
                onTap: () => setState(() {
                  if (_selectedEvent != e) _gate = null; // gates belong to an event
                  _selectedEvent = e;
                }),
              ),
          ],
        );
      },
    );
  }
}
