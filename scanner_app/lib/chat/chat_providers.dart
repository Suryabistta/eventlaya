import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api_client.dart';
import '../core/notification_service.dart';
import '../providers/auth_provider.dart';
import '../providers/modules_provider.dart';
import 'chat_api.dart';
import 'chat_models.dart';
import 'chat_socket.dart';

final chatApiProvider = Provider<ChatApi>((ref) => ChatApi());

/// Chat is shown only when the signed-in user's module list includes `chat`
/// (it's off for attendees by default) and the socket hasn't reported 4403.
final chatEnabledProvider = Provider<bool>((ref) {
  if (ref.watch(authProvider.select((s) => s.user == null))) return false;
  if (ref.watch(disabledModulesProvider).contains(AppModule.chat)) return false;
  final access = ref.watch(modulesProvider).valueOrNull;
  return access?.enabled?.contains(AppModule.chat) ?? false;
});

class ChatState {
  final List<Conversation>? conversations;
  final Object? error;
  final bool loading;
  final ChatConnection connection;

  /// userId → typing state per conversation: {convId: {userId: name}}.
  final Map<String, Map<String, String>> typing;

  const ChatState({
    this.conversations,
    this.error,
    this.loading = false,
    this.connection = ChatConnection.offline,
    this.typing = const {},
  });

  ChatState copyWith({
    List<Conversation>? conversations,
    Object? error,
    bool clearError = false,
    bool? loading,
    ChatConnection? connection,
    Map<String, Map<String, String>>? typing,
  }) =>
      ChatState(
        conversations: conversations ?? this.conversations,
        error: clearError ? null : (error ?? this.error),
        loading: loading ?? this.loading,
        connection: connection ?? this.connection,
        typing: typing ?? this.typing,
      );

  /// Unread messages in chats that aren't muted (tab badge).
  int get unread => (conversations ?? const []).where((c) => !c.muted).fold(0, (a, c) => a + c.unreadCount);
}

/// Conversation list + live socket. Lives while chat is enabled for the
/// signed-in user; thread screens listen to [events] for their conversation.
class ChatController extends StateNotifier<ChatState> with WidgetsBindingObserver {
  ChatController(this._ref, {required this.enabled, required this.myId}) : super(const ChatState()) {
    if (!enabled) return;
    WidgetsBinding.instance.addObserver(this);
    _sub = _socket.events.listen(_onEvent);
    _socket.status.addListener(_onStatus);
    load();
    _socket.start();
  }

  final Ref _ref;
  final bool enabled;
  final String myId;
  final _socket = ChatSocket();
  StreamSubscription? _sub;
  final Map<String, Timer> _typingTimers = {};

  /// The conversation open on screen (its messages count as read).
  String? activeConversationId;

