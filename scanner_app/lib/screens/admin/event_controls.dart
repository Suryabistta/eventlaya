import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../attendee/data/attendee_api.dart' show friendlyError;
import '../../core/api_client.dart';
import '../../core/bs_date.dart';
import '../../providers/modules_provider.dart';
import '../../ui/ui.dart';

/// Organizer: "Event controls", same as the website dashboard card. One row per stage (applications, voting,
/// tickets / registration) with its state and Open / Close, plus Publish. Each action saves right away.
final _api = Provider((ref) => ApiClient());

final _contestsProvider = FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((ref, eventId) async {
  final resp = await ref.watch(_api).get('/api/voting/contests/', queryParameters: {'event': eventId});
  final d = resp.data;
  final list = d is List ? d : (d is Map && d['results'] is List ? d['results'] as List : const []);
  return [for (final c in list) Map<String, dynamic>.from(c as Map)];
});

class EventControlsSection extends ConsumerStatefulWidget {
  final Map<String, dynamic> event;
  /// Called after a change so the parent reloads the event.
  final VoidCallback onChanged;
  const EventControlsSection({super.key, required this.event, required this.onChanged});

  @override
  ConsumerState<EventControlsSection> createState() => _EventControlsSectionState();
}

class _EventControlsSectionState extends ConsumerState<EventControlsSection> {
  bool _busy = false;

  Map<String, dynamic> get e => widget.event;
  String get _id => '${e['id']}';

