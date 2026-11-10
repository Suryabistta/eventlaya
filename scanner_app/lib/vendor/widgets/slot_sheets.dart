import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../ui/ui.dart';
import '../data/vendor_api.dart';
import '../data/vendor_models.dart';
import '../providers/vendor_providers.dart';
import 'month_grid.dart';
import 'request_sheet.dart';
import 'vendor_widgets.dart';
import '../../core/bs_date.dart';

String _hhmm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

TimeOfDay? _parseTime(String? s) {
  if (s == null) return null;
  final p = s.split(':');
  if (p.length < 2) return null;
  return TimeOfDay(hour: int.tryParse(p[0]) ?? 0, minute: int.tryParse(p[1]) ?? 0);
}

int _minutes(TimeOfDay t) => t.hour * 60 + t.minute;

bool _isPast(DateTime day) => dayOf(day).isBefore(dayOf(DateTime.now()));

Future<TimeOfDay?> _pickTime(BuildContext context, TimeOfDay initial) => showTimePicker(
      context: context,
      initialTime: initial,
      builder: (ctx, child) => MediaQuery(
        data: MediaQuery.of(ctx).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );

/// A tappable label/value row inside a form sheet.
class _PickRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final VoidCallback? onTap;
  const _PickRow({required this.icon, required this.label, required this.value, this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.ink50,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.md),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          child: Row(children: [
            Icon(icon, size: 20, color: AppColors.ink600),
            const SizedBox(width: 10),
            Text(label, style: AppType.body(14.5, color: AppColors.ink600)),
            const Spacer(),
            Text(value,
                style: AppType.body(14.5,
                    weight: FontWeight.w600, color: onTap == null ? AppColors.ink400 : AppColors.textPrimary)),
          ]),
        ),
      ),
    );
  }
}

/// Full day switch + start / end time rows.
class _TimeFields extends StatelessWidget {
  final bool fullDay;
  final TimeOfDay start;
  final TimeOfDay end;
  final bool enabled;
  final ValueChanged<bool> onFullDay;
  final ValueChanged<TimeOfDay> onStart;
  final ValueChanged<TimeOfDay> onEnd;

  const _TimeFields({
    required this.fullDay,
    required this.start,
    required this.end,
    required this.onFullDay,
    required this.onStart,
    required this.onEnd,
    this.enabled = true,
  });

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SwitchListTile.adaptive(
        contentPadding: const EdgeInsets.symmetric(horizontal: 4),
        title: Text('Full day', style: AppType.body(15, weight: FontWeight.w500)),
        subtitle: Text(fullDay ? 'The whole day is one booking' : 'Set a start and end time', style: AppType.caption),
        value: fullDay,
        onChanged: enabled ? onFullDay : null,
      ),
      if (!fullDay) ...[
        const SizedBox(height: 4),
        Row(children: [
          Expanded(
            child: _PickRow(
              icon: Icons.schedule_rounded,
              label: 'From',
              value: _hhmm(start),
              onTap: enabled
                  ? () async {
                      final t = await _pickTime(context, start);
                      if (t != null) onStart(t);
                    }
                  : null,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _PickRow(
              icon: Icons.schedule_outlined,
              label: 'To',
              value: _hhmm(end),
              onTap: enabled
                  ? () async {
                      final t = await _pickTime(context, end);
                      if (t != null) onEnd(t);
                    }
                  : null,
            ),
          ),
        ]),
      ],
    ]);
  }
}

InputDecoration _fieldDecoration(String label, {String? hint, String? prefix}) => InputDecoration(
      labelText: label,
      hintText: hint,
      prefixText: prefix,
      filled: true,
      fillColor: AppColors.ink50,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.md), borderSide: BorderSide.none),
    );

double? _parsePrice(String text) {
  final t = text.trim().replaceAll(',', '');
  if (t.isEmpty) return null;
  return double.tryParse(t);
}

// --- Day sheet ---------------------------------------------------------------

/// Slots of one day for the calendar's [target]; add, edit, block, and act on
/// requests. Live: refreshes with the calendar's [query].
Future<void> showDaySheet(
  BuildContext context, {
  required DateTime day,
  required SlotQuery query,
  required CalendarTarget target,
  required List<OwnerListing> listings,
}) {
  return showAppSheet<void>(
    context,
    builder: (_) => _DaySheet(day: day, query: query, target: target, listings: listings),
  );
}

