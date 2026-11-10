import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../attendee/data/attendee_api.dart' show friendlyError;
import '../../attendee/widgets/attendee_widgets.dart' show AsyncErrorView;
import '../../core/api_client.dart';
import '../../providers/event_provider.dart';
import '../../providers/modules_provider.dart';
import '../../ui/ui.dart';

/// Organizer: the newer settings of the current event (stages, registration, guests), PATCHed to /api/events/<id>/.
/// Everything else (dates, venue, tickets, forms) is edited on the website.
final _api = Provider((ref) => ApiClient());
final _settingsProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final eventId = ref.watch(eventProvider.select((s) => s.currentEvent?.id));
  if (eventId == null) return const {};
  final resp = await ref.watch(_api).get('/api/events/$eventId/');
  return Map<String, dynamic>.from(resp.data as Map);
});

class EventSettingsScreen extends ConsumerStatefulWidget {
  const EventSettingsScreen({super.key});

  @override
  ConsumerState<EventSettingsScreen> createState() => _EventSettingsScreenState();
}

class _EventSettingsScreenState extends ConsumerState<EventSettingsScreen> {
  final _changes = <String, dynamic>{};
  final _cta = TextEditingController();
  final _applyCta = TextEditingController();
  final _bibStart = TextEditingController();
  bool _loaded = false;
  bool _saving = false;

  @override
  void dispose() {
    for (final c in [_cta, _applyCta, _bibStart]) {
      c.dispose();
    }
    super.dispose();
  }

  void _load(Map<String, dynamic> e) {
    if (_loaded) return;
    _loaded = true;
    _cta.text = '${e['cta_label'] ?? ''}';
    _applyCta.text = '${e['application_cta'] ?? ''}';
    _bibStart.text = '${e['bib_start'] ?? 1}';
  }

  Future<void> _save(Map<String, dynamic> e) async {
    final data = {
      ..._changes,
      if (_cta.text.trim() != '${e['cta_label'] ?? ''}') 'cta_label': _cta.text.trim(),
      if (_applyCta.text.trim() != '${e['application_cta'] ?? ''}') 'application_cta': _applyCta.text.trim(),
      if (_bibStart.text.trim() != '${e['bib_start'] ?? 1}') 'bib_start': int.tryParse(_bibStart.text.trim()) ?? 1,
    };
    if (data.isEmpty) {
      Navigator.of(context).pop();
      return;
    }
    setState(() => _saving = true);
    try {
      await ref.read(_api).patch('/api/events/${e['id']}/', data: data);
      if (!mounted) return;
      AppToast.success(context, 'Settings saved');
      Navigator.of(context).pop();
    } catch (err) {
      if (mounted) AppToast.error(context, friendlyError(err));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _toggle(Map<String, dynamic> e, String key, String title, String subtitle) {
    final on = (_changes[key] ?? e[key]) == true;
    return ListRow(
      title: title,
      subtitle: subtitle,
      trailing: Switch.adaptive(value: on, onChanged: (v) => setState(() => _changes[key] = v)),
      onTap: () => setState(() => _changes[key] = !on),
    );
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(_settingsProvider);
    final e = async.valueOrNull;
    return AppScaffold(
      title: 'Event settings',
      bottomBar: e == null || e.isEmpty ? null : PrimaryButton(label: 'Save', loading: _saving, onPressed: () => _save(e)),
      slivers: [
        ...async.when(
          loading: () => [const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())))],
          error: (err, _) => [SliverToBoxAdapter(child: AsyncErrorView(title: "Couldn't load the event", error: err, onRetry: () => ref.invalidate(_settingsProvider)))],
          data: (e) {
            if (e.isEmpty) return [const SliverToBoxAdapter(child: EmptyState(icon: Icons.event_busy_rounded, title: 'No event selected', message: 'Choose an event first.'))];
            _load(e);
            final mode = _changes['registration_mode'] ?? e['registration_mode'];
            final tickets = (_changes['tickets_enabled'] ?? e['tickets_enabled']) == true;
            final applications = (_changes['applications_enabled'] ?? e['applications_enabled']) == true;
            final bibs = (_changes['bib_numbers'] ?? e['bib_numbers']) == true;
            return [
              SliverToBoxAdapter(
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  GroupedSection(header: 'Stages', separatorInset: 16, children: [
                    _toggle(e, 'tickets_enabled', 'Tickets & registration', 'People can get tickets or register'),
                    _toggle(e, 'applications_enabled', 'Applications', 'People can apply (film submissions, contestants…)'),
                    if (applications) FieldRow(controller: _applyCta, label: 'Apply button text', hint: 'Apply'),
                  ]),
                  if (tickets)
                    GroupedSection(header: 'Registration', separatorInset: 16, children: [
                      ListRow(
                        title: 'Registration only',
                        subtitle: 'Free sign-up with no pass or ticket types',
                        trailing: Switch.adaptive(
                          value: mode == 'form',
                          onChanged: (v) => setState(() => _changes['registration_mode'] = v ? 'form' : 'pass'),
                        ),
                      ),
                      FieldRow(controller: _cta, label: 'Button text', hint: 'Get tickets, Register…'),
                      _toggle(e, 'phone_required', 'Phone number required', 'Ask every guest for a mobile number'),
                      _toggle(e, 'bib_numbers', 'Bib numbers', 'Number each guest (races, marathons)'),
                      if (bibs) FieldRow(controller: _bibStart, label: 'First bib number', keyboardType: TextInputType.number),
                    ]),
                  GroupedSection(header: 'Guests', separatorInset: 16, children: [
                    _toggle(e, 'reminders_enabled', 'Reminders', 'Email guests before the event starts'),
                    if ((_changes['reminders_enabled'] ?? e['reminders_enabled']) == true && ref.watch(moduleEnabledProvider(AppModule.sms)))
                      _toggle(e, 'reminders_sms', 'Also remind by SMS', 'Uses your SMS credits, one per guest each time'),
                    _toggle(e, 'arrival_alerts', 'Arrival alerts', 'Tell you when tagged guests (VIP, Press…) arrive'),
                  ]),
                ]),
              ),
            ];
          },
        ),
      ],
    );
  }
}
