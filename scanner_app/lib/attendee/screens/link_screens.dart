import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/deep_links.dart';
import '../../payments/payment_models.dart';
import '../../payments/payment_result_screen.dart';
import '../../ui/ui.dart';
import '../data/attendee_api.dart';
import '../data/pass_store.dart';
import '../models/stored_pass.dart';
import '../providers/explore_providers.dart';
import '../providers/pass_providers.dart';
import '../widgets/attendee_widgets.dart';
import 'contest_screen.dart';
import 'contestant_screen.dart';
import 'event_detail_screen.dart';
import 'pass_view_screen.dart';
import 'poll_screen.dart';

final _uuid = RegExp(r'^[0-9a-fA-F-]{32,36}$');

/// Opens the screen for an App Link on top of whatever is showing.
Future<void> openDeepLink(NavigatorState nav, DeepLink link) async {
  Route<void> page(Widget w) => MaterialPageRoute(builder: (_) => w);
  switch (link) {
    case EventLink(:final eventSlug):
      await nav.push(page(EventDetailScreen(slug: eventSlug)));
    case VoteLink(:final eventSlug, :final ref):
      await nav.push(page(_uuid.hasMatch(ref)
          ? VoteLinkScreen(eventSlug: eventSlug, id: ref)
          : ContestScreen(eventSlug: eventSlug, contestRef: ref)));
    case ContestantLinkTarget(:final eventSlug, :final contestRef, :final contestantRef):
      await nav.push(page(ContestantScreen(eventSlug: eventSlug, contestRef: contestRef, contestantRef: contestantRef)));
    case TicketLink(:final token):
      await nav.push(page(TicketLinkScreen(token: token)));
    case PaymentReturnLink(:final intentId, :final status):
      await openPaymentResult(nav, intentId, statusHint: status);
  }
}

/// Shows a payment's status (polling until it settles) and, once paid, what it bought:
/// a ticket order's passes, or the contest the votes were for.
Future<void> openPaymentResult(NavigatorState nav, String intentId, {String? statusHint, PaymentIntent? initial}) async {
  final r = await nav.push<PaymentResult>(MaterialPageRoute(
    builder: (_) => PaymentResultScreen(intentId: intentId, statusHint: statusHint, initial: initial, doneLabel: 'Continue'),
  ));
  final intent = r?.intent;
  if (r?.next != PaymentNext.done || intent == null || !nav.mounted) return;
  final result = intent.result ?? const <String, dynamic>{};
  if (intent.purpose == 'vote_pack' && result['contest'] is Map) {
    final c = Map<String, dynamic>.from(result['contest'] as Map);
    final slug = c['event_slug']?.toString(), ref = (c['slug'] ?? c['id'])?.toString();
    if (slug != null && ref != null) await nav.push(MaterialPageRoute(builder: (_) => ContestScreen(eventSlug: slug, contestRef: ref)));
    return;
  }
  final tickets = [
    if (result['tickets'] is List)
      for (final t in result['tickets'] as List)
        if (t is Map) Map<String, dynamic>.from(t),
  ];
  final event = result['event'] is Map ? Map<String, dynamic>.from(result['event'] as Map) : null;
  if (tickets.isEmpty || event == null) return;
  final container = ProviderScope.containerOf(nav.context, listen: false);
  final passes = await _passesFor(container.read(attendeeApiProvider), tickets, event);
  await container.read(passesProvider.notifier).saveAll(passes);
  if (nav.mounted) await nav.push(MaterialPageRoute(builder: (_) => PassViewScreen(passes: passes, banner: 'Paid! Your passes are saved on this phone.')));
}

Future<List<StoredPass>> _passesFor(AttendeeApi api, List<Map<String, dynamic>> tickets, Map<String, dynamic> event) async {
  final slug = event['slug']?.toString() ?? '';
  try {
    final detail = await api.event(slug);
    return [for (final t in tickets) StoredPass.fromRegistration(t, detail.event)];
  } catch (_) {
    return [for (final t in tickets) StoredPass.fromAccount({...t, 'event': event}).withSource('device')];
  }
}

/// `/e/<slug>/vote/<uuid>`: a quick poll or a contest by id — look it up, then show the right page.
class VoteLinkScreen extends ConsumerStatefulWidget {
  final String eventSlug;
  final String id;
  const VoteLinkScreen({super.key, required this.eventSlug, required this.id});

  @override
  ConsumerState<VoteLinkScreen> createState() => _VoteLinkScreenState();
}

class _VoteLinkScreenState extends ConsumerState<VoteLinkScreen> {
  Object? _error;

  @override
  void initState() {
    super.initState();
    _resolve();
  }

  Future<void> _resolve() async {
    setState(() => _error = null);
    try {
      final r = await ref.read(attendeeApiProvider).pollOrContest(widget.eventSlug, widget.id);
      if (!mounted) return;
      final next = r.contest != null
          ? ContestScreen(eventSlug: widget.eventSlug, contestRef: r.contest!.ref, preview: r.contest)
          : PollScreen(slug: widget.eventSlug, pollId: widget.id, initial: r.poll);
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => next));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(leading: const BackButton(color: AppColors.brand)),
        body: _error == null
            ? const Center(child: CircularProgressIndicator())
            : AsyncErrorView(error: _error!, onRetry: _resolve, title: "Couldn't open this vote"),
      );
}

/// `/ticket/<token>`: the pass from the confirmation email — from this phone if saved, else
/// fetched, saved and shown.
class TicketLinkScreen extends ConsumerStatefulWidget {
  final String token;
  const TicketLinkScreen({super.key, required this.token});

  @override
  ConsumerState<TicketLinkScreen> createState() => _TicketLinkScreenState();
}

class _TicketLinkScreenState extends ConsumerState<TicketLinkScreen> {
  Object? _error;

  @override
  void initState() {
    super.initState();
    _open();
  }

  Future<void> _open() async {
    setState(() => _error = null);
    try {
      final saved = (await PassStore.load()).where((p) => p.qrToken == widget.token).firstOrNull;
      final pass = saved ?? await ref.read(attendeeApiProvider).publicPass(widget.token);
      if (saved == null) await ref.read(passesProvider.notifier).save(pass);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => PassViewScreen(pass: pass, banner: saved == null ? 'Your pass is now saved on this phone.' : null),
      ));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(leading: const BackButton(color: AppColors.brand)),
        body: _error == null
            ? const Center(child: CircularProgressIndicator())
            : AsyncErrorView(error: _error!, onRetry: _open, title: "Couldn't open this pass"),
      );
}