class _DaySheet extends ConsumerStatefulWidget {
  final DateTime day;
  final SlotQuery query;
  final CalendarTarget target;
  final List<OwnerListing> listings;
  const _DaySheet({required this.day, required this.query, required this.target, required this.listings});

  @override
  ConsumerState<_DaySheet> createState() => _DaySheetState();
}

class _DaySheetState extends ConsumerState<_DaySheet> {
  bool _busy = false;

  Future<void> _block() async {
    setState(() => _busy = true);
    try {
      final r = await ref.read(vendorApiProvider).blockDates(widget.target, [widget.day]);
      if (!mounted) return;
      ref.refreshVendorData();
      AppToast.success(
        context,
        r.skipped > 0
            ? 'Day blocked · ${Fmtn.plural(r.skipped, 'slot')} with a request left as is'
            : 'Day blocked — customers can’t request it',
      );
    } catch (e) {
      if (mounted) AppToast.error(context, vendorErrorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Full-day blocks made by "Block day" are removed; blocked time slots open again.
  Future<void> _unblock(List<Slot> blocked) async {
    setState(() => _busy = true);
    final api = ref.read(vendorApiProvider);
    try {
      for (final s in blocked) {
        if (s.isFullDay && s.price == null) {
          await api.deleteSlot(s.id);
        } else {
          await api.updateSlot(s.id, {'status': SlotStatus.open});
        }
      }
      if (!mounted) return;
      ref.refreshVendorData();
      AppToast.success(context, 'Day unblocked');
    } catch (e) {
      if (mounted) AppToast.error(context, vendorErrorMessage(e));
      ref.refreshVendorData();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(slotsProvider(widget.query));
    final day = widget.day;
    final slots = (async.valueOrNull ?? const <Slot>[]).where((s) => dayOf(s.date) == day).toList()
      ..sort((a, b) => a.sortKey.compareTo(b.sortKey));
    final past = _isPast(day);
    final blocked = slots.where((s) => s.status == SlotStatus.blocked).toList();
    final hasOpen = slots.any((s) => s.status == SlotStatus.open);
    final showUnblock = blocked.isNotEmpty && !hasOpen;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        SheetHeader(
          title: BsDate.format('EEEE d MMMM', day),
          message: [
            targetLabel(widget.target, widget.listings),
            if (past) 'Past day — read only',
          ].join(' · '),
        ),
        if (async.isLoading && async.valueOrNull == null)
          const LoadingList(rows: 2, avatar: false)
        else if (slots.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(
              past
                  ? 'No slots on this day.'
                  : 'No slots yet. Add one so customers can request this day, or block it to show you are busy.',
              style: AppType.body(14, color: AppColors.textSecondary),
            ),
          )
        else
          for (final s in slots) _SlotTile(slot: s, readOnly: past, listings: widget.listings),
        if (!past) ...[
          const SizedBox(height: 12),
          PrimaryButton(
            label: 'Add slot',
            icon: Icons.add_rounded,
            onPressed: _busy
                ? null
                : () => showSlotEditor(context, target: widget.target, listings: widget.listings, day: day),
          ),
          const SizedBox(height: 8),
          PrimaryButton(
            label: showUnblock ? 'Unblock day' : 'Block day',
            icon: showUnblock ? Icons.lock_open_rounded : Icons.block_rounded,
            tone: ButtonTone.neutral,
            tonal: true,
            loading: _busy,
            onPressed: _busy ? null : () => showUnblock ? _unblock(blocked) : _block(),
          ),
        ],
      ],
    );
  }
}

class _SlotTile extends ConsumerWidget {
  final Slot slot;
  final bool readOnly;
  final List<OwnerListing> listings;
  const _SlotTile({required this.slot, required this.readOnly, required this.listings});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = slot;
    final req = s.toRequest();
    final details = [
      if (s.spaceName != null) s.spaceName!,
      if (s.effectivePrice != null && s.status == SlotStatus.open) priceText(s.effectivePrice),
      if (s.note.isNotEmpty) s.note,
    ];
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.md),
          onTap: () {
            if (req != null) {
              showRequestDetail(context, req);
            } else if (!readOnly) {
              showSlotEditor(context,
                  target: CalendarTarget(s.kind, s.listingId, s.spaceId), listings: listings, existing: s);
            }
          },
          child: Container(
            padding: const EdgeInsets.fromLTRB(12, 10, 10, 10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(color: AppColors.ink200),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                Container(
                  width: 4,
                  height: 36,
                  decoration: BoxDecoration(color: slotColor(s.status), borderRadius: BorderRadius.circular(2)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(s.timeLabel, style: AppType.body(15, weight: FontWeight.w600)),
                    if (details.isNotEmpty)
                      Text(details.join(' · '), maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.caption),
                  ]),
                ),
                StatusBadge(SlotStatus.label(s.status), tone: slotTone(s.status)),
                if (req == null && !readOnly)
                  const Padding(
                    padding: EdgeInsets.only(left: 2),
                    child: Icon(Icons.chevron_right_rounded, color: AppColors.ink300),
                  ),
              ]),
              if (req != null) ...[
                const SizedBox(height: 8),
                Row(children: [
                  InitialsAvatar(name: req.senderName, size: 28),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      [req.senderName, if (req.eventType != null) req.eventType!].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppType.body(13.5, weight: FontWeight.w500),
                    ),
                  ),
                ]),
                if (req.isOpen && !readOnly) ...[
                  const SizedBox(height: 8),
                  Row(children: [
                    Expanded(
                      child: PrimaryButton(
                        label: 'Confirm',
                        tone: ButtonTone.success,
                        onPressed: () => decideRequest(context, ref, req, confirm: true),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: PrimaryButton(
                        label: 'Decline',
                        tone: ButtonTone.danger,
                        tonal: true,
                        onPressed: () => decideRequest(context, ref, req, confirm: false),
                      ),
                    ),
                  ]),
                ],
              ],
            ]),
          ),
        ),
      ),
    );
  }
}