  ChatApi get api => _ref.read(chatApiProvider);
  Stream<Map<String, dynamic>> get events => _socket.events;
  bool get online => _socket.isOnline;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _socket.kick();
      load();
    }
  }

  void _onStatus() {
    if (mounted) state = state.copyWith(connection: _socket.status.value);
  }

  Future<void> load() async {
    if (!enabled) return;
    state = state.copyWith(loading: true);
    try {
      final list = await api.conversations();
      if (mounted) state = state.copyWith(conversations: _sorted(list), loading: false, clearError: true);
    } catch (e) {
      noteChatDisabled(e);
      if (mounted) state = state.copyWith(error: e, loading: false);
    }
  }

  void noteChatDisabled(Object e) {
    if (ApiClient.disabledModule(e) == AppModule.chat) _disable();
  }

  void _disable() {
    final current = _ref.read(disabledModulesProvider);
    if (!current.contains(AppModule.chat)) {
      _ref.read(disabledModulesProvider.notifier).state = {...current, AppModule.chat};
    }
  }

  List<Conversation> _sorted(List<Conversation> list) => [...list]..sort((a, b) => b.sortTime.compareTo(a.sortTime));

  void _put(Conversation c) {
    final list = [...?state.conversations];
    final i = list.indexWhere((x) => x.id == c.id);
    if (i >= 0) {
      list[i] = c;
    } else {
      list.add(c);
    }
    state = state.copyWith(conversations: _sorted(list));
  }

  Conversation? byId(String id) => state.conversations?.where((c) => c.id == id).firstOrNull;

  /// Insert / refresh a conversation (after creating or opening one).
  void upsert(Conversation c) => _put(c);

  void remove(String id) {
    state = state.copyWith(conversations: [...?state.conversations]..removeWhere((c) => c.id == id));
  }

  void _onEvent(Map<String, dynamic> e) {
    if (!mounted) return;
    switch (e['type']) {
      case 'ready':
        if (e['reconnected'] == true) load();
      case 'disabled':
        _disable();
      case 'message.new':
        final msg = ChatMessage.fromJson(Map<String, dynamic>.from(e['message'] as Map));
        final conv = byId(msg.conversationId);
        if (conv == null) {
          load();
          return;
        }
        final mine = msg.sender?.id == myId;
        final active = activeConversationId == msg.conversationId;
        _put(conv.copyWith(
          lastMessage: msg,
          lastMessageAt: msg.createdAt,
          unreadCount: mine || active ? (mine ? 0 : conv.unreadCount) : conv.unreadCount + 1,
        ));
        _clearTyping(msg.conversationId, msg.sender?.id);
      case 'message.updated':
      case 'message.deleted':
        final msg = ChatMessage.fromJson(Map<String, dynamic>.from(e['message'] as Map));
        final conv = byId(msg.conversationId);
        if (conv != null && conv.lastMessage?.id == msg.id) _put(conv.copyWith(lastMessage: msg));
      case 'conversation.updated':
        _put(Conversation.fromJson(Map<String, dynamic>.from(e['conversation'] as Map)));
      case 'conversation.removed':
        remove(e['conversation_id'].toString());
      case 'read':
      case 'read.ack':
        // My own read position moved (this or another device).
        if (e['type'] == 'read.ack' || e['user_id']?.toString() == myId) {
          final conv = byId(e['conversation_id'].toString());
          if (conv != null) _put(conv.copyWith(unreadCount: 0));
        }
      case 'typing':
        _setTyping(e['conversation_id'].toString(), e['user_id'].toString(), e['name']?.toString() ?? 'Someone',
            e['is_typing'] != false);
    }
  }

  void _setTyping(String convId, String userId, String name, bool on) {
    final key = '$convId:$userId';
    _typingTimers.remove(key)?.cancel();
    final typing = {for (final e in state.typing.entries) e.key: {...e.value}};
    if (on) {
      (typing[convId] ??= {})[userId] = name;
      _typingTimers[key] = Timer(const Duration(seconds: 6), () => _clearTyping(convId, userId));
    } else {
      typing[convId]?.remove(userId);
    }
    state = state.copyWith(typing: typing);
  }

  void _clearTyping(String convId, String? userId) {
    if (userId == null || !(state.typing[convId]?.containsKey(userId) ?? false)) return;
    _setTyping(convId, userId, '', false);
  }

  /// Mark read up to [messageId] (socket when online, else REST).
  Future<void> markRead(String convId, String messageId) async {
    final conv = byId(convId);
    if (conv != null && conv.unreadCount != 0) _put(conv.copyWith(unreadCount: 0));
    if (_socket.send({'type': 'read', 'conversation_id': convId, 'message_id': messageId})) return;
    try {
      await api.markRead(convId, messageId: messageId);
    } catch (_) {}
  }

  DateTime _lastTyping = DateTime(2000);

  /// "is typing", at most every 3 s (socket only).
  void typing(String convId) {
    final now = DateTime.now();
    if (now.difference(_lastTyping) < const Duration(seconds: 3)) return;
    _lastTyping = now;
    _socket.send({'type': 'typing', 'conversation_id': convId, 'is_typing': true});
  }

  /// Sends over the socket (ack arrives as an event) or REST when offline.
  /// Returns the stored message for REST sends, null for socket sends.
  Future<ChatMessage?> send(
    String convId, {
    required String body,
    String? replyTo,
    required String clientId,
    Object? attachment,
  }) async {
    final sent = _socket.send({
      'type': 'message.send',
      'conversation_id': convId,
      'body': body,
      'client_id': clientId,
      if (replyTo != null) 'reply_to': replyTo,
      if (attachment != null) 'attachment': attachment,
    });
    if (sent) return null;
    final msg = await api.send(convId, body: body, replyTo: replyTo, clientId: clientId, attachment: attachment);
    final conv = byId(convId);
    if (conv != null) _put(conv.copyWith(lastMessage: msg, lastMessageAt: msg.createdAt, unreadCount: 0));
    return msg;
  }

  @override
  void dispose() {
    if (enabled) WidgetsBinding.instance.removeObserver(this);
    for (final t in _typingTimers.values) {
      t.cancel();
    }
    _sub?.cancel();
    _socket.status.removeListener(_onStatus);
    _socket.dispose();
    super.dispose();
  }
}

final chatControllerProvider = StateNotifierProvider<ChatController, ChatState>((ref) {
  final enabled = ref.watch(chatEnabledProvider);
  final myId = ref.watch(authProvider.select((s) => s.user?.id)) ?? '';
  return ChatController(ref, enabled: enabled, myId: myId);
});

/// Tab badge.
final chatUnreadProvider = Provider<int>((ref) => ref.watch(chatControllerProvider.select((s) => s.unread)));

/// Keeps push notifications for the open conversation quiet.
void setActiveChat(WidgetRef ref, String? convId) {
  ref.read(chatControllerProvider.notifier).activeConversationId = convId;
  NotificationService.activeChatConversationId = convId;
}
