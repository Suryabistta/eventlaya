import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../attendee/data/attendee_api.dart' show friendlyError;
import '../../providers/auth_provider.dart';
import '../../ui/ui.dart';
import '../chat_models.dart';
import '../chat_providers.dart';
import '../chat_socket.dart';
import '../chat_widgets.dart';
import 'chat_thread_screen.dart';
import 'new_chat_screen.dart';

/// Chat tab: conversations (newest activity first) with search, unread
/// counts, event-crew badge and muted icon.
class ChatListScreen extends ConsumerStatefulWidget {
  const ChatListScreen({super.key});

  @override
  ConsumerState<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends ConsumerState<ChatListScreen> {
  String _q = '';

  void _open(Conversation c) =>
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => ChatThreadScreen(conversationId: c.id, initial: c)));

  Future<void> _newChat() async {
    final conv = await Navigator.of(context).push<Conversation>(MaterialPageRoute(builder: (_) => const NewChatScreen()));
    if (conv != null && mounted) _open(conv);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(chatControllerProvider);
    final me = ref.watch(authProvider).user?.id ?? '';
    final all = state.conversations;
    final list = (all ?? const <Conversation>[])
        .where((c) => _q.isEmpty || c.title.toLowerCase().contains(_q) || (c.eventTitle ?? '').toLowerCase().contains(_q))
        .toList();

    return AppScaffold(
      title: 'Chat',
      onRefresh: () => ref.read(chatControllerProvider.notifier).load(),
      actions: [AppIconButton(icon: Icons.edit_square, tooltip: 'New chat', onPressed: _newChat)],
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: TextField(
              onChanged: (v) => setState(() => _q = v.trim().toLowerCase()),
              decoration: const InputDecoration(hintText: 'Search chats', prefixIcon: Icon(Icons.search_rounded)),
            ),
          ),
        ),
        if (state.connection == ChatConnection.connecting || (state.connection == ChatConnection.offline && all != null))
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(left: 4, bottom: 10),
              child: Row(children: [
                const SizedBox.square(dimension: 12, child: CircularProgressIndicator(strokeWidth: 1.6)),
                const SizedBox(width: 8),
                Text(state.connection == ChatConnection.connecting ? 'Connecting…' : 'Waiting for network…',
                    style: AppType.caption),
              ]),
            ),
          ),
        if (all == null && state.error != null)
          SliverFillRemaining(
            hasScrollBody: false,
            child: ErrorState(
              title: "Couldn't load chats",
              message: friendlyError(state.error!),
              onRetry: () => ref.read(chatControllerProvider.notifier).load(),
            ),
          )
        else if (all == null)
          const SliverToBoxAdapter(child: LoadingList(rows: 6))
        else if (list.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.forum_outlined,
              title: _q.isEmpty ? 'No chats yet' : 'No chats match',
              message: _q.isEmpty
                  ? 'Message your team. Event crew groups appear here automatically when staff are assigned to gates.'
                  : 'Try another name.',
              actionLabel: _q.isEmpty ? 'Start a chat' : null,
              actionIcon: Icons.edit_square,
              onAction: _q.isEmpty ? _newChat : null,
            ),
          )
        else
          SliverToBoxAdapter(
            child: GroupedSection(
              separatorInset: 76,
              children: [for (final c in list) _ConversationRow(conv: c, me: me, onTap: () => _open(c))],
            ),
          ),
      ],
    );
  }
}

class _ConversationRow extends ConsumerWidget {
  final Conversation conv;
  final String me;
  final VoidCallback onTap;
  const _ConversationRow({required this.conv, required this.me, required this.onTap});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final typing = ref.watch(chatControllerProvider.select((s) => s.typing[conv.id]));
    final last = conv.lastMessage;
    final unread = conv.unreadCount > 0;
    String preview;
    if (typing != null && typing.isNotEmpty) {
      preview = typing.length == 1 ? '${typing.values.first} is typing…' : 'Several people are typing…';
    } else if (last == null) {
      preview = conv.isEventCrew && conv.eventTitle != null ? 'Crew for ${conv.eventTitle}' : 'No messages yet';
    } else {
      final who = last.sender?.id == me ? 'You: ' : (conv.isGroup && last.sender != null ? '${last.sender!.name.split(' ').first}: ' : '');
      preview = '$who${last.preview}';
    }
    return ListRow(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      leading: ChatAvatar.conversation(conv),
      titleWidget: Row(children: [
        Flexible(
          child: Text(conv.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppType.rowTitle.copyWith(fontWeight: unread ? FontWeight.w700 : FontWeight.w500)),
        ),
        if (conv.isEventCrew) ...[const SizedBox(width: 6), const StatusBadge('Crew', tone: Tone.warning, dot: false)],
        if (conv.muted) ...[const SizedBox(width: 4), const Icon(Icons.notifications_off_rounded, size: 15, color: AppColors.ink400)],
      ]),
      title: conv.title,
      subtitleWidget: Text(
        preview,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppType.rowSubtitle.copyWith(
          color: typing != null && typing.isNotEmpty ? AppColors.brand : (unread ? AppColors.textPrimary : null),
          fontWeight: unread ? FontWeight.w500 : null,
        ),
      ),
      trailing: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
        Text(chatTime(conv.lastMessageAt ?? conv.createdAt),
            style: AppType.caption.copyWith(color: unread ? AppColors.brand : null)),
        const SizedBox(height: 4),
        if (unread) CountBadge(conv.unreadCount, muted: conv.muted) else const SizedBox(height: 20),
      ]),
      onTap: onTap,
    );
  }
}