  Future<void> _run(Future<void> Function() action, String done) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(_contestsProvider(_id));
      widget.onChanged();
      if (mounted) AppToast.success(context, done);
    } catch (err) {
      if (mounted) AppToast.error(context, friendlyError(err));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _patch(Map<String, dynamic> data, String done) => _run(() => ref.read(_api).patch('/api/events/$_id/', data: data), done);

  Future<DateTime?> _pickDateTime(DateTime? initial) async {
    final now = DateTime.now();
    final start = initial != null && initial.isAfter(now) ? initial : now.add(const Duration(days: 1));
    final d = await showBsDatePicker(context: context, initialDate: start, firstDate: now, lastDate: DateTime(now.year + 3));
    if (d == null || !mounted) return null;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(initial ?? DateTime(d.year, d.month, d.day, 23, 59)));
    if (t == null) return null;
    final picked = DateTime(d.year, d.month, d.day, t.hour, t.minute);
    if (!picked.isAfter(DateTime.now())) {
      if (mounted) AppToast.error(context, 'Pick a time in the future.');
      return null;
    }
    return picked;
  }

  static DateTime? _date(Object? v) => v == null ? null : DateTime.tryParse('$v')?.toLocal();
  static String _fmt(DateTime d) => BsDate.format('d MMM, h:mm a', d);

  Widget _row({required IconData icon, required String title, required String state, required Tone tone, required String detail, required List<Widget> actions}) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Icon(icon, size: 20, color: AppColors.brand),
          const SizedBox(width: 10),
          Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15))),
          StatusBadge(state, tone: tone),
        ]),
        Padding(
          padding: const EdgeInsets.only(left: 30, top: 2),
          child: Text(detail, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        ),
        const SizedBox(height: 8),
        Padding(padding: const EdgeInsets.only(left: 30), child: Wrap(spacing: 8, runSpacing: 8, children: actions)),
      ]),
    );
  }

  Widget _btn(String label, VoidCallback onTap, {bool primary = false}) => SizedBox(
        height: 36,
        child: primary
            ? FilledButton(onPressed: _busy ? null : onTap, style: FilledButton.styleFrom(backgroundColor: AppColors.brand), child: Text(label))
            : OutlinedButton(onPressed: _busy ? null : onTap, child: Text(label)),
      );

  @override
  Widget build(BuildContext context) {
    final contestsOn = ref.watch(moduleEnabledProvider(AppModule.contests));
    final applicationsOn = ref.watch(moduleEnabledProvider(AppModule.applications));
    final contests = contestsOn ? (ref.watch(_contestsProvider(_id)).valueOrNull ?? const []) : const <Map<String, dynamic>>[];
    final now = DateTime.now();
    final status = '${e['status']}';
    final published = status != 'draft';
    final over = status == 'completed' || status == 'cancelled';
    final formOnly = e['registration_mode'] == 'form';
    final isPageant = e['event_kind'] == 'pageant' || (e['applications_enabled'] == true && e['tickets_enabled'] == false);

    final appsOn = e['applications_enabled'] == true;
    final appsClose = _date(e['applications_close']);
    // Applications also need a published application form (made on the website)
    final appsNoForm = appsOn && (e['application_form'] == null || '${e['application_form']}'.isEmpty);
    // The server's reason (what visitors see) decides, not the dates alone
    final appsReason = e['applications_closed_reason'] as String?;
    final appsOpen = appsOn && appsReason == null;

    final ticketsOn = e['tickets_enabled'] != false;
    final deadline = _date(e['registration_deadline']);
    final salesReason = e['registration_closed_reason'] as String?;
    final salesOpen = ticketsOn && salesReason == null;

    // Registration set to open by itself (module stage_schedule); "linked" = it opens the moment applications close
    final scheduleOn = ref.watch(moduleEnabledProvider(AppModule.stageSchedule));
    final opensAt = scheduleOn ? _date(e['registration_opens']) : null;
    final scheduled = opensAt != null && opensAt.isAfter(now);
    final linked = scheduled && appsClose != null && opensAt.difference(appsClose).inSeconds.abs() < 60;
    final ticketWord = formOnly ? 'Registration' : (isPageant ? 'Finale tickets' : 'Ticketing');

    Future<void> pickOpening() async {
      final d = await _pickDateTime(opensAt ?? appsClose);
      if (d == null) return;
      if (deadline != null && !d.isBefore(deadline)) {
        if (context.mounted) AppToast.error(context, 'Registration must open before its deadline.');
        return;
      }
      await _patch({'registration_opens': d.toUtc().toIso8601String()}, 'Opens by itself ${_fmt(d)}');
    }

    final warnings = <String>[
      if (appsNoForm) 'Applications can’t open yet: this event has no application form. Add one on the website (Dynamic forms).',
      if (!published && (appsOpen || salesOpen || contests.any((c) => c['status'] == 'open')))
        'The event is still a draft, so the public can’t see anything that’s open. Publish it to go live.',
      for (final c in contests)
        if (c['status'] == 'open' && ((c['stats'] as Map?)?['contestants'] ?? 0) == 0) '“${c['title']}” is open for voting but has no contestants.',
    ];

    return GroupedSection(
      header: 'Event controls',
      footer: 'Changes here save right away.',
      separatorInset: 16,
      children: [
        ListRow(
          title: published ? (over ? (status == 'completed' ? 'Completed' : 'Cancelled') : 'Published') : 'Draft',
          subtitle: published ? 'The event page is public' : 'Only you can see this event',
          trailing: over
              ? null
              : _btn(published ? 'Unpublish' : 'Publish', () async {
                  if (published &&
                      !await confirmSheet(context, title: 'Unpublish this event?', message: 'Its page goes offline and nobody can sign up, apply or vote until you publish it again.', confirmLabel: 'Unpublish')) {
                    return;
                  }
                  await _patch({'status': published ? 'draft' : 'published'}, published ? 'Event unpublished' : 'Event published');
                }, primary: !published),
        ),
        if (applicationsOn && appsOn)
          _row(
            icon: Icons.assignment_outlined,
            title: 'Applications',
            state: appsOpen ? 'Open' : 'Closed',
            tone: appsOpen ? Tone.success : Tone.neutral,
            detail: !appsOpen && appsReason != null ? 'Visitors see: “$appsReason”' : appsClose == null ? 'No closing date' : '${appsOpen ? 'Closes' : 'Closed'} ${_fmt(appsClose)}',
            actions: [
              if (appsOpen)
                _btn('Close now', () async {
                  if (await confirmSheet(context,
                      title: 'Close applications now?',
                      message: linked
                          ? 'Nobody can apply after this, and ${ticketWord.toLowerCase()} opens now instead of on its scheduled time.'
                          : 'Nobody can apply after this. Reopen by picking a new closing date.',
                      confirmLabel: 'Close now')) {
                    final at = DateTime.now().toUtc().toIso8601String();
                    await _patch(
                        linked ? {'applications_close': at, 'tickets_enabled': true, 'allow_registration': true} : {'applications_close': at},
                        'Applications closed');
                  }
                }),
              _btn(appsOpen ? 'Change date' : 'Reopen…', () async {
                final d = await _pickDateTime(appsClose);
                // Linked schedule: moving the applications deadline moves the registration opening with it
                if (d != null) {
                  final at = d.toUtc().toIso8601String();
                  await _patch({'applications_close': at, if (linked) 'registration_opens': at}, 'Closing date saved');
                }
              }, primary: !appsOpen),
            ],
          ),
        for (final c in contests)
          Builder(builder: (_) {
            final st = '${c['status']}';
            final opens = _date(c['opens_at']);
            final closes = _date(c['closes_at']);
            final label = {'open': 'Open', 'scheduled': 'Scheduled', 'closed': 'Closed'}[st] ?? 'Not open yet';
            final detail = st == 'open'
                ? (closes != null ? 'Closes ${_fmt(closes)}' : 'No closing time')
                : st == 'scheduled'
                    ? 'Opens ${opens != null ? _fmt(opens) : 'soon'}${closes != null ? ' · closes ${_fmt(closes)}' : ''}'
                    : st == 'closed'
                        ? 'Closed'
                        : '${(c['stats'] as Map?)?['contestants'] ?? 0} contestants added';
            return _row(
              icon: Icons.how_to_vote_outlined,
              title: contests.length > 1 ? 'Voting: ${c['title']}' : 'Voting',
              state: label,
              tone: st == 'open' ? Tone.success : st == 'scheduled' ? Tone.brand : Tone.neutral,
              detail: detail,
              actions: [
                if (st == 'open')
                  _btn('Close now', () async {
                    if (await confirmSheet(context, title: 'Close voting now?', message: 'Nobody can vote until you open it again.', confirmLabel: 'Close voting')) {
                      await _run(() => ref.read(_api).post('/api/voting/contests/${c['id']}/status/close/'), 'Voting closed');
                    }
                  })
                else if (((c['stats'] as Map?)?['contestants'] ?? 0) == 0)
                  _btn('Add contestants first', () => AppToast.info(context, 'Add contestants on the website (Voting → Set up), then open voting.'))
                else
                  _btn(st == 'closed' ? 'Reopen' : 'Open now', () => _run(() => ref.read(_api).post('/api/voting/contests/${c['id']}/status/open/'), 'Voting is open'), primary: true),
                _btn('Schedule', () async {
                  final d = await _pickDateTime(opens);
                  if (d == null) return;
                  await _run(() => ref.read(_api).patch('/api/voting/contests/${c['id']}/', data: {'status': 'scheduled', 'opens_at': d.toUtc().toIso8601String()}),
                      'Voting opens ${_fmt(d)}');
                }),
              ],
            );
          }),
        if (scheduled)
          _row(
            icon: Icons.confirmation_number_outlined,
            title: ticketWord,
            state: 'Scheduled',
            tone: Tone.brand,
            detail: 'Opens by itself ${_fmt(opensAt)}${linked ? ' (when applications close)' : ''}',
            actions: [
              _btn('Open now', () => _patch({'tickets_enabled': true, 'allow_registration': true}, '$ticketWord is open'), primary: true),
              _btn('Cancel schedule', () => _patch({'registration_opens': null}, 'Schedule cancelled')),
              _btn('Change time', pickOpening),
            ],
          ),
        if (ticketsOn && !scheduled)
          _row(
            icon: Icons.confirmation_number_outlined,
            title: ticketWord,
            state: salesOpen ? 'Open' : 'Closed',
            tone: salesOpen ? Tone.success : Tone.neutral,
            detail: !salesOpen && salesReason != null
                ? 'Visitors see: “$salesReason”'
                : deadline != null
                    ? 'Until ${_fmt(deadline)}'
                    : 'Open until the event',
            actions: [
              if (salesOpen)
                _btn('Close now', () => _patch({'allow_registration': false}, '${formOnly ? 'Registration' : 'Ticket sales'} closed'))
              else
                _btn('Open now', () async {
                  if (deadline != null && deadline.isBefore(now)) {
                    final d = await _pickDateTime(null);
                    if (d != null) await _patch({'allow_registration': true, 'registration_deadline': d.toUtc().toIso8601String()}, 'Open again');
                  } else {
                    await _patch({'allow_registration': true}, 'Open again');
                  }
                }, primary: true),
              if (!salesOpen && scheduleOn && !over) _btn('Schedule', pickOpening),
            ],
          ),
        if (!ticketsOn && !scheduled && scheduleOn && !over && e['date_tba'] != true)
          ListRow(
            title: '${formOnly ? 'Registration' : 'Tickets'} later (scheduled)',
            subtitle: 'Opens by itself at the time you pick',
            leading: const Icon(Icons.schedule_rounded, color: AppColors.brand),
            onTap: _busy ? null : pickOpening,
          ),
        if (contestsOn && isPageant && contests.isEmpty)
          ListRow(
            title: 'Add voting',
            subtitle: 'Create the contest, then add contestants on the website',
            leading: const Icon(Icons.add_circle_outline_rounded, color: AppColors.brand),
            onTap: _busy
                ? null
                : () => _run(() => ref.read(_api).post('/api/voting/contests/', data: {'event': _id, 'title': '${e['title']}', 'preset': 'simple'}), 'Voting added'),
          ),
        for (final w in warnings)
          ListRow(
            title: w,
            leading: const Icon(Icons.warning_amber_rounded, color: AppColors.marigoldDark),
          ),
      ],
    );
  }
}