/// Number helpers without importing the screen-level formatters.
class Fmtn {
  Fmtn._();
  static String plural(int n, String one, [String? many]) => '$n ${n == 1 ? one : (many ?? '${one}s')}';
}

// --- Add / edit one slot -------------------------------------------------------

/// Add a slot on [day] for [target], or edit [existing].
Future<void> showSlotEditor(
  BuildContext context, {
  required CalendarTarget target,
  required List<OwnerListing> listings,
  DateTime? day,
  Slot? existing,
}) {
  return showAppSheet<void>(
    context,
    builder: (_) => _SlotEditor(target: target, listings: listings, day: day, existing: existing),
  );
}

class _SlotEditor extends ConsumerStatefulWidget {
  final CalendarTarget target;
  final List<OwnerListing> listings;
  final DateTime? day;
  final Slot? existing;
  const _SlotEditor({required this.target, required this.listings, this.day, this.existing});

  @override
  ConsumerState<_SlotEditor> createState() => _SlotEditorState();
}

class _SlotEditorState extends ConsumerState<_SlotEditor> {
  late CalendarTarget _target = widget.target;
  late DateTime _date = dayOf(widget.existing?.date ?? widget.day ?? DateTime.now());
  late bool _fullDay = widget.existing?.isFullDay ?? true;
  late TimeOfDay _start = _parseTime(widget.existing?.startTime) ?? const TimeOfDay(hour: 10, minute: 0);
  late TimeOfDay _end = _parseTime(widget.existing?.endTime) ?? const TimeOfDay(hour: 16, minute: 0);
  late String _status = widget.existing?.status == SlotStatus.blocked ? SlotStatus.blocked : SlotStatus.open;
  late final _price =
      TextEditingController(text: widget.existing?.price == null ? '' : widget.existing!.price!.toStringAsFixed(0));
  late final _note = TextEditingController(text: widget.existing?.note ?? '');
  bool _busy = false;

  bool get _locked => widget.existing?.isLocked ?? false;

