import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../attendee/data/attendee_api.dart' show friendlyError;
import '../../attendee/widgets/attendee_widgets.dart' show AsyncErrorView;
import '../../core/api_client.dart';
import '../../core/bs_date.dart';
import '../../providers/event_provider.dart';
import '../../ui/ui.dart';

/// Organizer: email guests of the current event (module guest_management, server apps.events.guests).
/// Same API as the website's Guest messages card: up to 5 messages an hour.
final _api = Provider((ref) => ApiClient());
final _messagesProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final eventId = ref.watch(eventProvider.select((s) => s.currentEvent?.id));
  if (eventId == null) return const [];
  final resp = await ref.watch(_api).get('/api/events/$eventId/guest-messages/');
  return [for (final m in resp.data as List) Map<String, dynamic>.from(m as Map)];
});

const _audiences = {'all': 'Everyone', 'not_arrived': "Haven't arrived", 'inside': 'Checked in'};

class GuestMessagesScreen extends ConsumerStatefulWidget {
  const GuestMessagesScreen({super.key});

  @override
  ConsumerState<GuestMessagesScreen> createState() => _GuestMessagesScreenState();
}

class _GuestMessagesScreenState extends ConsumerState<GuestMessagesScreen> {
  final _formKey = GlobalKey<FormState>();
  final _subject = TextEditingController();
  final _body = TextEditingController();
  String _audience = 'all';
  bool _sending = false;

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;
    final eventId = ref.read(eventProvider).currentEvent?.id;
    if (eventId == null) return;
    final api = ref.read(_api);
    final data = {'subject': _subject.text.trim(), 'body': _body.text.trim(), 'audience': _audience};
    setState(() => _sending = true);
    try {
      final preview = await api.post('/api/events/$eventId/guest-messages/', data: {...data, 'dry_run': true});
      if (!mounted) return;
      final n = preview.data['recipients'];
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text('Send to $n ${n == 1 ? 'guest' : 'guests'}?'),
          content: Text(_subject.text.trim()),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Send')),
          ],
        ),
      );
      if (ok != true) return;
      await api.post('/api/events/$eventId/guest-messages/', data: data);
      if (!mounted) return;
      AppToast.success(context, 'Message sent to $n ${n == 1 ? 'guest' : 'guests'}');
      _subject.clear();
      _body.clear();
      ref.invalidate(_messagesProvider);
    } catch (e) {
      if (mounted) AppToast.error(context, friendlyError(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(_messagesProvider);
    return AppScaffold(
      title: 'Message guests',
      bottomBar: PrimaryButton(label: 'Send message', icon: Icons.send_rounded, loading: _sending, onPressed: _send),
      slivers: [
        SliverToBoxAdapter(
          child: Form(
            key: _formKey,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: FilterPills<String>(
                  segments: [for (final a in _audiences.entries) Segment(a.key, a.value)],
                  selected: _audience,
                  onChanged: (v) => setState(() => _audience = v),
                ),
              ),
              GroupedSection(header: 'Message', separatorInset: 16, children: [
                FieldRow(
                  controller: _subject,
                  label: 'Subject',
                  validator: (s) => (s ?? '').trim().isEmpty ? 'Write a subject' : null,
                ),
                FieldRow(
                  controller: _body,
                  label: 'Message',
                  maxLines: 5,
                  keyboardType: TextInputType.multiline,
                  validator: (s) => (s ?? '').trim().isEmpty ? 'Write a message' : null,
                ),
              ]),
            ]),
          ),
        ),
        ...async.when(
          loading: () => [const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())))],
          error: (e, _) => [SliverToBoxAdapter(child: AsyncErrorView(title: "Couldn't load messages", error: e, onRetry: () => ref.invalidate(_messagesProvider)))],
          data: (all) => [
            if (all.isNotEmpty)
              SliverToBoxAdapter(
                child: GroupedSection(header: 'Sent', children: [
                  for (final m in all)
                    ListRow(
                      title: m['subject'].toString(),
                      subtitle: [
                        _audiences[m['audience']] ?? m['audience'],
                        if (m['created_at'] != null) BsDate.format('d MMM, h:mm a', DateTime.parse('${m['created_at']}').toLocal()),
                      ].join(' · '),
                      value: '${m['recipients']}',
                    ),
                ]),
              ),
          ],
        ),
      ],
    );
  }
}
