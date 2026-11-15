import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';
import '../../providers/auth_provider.dart';
import '../../providers/modules_provider.dart';
import '../../ui/ui.dart';
import '../models/public_event.dart';
import '../screens/event_detail_screen.dart';
import '../widgets/attendee_widgets.dart' show AsyncErrorView, EventCard;

/// Saved events ("favourites") for signed-in people: `/api/me/favourites/`, module `favourites`.
final _api = Provider((ref) => ApiClient());

class SavedEvents {
  final Set<String> ids;
  final List<PublicEvent> events;
  const SavedEvents(this.ids, this.events);
}

final savedEventsProvider = FutureProvider<SavedEvents>((ref) async {
  final signedIn = ref.watch(authProvider.select((s) => s.isLoggedIn));
  final on = ref.watch(moduleEnabledProvider(AppModule.favourites));
  if (!signedIn || !on) return const SavedEvents({}, []);
  final resp = await ref.watch(_api).get('/api/me/favourites/');
  final d = Map<String, dynamic>.from(resp.data as Map);
  return SavedEvents(
    {for (final i in (d['ids'] as List? ?? const [])) '$i'},
    [for (final e in (d['events'] as List? ?? const [])) PublicEvent.fromJson(Map<String, dynamic>.from(e as Map))],
  );
});

/// Heart toggle for one event. Signed out: asks to sign in first.
class FavouriteButton extends ConsumerStatefulWidget {
  final String eventId;
  final String eventSlug;
  final Color color;
  const FavouriteButton({super.key, required this.eventId, required this.eventSlug, this.color = Colors.white});

  @override
  ConsumerState<FavouriteButton> createState() => _FavouriteButtonState();
}

class _FavouriteButtonState extends ConsumerState<FavouriteButton> {
  bool? _optimistic;
  bool _busy = false;

  Future<void> _toggle(bool saved) async {
    if (!ref.read(authProvider).isLoggedIn) {
      AppToast.info(context, 'Sign in from the Profile tab to save events.');
      return;
    }
    setState(() {
      _busy = true;
      _optimistic = !saved;
    });
    try {
      final api = ref.read(_api);
      if (saved) {
        await api.delete('/api/me/favourites/${widget.eventId}/');
      } else {
        await api.post('/api/me/favourites/', data: {'event': widget.eventSlug});
      }
      ref.invalidate(savedEventsProvider);
      if (mounted) AppToast.success(context, saved ? 'Removed from saved events' : 'Saved. Find it under Profile → Saved events.');
    } catch (_) {
      if (mounted) {
        setState(() => _optimistic = null);
        AppToast.error(context, 'Couldn’t update saved events. Try again.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!ref.watch(moduleEnabledProvider(AppModule.favourites))) return const SizedBox.shrink();
    final saved = _optimistic ?? (ref.watch(savedEventsProvider).valueOrNull?.ids.contains(widget.eventId) ?? false);
    return IconButton(
      tooltip: saved ? 'Remove from saved events' : 'Save this event',
      onPressed: _busy ? null : () => _toggle(saved),
      icon: Icon(saved ? Icons.favorite_rounded : Icons.favorite_border_rounded, color: saved ? AppColors.brand : widget.color),
    );
  }
}

/// Profile → Saved events.
class SavedEventsScreen extends ConsumerWidget {
  const SavedEventsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(savedEventsProvider);
    final events = async.valueOrNull?.events ?? const <PublicEvent>[];
    return AppScaffold(
      title: 'Saved events',
      onRefresh: () async => ref.invalidate(savedEventsProvider),
      slivers: [
        if (async.isLoading && async.valueOrNull == null)
          const SliverToBoxAdapter(child: LoadingList(rows: 3))
        else if (async.hasError && async.valueOrNull == null)
          SliverFillRemaining(hasScrollBody: false, child: AsyncErrorView(error: async.error!, onRetry: () => ref.invalidate(savedEventsProvider)))
        else if (events.isEmpty)
          const SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(icon: Icons.favorite_border_rounded, title: 'No saved events yet', message: 'Tap the heart on any event to keep it here.'),
          )
        else
          SliverList.builder(
            itemCount: events.length,
            itemBuilder: (_, i) => EventCard(
              event: events[i],
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => EventDetailScreen(slug: events[i].slug, preview: events[i]))),
            ),
          ),
      ],
    );
  }
}
