import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/gate_model.dart';
import '../../providers/event_provider.dart';
import '../../models/event_model.dart';
import '../../ui/ui.dart';
import 'event_phase.dart';
import 'format.dart';

/// Bottom sheet to change the gate. Returns the chosen gate; for servers
/// without per-event gates the result has an empty id and a typed name.
Future<GateModel?> showGatePicker(
  BuildContext context, {
  required String eventId,
  String? scanType,
  GateModel? current,
  String? currentName,
}) {
  GateModel? pending = currentName == null ? null : GateModel(id: '', name: currentName);
  return showAppSheet<GateModel>(
    context,
    builder: (ctx) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        SheetHeader(
          title: 'Change gate',
          message: scanType == null
              ? 'Scans are recorded against this gate.'
              : 'Showing gates that allow ${scanType == 'gate_out' ? 'exit' : 'entry'}.',
        ),
        GateList(
          eventId: eventId,
          scanType: scanType,
          selected: current,
          selectedName: currentName,
          onSelected: (g) {
            if (g.id.isNotEmpty) {
              Navigator.pop(ctx, g);
            } else {
              pending = g;
            }
          },
        ),
        Consumer(builder: (ctx, ref, _) {
          final legacy = ref.watch(gatesProvider(eventId)).maybeWhen(data: (g) => g == null, orElse: () => false);
          if (!legacy) return const SizedBox.shrink();
          return Padding(
            padding: const EdgeInsets.only(top: 20),
            child: PrimaryButton(
              label: 'Use this gate',
              onPressed: () {
                final name = pending?.name.trim() ?? '';
                if (name.isEmpty) {
                  AppToast.error(ctx, 'Enter a gate name');
                  return;
                }
                Navigator.pop(ctx, GateModel(id: '', name: name));
              },
            ),
          );
        }),
      ],
    ),
  );
}

IconData gateIcon(GateModel g) => switch (g.kind) {
      'entry' => Icons.login_rounded,
      'exit' => Icons.logout_rounded,
      _ => Icons.door_front_door_outlined,
    };

/// The event's gates as a selectable grouped list. Falls back to a free-text
/// gate name when the server has no per-event gates.
class GateList extends ConsumerWidget {
  final String eventId;

  /// 'gate_in' / 'gate_out' to only show compatible gates; null shows all.
  final String? scanType;
  final GateModel? selected;
  final String? selectedName;
  final ValueChanged<GateModel> onSelected;

  const GateList({
    super.key,
    required this.eventId,
    required this.onSelected,
    this.scanType,
    this.selected,
    this.selectedName,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final gates = ref.watch(gatesProvider(eventId));
    return gates.when(
      loading: () => const LoadingList(rows: 3, avatar: false),
      error: (e, _) => GroupedSurface(
        child: ErrorState(
          title: "Couldn't load gates",
          message: e.toString(),
          onRetry: () => ref.invalidate(gatesProvider(eventId)),
        ),
      ),
      data: (list) {
        if (list == null) {
          return _FreeTextGate(initial: selectedName ?? '', onChanged: onSelected);
        }
        if (list.isEmpty) {
          return GroupedSurface(
            child: EmptyState(
              icon: Icons.door_front_door_outlined,
              title: 'No gates set up',
              message: 'Ask your organizer to set up gates for this event.',
              actionLabel: 'Refresh',
              actionIcon: Icons.refresh_rounded,
              onAction: () => ref.invalidate(gatesProvider(eventId)),
            ),
          );
        }
        final shown = scanType == null ? list : list.where((g) => g.allows(scanType!)).toList();
        final hidden = list.length - shown.length;
        final mode = scanType == 'gate_out' ? 'exit' : 'entry';
        if (shown.isEmpty) {
          return GroupedSurface(
            child: EmptyState(
              icon: Icons.door_front_door_outlined,
              title: 'No $mode gates',
              message: 'None of this event\'s gates allow $mode. Ask your organizer to set one up.',
            ),
          );
        }
        return GroupedSection(
          margin: EdgeInsets.zero,
          separatorInset: 58,
          footer: hidden == 0
              ? null
              : hidden == 1
                  ? '1 gate is hidden because it doesn\'t allow $mode.'
                  : '$hidden gates are hidden because they don\'t allow $mode.',
          children: [
            for (final g in shown)
              ListRow(
                leading: RowIcon(
                  gateIcon(g),
                  background: g.kind == 'exit'
                      ? AppColors.marigold
                      : g.kind == 'entry'
                          ? AppColors.success
                          : AppColors.brand,
                ),
                title: g.name,
                subtitle: g.kindLabel,
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (g.isVip) const StatusBadge('VIP', tone: Tone.warning, dot: false),
                    if (g.id == selected?.id) ...[
                      const SizedBox(width: 8),
                      const Icon(Icons.check_rounded, color: AppColors.brand),
                    ],
                  ],
                ),
                onTap: () => onSelected(g),
              ),
          ],
        );
      },
    );
  }
}

class _FreeTextGate extends StatefulWidget {
  final String initial;
  final ValueChanged<GateModel> onChanged;
  const _FreeTextGate({required this.initial, required this.onChanged});

  @override
  State<_FreeTextGate> createState() => _FreeTextGateState();
}

class _FreeTextGateState extends State<_FreeTextGate> {
  late final _ctrl = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _set(String v) {
    setState(() {});
    widget.onChanged(GateModel(id: '', name: v.trim()));
  }

  @override
  Widget build(BuildContext context) {
    return GroupedSection(
      margin: EdgeInsets.zero,
      children: [
        FieldRow(
          controller: _ctrl,
          label: 'Gate name',
          hint: 'e.g. North entrance',
          icon: Icons.door_front_door_outlined,
          textCapitalization: TextCapitalization.words,
          onChanged: _set,
        ),
      ],
    );
  }
}

/// Bottom sheet listing events. Returns the chosen event.
Future<EventModel?> showEventPicker(
  BuildContext context, {
  required List<EventModel> events,
  EventModel? current,
}) {
  return showAppSheet<EventModel>(
    context,
    builder: (ctx) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        const SheetHeader(title: 'Switch event'),
        GroupedSection(
          margin: EdgeInsets.zero,
          children: [
            for (final e in sortEventsByPhase(events))
              ListRow(
                title: e.title,
                subtitle: [e.venue, if (e.date != null) Fmt.date(e.date)].join(' · '),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    PhaseBadge(e),
                    if (e == current) ...[
                      const SizedBox(width: 8),
                      const Icon(Icons.check_rounded, color: AppColors.brand),
                    ],
                  ],
                ),
                onTap: () => Navigator.pop(ctx, e),
              ),
          ],
        ),
      ],
    ),
  );
}
