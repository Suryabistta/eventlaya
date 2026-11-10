import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../attendee/data/attendee_api.dart' show friendlyError;
import '../../attendee/widgets/attendee_widgets.dart' show AsyncErrorView;
import '../../core/api_client.dart';
import '../../core/bs_date.dart';
import '../../providers/event_provider.dart';
import '../../ui/ui.dart';

/// Organizer: applications to the current event (applications stage, server apps.dynamic_forms): read each one and
/// accept or decline it. The applicant is emailed either way. Same API as the website's Applications card.
final _api = Provider((ref) => ApiClient());
final _filterProvider = StateProvider.autoDispose<String>((ref) => 'pending');
final _applicationsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final eventId = ref.watch(eventProvider.select((s) => s.currentEvent?.id));
  if (eventId == null) return const [];
  final resp = await ref.watch(_api).get('/api/forms/events/$eventId/applications/');
  return [for (final a in resp.data as List) Map<String, dynamic>.from(a as Map)];
});

const _labels = {'pending': 'To review', 'accepted': 'Accepted', 'rejected': 'Not selected'};

class ApplicationsScreen extends ConsumerWidget {
  const ApplicationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(_filterProvider);
    final async = ref.watch(_applicationsProvider);
    return AppScaffold(
      title: 'Applications',
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: FilterPills<String>(
              segments: const [Segment('pending', 'To review'), Segment('accepted', 'Accepted'), Segment('rejected', 'Not selected'), Segment('all', 'All')],
              selected: filter,
              onChanged: (v) => ref.read(_filterProvider.notifier).state = v,
            ),
          ),
        ),
        ...async.when(
          loading: () => [const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator())))],
          error: (e, _) => [SliverToBoxAdapter(child: AsyncErrorView(title: "Couldn't load applications", error: e, onRetry: () => ref.invalidate(_applicationsProvider)))],
          data: (all) {
            final rows = filter == 'all' ? all : all.where((a) => a['review_status'] == filter).toList();
            if (rows.isEmpty) {
              return [const SliverToBoxAdapter(child: EmptyState(icon: Icons.assignment_outlined, title: 'Nothing here', message: 'Applications appear here as people apply.'))];
            }
            return [
              SliverToBoxAdapter(
                child: GroupedSection(children: [
                  for (final a in rows)
                    ListRow(
                      title: a['submitter_name'].toString(),
                      subtitle: [a['submitter_email'], BsDate.format('d MMM', DateTime.parse('${a['submitted_at']}').toLocal())].join(' · '),
                      value: _labels[a['review_status']] ?? '',
                      chevron: true,
                      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => _ApplicationDetail(application: a))),
                    ),
                ]),
              ),
            ];
          },
        ),
      ],
    );
  }
}

class _ApplicationDetail extends ConsumerStatefulWidget {
  final Map<String, dynamic> application;
  const _ApplicationDetail({required this.application});

  @override
  ConsumerState<_ApplicationDetail> createState() => _ApplicationDetailState();
}

class _ApplicationDetailState extends ConsumerState<_ApplicationDetail> {
  late Map<String, dynamic> a = widget.application;
  final _note = TextEditingController();
  bool _busy = false;

  Future<void> _review(String status) async {
    setState(() => _busy = true);
    try {
      final resp = await ref.read(_api).post('/api/forms/responses/${a['id']}/review/', data: {'status': status, 'note': _note.text.trim()});
      setState(() => a = Map<String, dynamic>.from(resp.data as Map));
      ref.invalidate(_applicationsProvider);
      if (mounted) AppToast.success(context, status == 'accepted' ? 'Accepted · they were emailed' : status == 'rejected' ? 'Not selected · they were emailed' : 'Back to review');
    } catch (e) {
      if (mounted) AppToast.error(context, friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _value(dynamic raw) {
    final v = raw is Map && raw.containsKey('value') ? raw['value'] : raw;
    final text = v is List ? v.join(', ') : (v ?? '').toString();
    final isLink = text.startsWith('http') || text.startsWith('/media/');
    if (!isLink) return Text(text.isEmpty ? '–' : text, style: AppType.body(14));
    return InkWell(
      onTap: () {
        final uri = text.startsWith('/') ? Uri.parse('https://eventlaya.com$text') : Uri.parse(text);
        launchUrl(uri, mode: LaunchMode.externalApplication);
      },
      child: Text(text.startsWith('/media/') ? 'Open file' : text, style: AppType.body(14, weight: FontWeight.w600, color: AppColors.brand)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final answers = [for (final x in (a['answers'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
    return AppScaffold(
      title: a['submitter_name'].toString(),
      bottomBar: Row(children: [
        Expanded(child: PrimaryButton(label: 'Not selected', tonal: true, loading: _busy, onPressed: () => _review('rejected'))),
        const SizedBox(width: 8),
        Expanded(child: PrimaryButton(label: 'Accept', icon: Icons.check_rounded, loading: _busy, onPressed: () => _review('accepted'))),
      ]),
      slivers: [
        SliverToBoxAdapter(
          child: GroupedSection(header: _labels[a['review_status']] ?? '', children: [
            ListRow(title: 'Email', value: a['submitter_email'].toString()),
            ListRow(title: 'Phone', value: (a['submitter_phone'] ?? '').toString()),
            if ((a['number'] ?? '').toString().isNotEmpty) ListRow(title: 'No.', value: a['number'].toString()),
          ]),
        ),
        SliverToBoxAdapter(
          child: GroupedSection(header: 'Answers', children: [
            for (final ans in answers)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(ans['field_label'].toString(), style: AppType.caption),
                  const SizedBox(height: 2),
                  _value(ans['value']),
                ]),
              ),
          ]),
        ),
        SliverToBoxAdapter(
          child: GroupedSection(header: 'Note if not selected (optional)', children: [
            FieldRow(controller: _note, label: 'Included in the email', maxLines: 3),
          ]),
        ),
      ],
    );
  }
}