  @override
  void dispose() {
    _price.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final price = _parsePrice(_price.text);
    if (_price.text.trim().isNotEmpty && (price == null || price < 0)) {
      AppToast.error(context, 'Enter a valid price, or leave it empty');
      return;
    }
    if (!_fullDay && _minutes(_end) <= _minutes(_start)) {
      AppToast.error(context, 'End time must be after the start time');
      return;
    }
    setState(() => _busy = true);
    final api = ref.read(vendorApiProvider);
    try {
      final ex = widget.existing;
      if (ex == null) {
        await api.createSlot(
          _target,
          date: _date,
          start: _fullDay ? null : _hhmm(_start),
          end: _fullDay ? null : _hhmm(_end),
          price: price,
          note: _note.text.trim(),
          status: _status,
        );
      } else if (_locked) {
        await api.updateSlot(ex.id, {'note': _note.text.trim()});
      } else {
        await api.updateSlot(ex.id, {
          'date': apiDate(_date),
          'start_time': _fullDay ? null : _hhmm(_start),
          'end_time': _fullDay ? null : _hhmm(_end),
          'price': price?.toStringAsFixed(2),
          'note': _note.text.trim(),
          'status': _status,
        });
      }
      if (!mounted) return;
      ref.refreshVendorData();
      AppToast.success(context, ex == null ? 'Slot added' : 'Slot saved');
      Navigator.pop(context);
    } catch (e) {
      _failed(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Shows the error; a slot that got a request meanwhile (409 slot_locked)
  /// closes the editor and refreshes the calendar.
  void _failed(Object e) {
    if (!mounted) return;
    AppToast.error(context, vendorErrorMessage(e));
    if (vendorErrorCode(e) == 'slot_locked') {
      ref.refreshVendorData();
      Navigator.pop(context);
    }
  }

  Future<void> _delete() async {
    final ex = widget.existing!;
    final ok = await confirmSheet(
      context,
      title: 'Delete this slot?',
      message: '${shortDay(ex.date)} · ${ex.timeLabel} will no longer be offered.',
      confirmLabel: 'Delete slot',
    );
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(vendorApiProvider).deleteSlot(ex.id);
      if (!mounted) return;
      ref.refreshVendorData();
      AppToast.success(context, 'Slot deleted');
      Navigator.pop(context);
    } catch (e) {
      _failed(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ex = widget.existing;
    final listing = widget.listings.where((l) => l.id == _target.listingId).firstOrNull;
    final editable = !_locked;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        SheetHeader(
          title: ex == null ? 'Add slot' : 'Edit slot',
          message: ex == null
              ? 'Customers can request open slots from your public page.'
              : _locked
                  ? 'This slot has a booking request, so only the note can change.'
                  : null,
        ),
        if (ex == null)
          TargetRow(target: _target, listings: widget.listings, onChanged: (t) => setState(() => _target = t))
        else
          _PickRow(icon: Icons.storefront_outlined, label: 'Listing', value: targetLabel(_target, widget.listings)),
        const SizedBox(height: 8),
        _PickRow(
          icon: Icons.calendar_today_rounded,
          label: 'Date',
          value: shortDay(_date),
          onTap: editable
              ? () async {
                  final now = dayOf(DateTime.now());
                  final d = await showDatePicker(
                    context: context,
                    initialDate: _date.isBefore(now) ? now : _date,
                    firstDate: now,
                    lastDate: now.add(const Duration(days: 730)),
                  );
                  if (d != null) setState(() => _date = dayOf(d));
                }
              : null,
        ),
        const SizedBox(height: 4),
        _TimeFields(
          fullDay: _fullDay,
          start: _start,
          end: _end,
          enabled: editable,
          onFullDay: (v) => setState(() => _fullDay = v),
          onStart: (t) => setState(() {
            _start = t;
            if (_minutes(_end) <= _minutes(t)) _end = TimeOfDay(hour: (t.hour + 1) % 24, minute: t.minute);
          }),
          onEnd: (t) => setState(() => _end = t),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _price,
          enabled: editable,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
          decoration: _fieldDecoration(
            'Price (optional)',
            prefix: 'Rs ',
            hint: listing?.priceLabel.isNotEmpty == true ? 'Default: ${listing!.priceLabel}' : 'Listing price',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _note,
          maxLength: 255,
          textCapitalization: TextCapitalization.sentences,
          decoration: _fieldDecoration('Note (optional)', hint: 'e.g. Includes decoration'),
        ),
        if (editable) ...[
          SegmentedControl<String>(
            segments: const [Segment(SlotStatus.open, 'Open'), Segment(SlotStatus.blocked, 'Blocked')],
            selected: _status,
            onChanged: (v) => setState(() => _status = v),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 6, 4, 0),
            child: Text(
              _status == SlotStatus.open
                  ? 'Open: customers can request it.'
                  : 'Blocked: shown as unavailable, nobody can request it.',
              style: AppType.caption,
            ),
          ),
        ],
        const SizedBox(height: 16),
        PrimaryButton(label: ex == null ? 'Add slot' : 'Save', loading: _busy, onPressed: _busy ? null : _save),
        if (ex != null && editable) ...[
          const SizedBox(height: 8),
          PrimaryButton(
            label: 'Delete slot',
            icon: Icons.delete_outline_rounded,
            tone: ButtonTone.danger,
            tonal: true,
            onPressed: _busy ? null : _delete,
          ),
        ],
      ],
    );
  }
}

// --- Repeat (bulk) -------------------------------------------------------------

/// Creates the same slot on chosen weekdays across a date range.
Future<void> showRepeatSheet(BuildContext context,
    {required CalendarTarget target, required List<OwnerListing> listings}) {
  return showAppSheet<void>(context, builder: (_) => _RepeatSheet(target: target, listings: listings));
}

class _RepeatSheet extends ConsumerStatefulWidget {
  final CalendarTarget target;
  final List<OwnerListing> listings;
  const _RepeatSheet({required this.target, required this.listings});

  @override
  ConsumerState<_RepeatSheet> createState() => _RepeatSheetState();
}

class _RepeatSheetState extends ConsumerState<_RepeatSheet> {
  static const _names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  late CalendarTarget _target = widget.target;

  /// API weekday numbers: 0 = Monday … 6 = Sunday (Dart's DateTime.weekday - 1).
  final Set<int> _weekdays = {0, 1, 2, 3, 4, 5, 6};
  late DateTime _from = dayOf(DateTime.now());
  late DateTime _to = _from.add(const Duration(days: 29));
  bool _fullDay = true;
  TimeOfDay _start = const TimeOfDay(hour: 10, minute: 0);
  TimeOfDay _end = const TimeOfDay(hour: 16, minute: 0);
  final _price = TextEditingController();
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _price.dispose();
    _note.dispose();
    super.dispose();
  }

  int get _matchingDays {
    var n = 0;
    for (var d = _from; !d.isAfter(_to); d = DateTime(d.year, d.month, d.day + 1)) {
      if (_weekdays.contains(d.weekday - 1)) n++;
    }
    return n;
  }

  Future<void> _pickRange() async {
    final now = dayOf(DateTime.now());
    final r = await showDateRangePicker(
      context: context,
      firstDate: now,
      lastDate: now.add(const Duration(days: 730)),
      initialDateRange: DateTimeRange(start: _from, end: _to),
    );
    if (r != null) {
      setState(() {
        _from = dayOf(r.start);
        _to = dayOf(r.end);
      });
    }
  }

  Future<void> _create() async {
    final price = _parsePrice(_price.text);
    if (_price.text.trim().isNotEmpty && (price == null || price < 0)) {
      AppToast.error(context, 'Enter a valid price, or leave it empty');
      return;
    }
    if (_weekdays.isEmpty) {
      AppToast.error(context, 'Pick at least one weekday');
      return;
    }
    if (!_fullDay && _minutes(_end) <= _minutes(_start)) {
      AppToast.error(context, 'End time must be after the start time');
      return;
    }
    if (_to.difference(_from).inDays + 1 > 370) {
      AppToast.error(context, 'Pick at most 370 days at a time');
      return;
    }
    setState(() => _busy = true);
    try {
      final r = await ref.read(vendorApiProvider).bulkSlots(
            _target,
            from: _from,
            to: _to,
            weekdays: (_weekdays.toList()..sort()),
            start: _fullDay ? null : _hhmm(_start),
            end: _fullDay ? null : _hhmm(_end),
            price: price,
            note: _note.text.trim(),
          );
      if (!mounted) return;
      ref.refreshVendorData();
      final msg = 'Created ${r.created} · skipped ${r.skipped}';
      if (r.created == 0) {
        AppToast.warning(context, '$msg (those days already have overlapping slots)');
      } else {
        AppToast.success(context, msg);
      }
      Navigator.pop(context);
    } catch (e) {
      if (mounted) AppToast.error(context, vendorErrorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final fmt = DateFormat('d MMM y');
    final n = _matchingDays;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        const SheetHeader(
          title: 'Repeat slots',
          message: 'Add the same slot on the chosen weekdays. Days that already have an overlapping slot are skipped.',
        ),
        TargetRow(target: _target, listings: widget.listings, onChanged: (t) => setState(() => _target = t)),
        const SizedBox(height: 16),
        Text('Weekdays', style: AppType.groupHeader),
        const SizedBox(height: 8),
        Row(children: [
          for (var i = 0; i < 7; i++)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: _DayChip(
                  label: _names[i],
                  selected: _weekdays.contains(i),
                  onTap: () => setState(() => _weekdays.contains(i) ? _weekdays.remove(i) : _weekdays.add(i)),
                ),
              ),
            ),
        ]),
        const SizedBox(height: 12),
        _PickRow(
          icon: Icons.date_range_rounded,
          label: 'Dates',
          value: '${fmt.format(_from)} – ${fmt.format(_to)}',
          onTap: _pickRange,
        ),
        const SizedBox(height: 4),
        _TimeFields(
          fullDay: _fullDay,
          start: _start,
          end: _end,
          onFullDay: (v) => setState(() => _fullDay = v),
          onStart: (t) => setState(() {
            _start = t;
            if (_minutes(_end) <= _minutes(t)) _end = TimeOfDay(hour: (t.hour + 1) % 24, minute: t.minute);
          }),
          onEnd: (t) => setState(() => _end = t),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _price,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
          decoration: _fieldDecoration('Price (optional)', prefix: 'Rs ', hint: 'Listing price'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _note,
          maxLength: 255,
          textCapitalization: TextCapitalization.sentences,
          decoration: _fieldDecoration('Note (optional)'),
        ),
        PrimaryButton(
          label: n == 0 ? 'No matching days' : 'Create ${Fmtn.plural(n, 'slot')}',
          icon: Icons.repeat_rounded,
          loading: _busy,
          onPressed: _busy || n == 0 ? null : _create,
        ),
      ],
    );
  }
}

