import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../attendee/data/attendee_api.dart' show friendlyError;
import '../../providers/auth_provider.dart';
import '../../ui/ui.dart';
import '../chat_models.dart';
import '../chat_providers.dart';
import '../chat_widgets.dart';

final chatContactsProvider = FutureProvider.autoDispose<List<ChatUser>>((ref) => ref.watch(chatApiProvider).contacts());

/// Start a direct chat with a teammate; organizers can also create a group.
/// Pops with the conversation to open.
class NewChatScreen extends ConsumerStatefulWidget {
  const NewChatScreen({super.key});

  @override
  ConsumerState<NewChatScreen> createState() => _NewChatScreenState();
}

class _NewChatScreenState extends ConsumerState<NewChatScreen> {
  String _q = '';
  String? _busy;

  Future<void> _start(ChatUser u) async {
    setState(() => _busy = u.id);
    try {
      final conv = await ref.read(chatApiProvider).startDirect(u.id);
      ref.read(chatControllerProvider.notifier).upsert(conv);
      if (mounted) Navigator.of(context).pop(conv);
    } catch (e) {
      if (mounted) AppToast.error(context, friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(chatContactsProvider);
    final isOrganizer = ref.watch(authProvider).user?.isAdmin ?? false;
    final people = (async.valueOrNull ?? const <ChatUser>[])
        .where((p) => _q.isEmpty || p.name.toLowerCase().contains(_q) || p.email.toLowerCase().contains(_q))
        .toList();
    return AppScaffold(
      title: 'New chat',
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: TextField(
              onChanged: (v) => setState(() => _q = v.trim().toLowerCase()),
              decoration: const InputDecoration(hintText: 'Search your team', prefixIcon: Icon(Icons.search_rounded)),
            ),
          ),
        ),
        if (isOrganizer)
          SliverToBoxAdapter(
            child: GroupedSection(children: [
              ListRow(
                leading: const RowIcon(Icons.group_add_rounded),
                title: 'New group',
                chevron: true,
                onTap: () async {
                  final conv = await Navigator.of(context).push<Conversation>(
                    MaterialPageRoute(builder: (_) => NewGroupScreen(people: async.valueOrNull ?? const [])),
                  );
                  if (conv != null && context.mounted) Navigator.of(context).pop(conv);
                },
              ),
            ]),
          ),
        if (async.hasError && async.valueOrNull == null)
          SliverToBoxAdapter(
            child: ErrorState(message: friendlyError(async.error!), onRetry: () => ref.invalidate(chatContactsProvider)),
          )
        else if (async.isLoading)
          const SliverToBoxAdapter(child: LoadingList(rows: 5))
        else if (people.isEmpty)
          const SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.groups_outlined,
              title: 'No teammates yet',
              message: 'People on your team with chat switched on show up here.',
            ),
          )
        else
          SliverToBoxAdapter(
            child: GroupedSection(
              header: 'Team',
              separatorInset: 68,
              children: [
                for (final p in people)
                  ListRow(
                    leading: ChatAvatar(name: p.name, imageUrl: p.avatar, size: 40),
                    title: p.name,
                    subtitle: [if (p.roleLabel.isNotEmpty) p.roleLabel, p.email].join(' · '),
                    trailing: _busy == p.id
                        ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : null,
                    onTap: _busy == null ? () => _start(p) : null,
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

/// Organizer: name a group and pick members.
class NewGroupScreen extends ConsumerStatefulWidget {
  final List<ChatUser> people;
  const NewGroupScreen({super.key, required this.people});

  @override
  ConsumerState<NewGroupScreen> createState() => _NewGroupScreenState();
}

class _NewGroupScreenState extends ConsumerState<NewGroupScreen> {
  final _title = TextEditingController();
  Set<String> _selected = {};
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    if (_title.text.trim().isEmpty) {
      AppToast.error(context, 'Give the group a name');
      return;
    }
    if (_selected.isEmpty) {
      AppToast.error(context, 'Add at least one person');
      return;
    }
    setState(() => _busy = true);
    try {
      final conv = await ref.read(chatApiProvider).createGroup(_title.text.trim(), _selected.toList());
      ref.read(chatControllerProvider.notifier).upsert(conv);
      if (mounted) Navigator.of(context).pop(conv);
    } catch (e) {
      if (mounted) AppToast.error(context, friendlyError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'New group',
      bottomBar: PrimaryButton(
        label: _selected.isEmpty ? 'Create group' : 'Create group · ${_selected.length}',
        loading: _busy,
        onPressed: _create,
      ),
      slivers: [
        SliverToBoxAdapter(
          child: GroupedSection(children: [
            FieldRow(controller: _title, label: 'Group name', icon: Icons.groups_rounded, autofocus: true),
          ]),
        ),
        SliverToBoxAdapter(
          child: ContactPicker(people: widget.people, selected: _selected, onChanged: (s) => setState(() => _selected = s)),
        ),
      ],
    );
  }
}