class _DayChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _DayChip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: selected ? AppColors.brand : AppColors.ink100,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.md),
          onTap: onTap,
          child: SizedBox(
            height: 44,
            child: Center(
              child: Text(
                label,
                maxLines: 1,
                style: AppType.body(12.5, weight: FontWeight.w600, color: selected ? Colors.white : AppColors.ink600),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// --- Block dates ---------------------------------------------------------------

/// Pick several days on a calendar and block them in one go.
Future<void> showBlockDatesSheet(BuildContext context,
    {required CalendarTarget target, required List<OwnerListing> listings, Set<DateTime>? initial}) {
  return showAppSheet<void>(
    context,
    builder: (_) => _BlockSheet(target: target, listings: listings, initial: initial ?? const {}),
  );
}

class _BlockSheet extends ConsumerStatefulWidget {
  final CalendarTarget target;
  final List<OwnerListing> listings;
  final Set<DateTime> initial;
  const _BlockSheet({required this.target, required this.listings, required this.initial});

  @override
  ConsumerState<_BlockSheet> createState() => _BlockSheetState();
}

class _BlockSheetState extends ConsumerState<_BlockSheet> {
  late CalendarTarget _target = widget.target;
  late DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  late final Set<DateTime> _days = {...widget.initial};
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _block() async {
    setState(() => _busy = true);
    try {
      final days = _days.toList()..sort();
      final r = await ref.read(vendorApiProvider).blockDates(_target, days, note: _note.text.trim());
      if (!mounted) return;
      ref.refreshVendorData();
      final parts = [
        'Blocked ${Fmtn.plural(days.length, 'day')}',
        if (r.skipped > 0) '${Fmtn.plural(r.skipped, 'slot')} with a request left as is',
      ];
      AppToast.success(context, parts.join(' · '));
      Navigator.pop(context);
    } catch (e) {
      if (mounted) AppToast.error(context, vendorErrorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final today = dayOf(DateTime.now());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        const SheetHeader(
          title: 'Block dates',
          message: 'Tap the days you are not available. Open slots on them are blocked; '
              'slots that already have a request stay as they are.',
        ),
        TargetRow(target: _target, listings: widget.listings, onChanged: (t) => setState(() => _target = t)),
        const SizedBox(height: 12),
        MonthHeader(month: _month, firstMonth: today, onChanged: (m) => setState(() => _month = m)),
        const SizedBox(height: 4),
        MonthGrid(
          month: _month,
          selected: _days,
          isDisabled: (d) => d.isBefore(today),
          onTap: (d) => setState(() => _days.contains(d) ? _days.remove(d) : _days.add(d)),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _note,
          maxLength: 255,
          textCapitalization: TextCapitalization.sentences,
          decoration: _fieldDecoration('Note (optional)', hint: 'e.g. Private event'),
        ),
        PrimaryButton(
          label: _days.isEmpty ? 'Pick days to block' : 'Block ${Fmtn.plural(_days.length, 'day')}',
          icon: Icons.block_rounded,
          tone: ButtonTone.neutral,
          loading: _busy,
          onPressed: _busy || _days.isEmpty ? null : _block,
        ),
      ],
    );
  }
}
