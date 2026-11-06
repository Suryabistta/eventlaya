import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'dart:ui';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../attendee/data/attendee_api.dart' show friendlyError;
import '../../attendee/data/account_api.dart';
import '../../core/notification_service.dart';
import '../../core/photo_picker.dart';
import '../../providers/auth_provider.dart';
import '../../ui/ui.dart';
import '../chat_models.dart';
import '../chat_providers.dart';
import '../chat_widgets.dart';
import 'group_info_screen.dart';

/// One conversation: messages grouped by day, sender names in groups,
/// reply / copy / edit / delete on long-press, typing indicator and "Seen"
/// receipts. Live over the chat socket; falls back to REST when offline and
/// catches up (`?after=`) after reconnecting. Photos: pick (≤1600 px, JPEG
/// ~80%) → upload (kind=chat) with progress → send; tap to view full screen.
class ChatThreadScreen extends ConsumerStatefulWidget {
  final String conversationId;
  final Conversation? initial;
  const ChatThreadScreen({super.key, required this.conversationId, this.initial});

  @override
  ConsumerState<ChatThreadScreen> createState() => _ChatThreadScreenState();
}

class _ChatThreadScreenState extends ConsumerState<ChatThreadScreen> {
  late final ChatController _ctrl = ref.read(chatControllerProvider.notifier);
  late Conversation? _conv = widget.initial ?? _ctrl.byId(widget.conversationId);
  final _scroll = ScrollController();
  final _input = TextEditingController();
  final _focus = FocusNode();

  /// Newest first.
  final List<ChatMessage> _msgs = [];
  bool _loading = true;
  bool _loadingOlder = false;
  bool _hasMore = false;
  String? _nextBefore;
  Object? _error;
  ChatMessage? _replyTo;
  ChatMessage? _editing;
  StreamSubscription? _sub;
  AppLifecycleListener? _lifecycle;
  final Map<String, Timer> _ackTimers = {};

  String get _id => widget.conversationId;
  String get _me => ref.read(authProvider).user?.id ?? '';

  @override
  void initState() {
    super.initState();
    _ctrl.activeConversationId = _id;
    NotificationService.activeChatConversationId = _id;
    // Opening the chat counts as seeing its notification; also when the app
    // comes back to the foreground on this chat (pushes shown meanwhile).
    NotificationService.clearChat(_id);
    _lifecycle = AppLifecycleListener(onResume: () => NotificationService.clearChat(_id));
    _sub = _ctrl.events.listen(_onEvent);
    _scroll.addListener(_onScroll);
    _loadConversation();
    _loadMessages();
  }

  @override
  void dispose() {
    if (_ctrl.activeConversationId == _id) _ctrl.activeConversationId = null;
    if (NotificationService.activeChatConversationId == _id) NotificationService.activeChatConversationId = null;
    _sub?.cancel();
    _lifecycle?.dispose();
    for (final t in _ackTimers.values) {
      t.cancel();
    }
    _scroll.dispose();
    _input.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _loadConversation() async {
    try {
      final c = await _ctrl.api.conversation(_id);
      if (mounted) setState(() => _conv = c);
    } catch (e) {
      _ctrl.noteChatDisabled(e);
      if (mounted && _conv == null) setState(() => _error = e);
    }
  }

  Future<void> _loadMessages() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await _ctrl.api.messages(_id);
      if (!mounted) return;
      setState(() {
        _msgs
          ..removeWhere((m) => !m.pending && !m.failed)
          ..addAll(page.results);
        _hasMore = page.hasMore;
        _nextBefore = page.nextBefore;
      });
      _markRead();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadOlder() async {
    if (_loadingOlder || !_hasMore || _nextBefore == null) return;
    setState(() => _loadingOlder = true);
    try {
      final page = await _ctrl.api.messages(_id, before: _nextBefore);
      if (!mounted) return;
      setState(() {
        final known = {for (final m in _msgs) m.id};
        _msgs.addAll(page.results.where((m) => !known.contains(m.id)));
        _hasMore = page.hasMore;
        _nextBefore = page.nextBefore;
      });
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  /// After a reconnect: fetch everything newer than what we have.
  Future<void> _catchUp() async {
    final newest = _msgs.where((m) => !m.pending && !m.failed).firstOrNull;
    if (newest == null) return _loadMessages();
    try {
      String? after = newest.id;
      for (var i = 0; i < 5 && after != null; i++) {
        final page = await _ctrl.api.messages(_id, after: after, limit: 100);
        for (final m in page.results) {
          _upsert(m);
        }
        after = page.hasMore ? page.nextAfter : null;
      }
      _markRead();
    } catch (_) {}
  }

  void _onScroll() {
    if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 400) _loadOlder();
  }

  void _markRead() {
    final newest = _msgs.where((m) => !m.pending && !m.failed).firstOrNull;
    if (newest != null) _ctrl.markRead(_id, newest.id);
  }

  /// Insert or replace (by id, or by client_id for our pending copy).
  void _upsert(ChatMessage m) {
    if (!mounted) return;
    setState(() {
      var i = _msgs.indexWhere((x) => x.id == m.id);
      if (i < 0 && m.clientId != null) i = _msgs.indexWhere((x) => x.clientId == m.clientId && x.sender?.id == _me);
      if (i >= 0) {
        _msgs[i] = m;
      } else {
        _msgs.add(m);
      }
      _msgs.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    });
    if (m.clientId != null) _ackTimers.remove(m.clientId)?.cancel();
  }

  void _onEvent(Map<String, dynamic> e) {
    final type = e['type'];
    if (type == 'ready' && e['reconnected'] == true) {
      _catchUp();
      _loadConversation();
      return;
    }
    if (type == 'ack' && e['message'] is Map) {
      final m = ChatMessage.fromJson(Map<String, dynamic>.from(e['message'] as Map));
      if (m.conversationId == _id) _upsert(m);
      return;
    }
    if (type == 'error' && e['request_type'] == 'message.send' && e['conversation_id']?.toString() == _id) {
      _markFailed(e['client_id']?.toString(), e['error']?.toString());
      return;
    }
    if (e['conversation_id']?.toString() != _id &&
        !(e['conversation'] is Map && (e['conversation'] as Map)['id']?.toString() == _id)) {
      return;
    }
    switch (type) {
      case 'message.new':
      case 'message.updated':
      case 'message.deleted':
        final m = ChatMessage.fromJson(Map<String, dynamic>.from(e['message'] as Map));
        _upsert(m);
        if (type == 'message.new' && m.sender?.id != _me) _markRead();
      case 'read':
        final uid = e['user_id']?.toString();
        final at = DateTime.tryParse(e['read_at']?.toString() ?? '')?.toLocal();
        final c = _conv;
        if (uid == null || at == null || c == null || uid == _me) return;
        setState(() {
          _conv = Conversation(
            id: c.id,
            kind: c.kind,
            title: c.title,
            isEventCrew: c.isEventCrew,
            eventTitle: c.eventTitle,
            createdAt: c.createdAt,
            lastMessageAt: c.lastMessageAt,
            lastMessage: c.lastMessage,
            unreadCount: c.unreadCount,
            muted: c.muted,
            myRole: c.myRole,
            memberCount: c.memberCount,
            otherMember: c.otherMember,
            readOnly: c.readOnly,
            members: [
              for (final m in c.members) m.user.id == uid ? m.withRead(at, e['message_id'].toString()) : m,
            ],
          );
        });
      case 'conversation.updated':
        setState(() => _conv = Conversation.fromJson(Map<String, dynamic>.from(e['conversation'] as Map)));
      case 'conversation.removed':
        if (mounted) {
          AppToast.info(context, 'You are no longer in this chat');
          Navigator.of(context).maybePop();
        }
    }
  }

  void _markFailed(String? clientId, [String? error]) {
    if (clientId == null || !mounted) return;
    final i = _msgs.indexWhere((m) => m.clientId == clientId && m.pending);
    if (i < 0) return;
    setState(() => _msgs[i] = _msgs[i].copyWith(pending: false, failed: true));
    if (error != null) AppToast.error(context, error);
  }

  static String _clientId() {
    final r = Random.secure();
    return List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }

  Future<void> _submit() async {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    if (_editing != null) return _saveEdit(text);
    final user = ref.read(authProvider).user;
    final clientId = _clientId();
    final reply = _replyTo;
    final pending = ChatMessage(
      id: 'local-$clientId',
      conversationId: _id,
      sender: ChatUser(id: _me, name: user?.fullName ?? 'You'),
      body: text,
      clientId: clientId,
      createdAt: DateTime.now(),
      replyTo: reply == null
          ? null
          : ReplyRef(id: reply.id, senderName: reply.sender?.name, body: reply.body, hasAttachment: reply.attachment != null),
      pending: true,
    );
    setState(() {
      _msgs.insert(0, pending);
      _replyTo = null;
      _input.clear();
    });
    await _send(pending);
  }

  /// Upload progress (0–1) of photo messages being sent, by client_id.
  final Map<String, double> _progress = {};

  Future<void> _sendPhoto() async {
    final path = await pickPhoto(context, title: 'Send a photo');
    if (path == null || !mounted) return;
    final user = ref.read(authProvider).user;
    final clientId = _clientId();
    final caption = _editing == null ? _input.text.trim() : '';
    final reply = _replyTo;
    final pending = ChatMessage(
      id: 'local-$clientId',
      conversationId: _id,
      sender: ChatUser(id: _me, name: user?.fullName ?? 'You'),
      body: caption,
      clientId: clientId,
      createdAt: DateTime.now(),
      replyTo: reply == null
          ? null
          : ReplyRef(id: reply.id, senderName: reply.sender?.name, body: reply.body, hasAttachment: reply.attachment != null),
      pending: true,
      localImagePath: path,
    );
    setState(() {
      _msgs.insert(0, pending);
      _replyTo = null;
      if (caption.isNotEmpty) _input.clear();
    });
    await _send(pending);
  }

  Future<void> _send(ChatMessage pending) async {
    final clientId = pending.clientId!;
    try {
      // Photo: upload first (kind=chat), then send the message with its URL.
      var msg = pending;
      if (msg.localImagePath != null && msg.uploadedUrl == null) {
        setState(() => _progress[clientId] = 0);
        final url = await AccountApi().uploadPhoto(
          msg.localImagePath!,
          kind: 'chat',
          onProgress: (p) {
            if (mounted) setState(() => _progress[clientId] = p);
          },
        );
        msg = msg.copyWith(uploadedUrl: url);
        final i = _msgs.indexWhere((m) => m.clientId == clientId);
        if (i >= 0 && mounted) setState(() => _msgs[i] = msg);
      }
      if (mounted) setState(() => _progress.remove(clientId));
      final attachment = msg.uploadedUrl == null
          ? null
          : {'url': msg.uploadedUrl, 'name': msg.localImagePath!.split('/').last};
      final stored = await _ctrl.send(_id,
          body: msg.body, replyTo: msg.replyTo?.id, clientId: clientId, attachment: attachment);
      if (stored != null) {
        _upsert(stored);
      } else {
        // Sent on the socket: if no ack arrives, retry over REST (same client_id, no duplicate).
        _ackTimers[clientId] = Timer(const Duration(seconds: 8), () async {
          try {
            _upsert(await _ctrl.api.send(_id,
                body: msg.body, replyTo: msg.replyTo?.id, clientId: clientId, attachment: attachment));
          } catch (e) {
            _markFailed(clientId, friendlyError(e));
          }
        });
      }
    } catch (e) {
      if (mounted) setState(() => _progress.remove(clientId));
      _markFailed(clientId, e is AccountError ? e.message : friendlyError(e));
    }
  }

  Future<void> _retry(ChatMessage m) async {
    final i = _msgs.indexOf(m);
    if (i < 0) return;
    setState(() => _msgs[i] = m.copyWith(pending: true, failed: false));
    await _send(_msgs[i]);
  }

  Future<void> _saveEdit(String text) async {
    final m = _editing!;
    setState(() {
      _editing = null;
      _input.clear();
    });
    try {
      _upsert(await _ctrl.api.edit(m.id, text));
    } catch (e) {
      if (mounted) AppToast.error(context, friendlyError(e));
    }
  }

  Future<void> _actions(ChatMessage m) async {
    if (m.isDeleted) return;
    if (m.failed) {
      final retry = await confirmSheet(context,
          title: 'Not sent', message: 'This message wasn\'t delivered.', confirmLabel: 'Try again', destructive: false);
      if (retry) _retry(m);
      return;
    }
    if (m.pending) return;
    HapticFeedback.selectionClick();
    final mine = m.sender?.id == _me;
    final canDelete = mine || ((_conv?.isGroup ?? false) && (_conv?.iAmAdmin ?? false));
    final action = await showAppSheet<String>(
      context,
      builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, children: [
        if (!(_conv?.readOnly ?? false))
          SheetAction(icon: Icons.reply_rounded, label: 'Reply', onTap: () => Navigator.pop(ctx, 'reply')),
        if (m.body.isNotEmpty) SheetAction(icon: Icons.copy_rounded, label: 'Copy', onTap: () => Navigator.pop(ctx, 'copy')),
        if (m.canEdit(_me)) SheetAction(icon: Icons.edit_rounded, label: 'Edit', onTap: () => Navigator.pop(ctx, 'edit')),
        if (canDelete)
          SheetAction(icon: Icons.delete_outline_rounded, label: 'Delete', destructive: true, onTap: () => Navigator.pop(ctx, 'delete')),
      ]),
    );
    if (!mounted) return;
    switch (action) {
      case 'reply':
        setState(() {
          _replyTo = m;
          _editing = null;
        });
        _focus.requestFocus();
      case 'copy':
        Clipboard.setData(ClipboardData(text: m.body));
        AppToast.success(context, 'Copied');
      case 'edit':
        setState(() {
          _editing = m;
          _replyTo = null;
          _input.text = m.body;
        });
        _focus.requestFocus();
      case 'delete':
        final ok = await confirmSheet(context,
            title: 'Delete message?', message: 'It will be removed for everyone.', confirmLabel: 'Delete');
        if (!ok) return;
        try {
          _upsert(await _ctrl.api.deleteMessage(m.id));
        } catch (e) {
          if (mounted) AppToast.error(context, friendlyError(e));
        }
    }
  }

  void _openInfo() {
    final c = _conv;
    if (c == null) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => GroupInfoScreen(conversation: c))).then((_) {
      final fresh = _ctrl.byId(_id);
      if (fresh != null && mounted) setState(() => _conv = fresh);
    });
  }

  /// "Seen" / "Seen by 3" under my newest delivered message.
  String? _seenLabel(ChatMessage m) {
    final c = _conv;
    if (c == null || c.members.isEmpty) return null;
    final readers = c.members
        .where((x) => x.user.id != _me && x.lastReadAt != null && !x.lastReadAt!.isBefore(m.createdAt))
        .length;
    if (readers == 0) return null;
    return c.isGroup ? 'Seen by $readers' : 'Seen';
  }

  @override
  Widget build(BuildContext context) {
    final c = _conv;
    final typing = ref.watch(chatControllerProvider.select((s) => s.typing[_id]));
    final typingText = typing == null || typing.isEmpty
        ? null
        : (typing.length == 1 ? '${typing.values.first.split(' ').first} is typing…' : 'Several people are typing…');
    final subtitle = typingText ??
        (c == null
            ? ''
            : c.isGroup
                ? '${c.members.isEmpty ? c.memberCount : c.members.length} members${c.isEventCrew ? ' · event crew' : ''}'
                : (c.otherMember?.roleLabel ?? ''));
    final myLatest = _msgs.where((m) => m.sender?.id == _me && !m.pending && !m.failed && !m.isDeleted).firstOrNull;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.ink50.withValues(alpha: 0.92),
        leading: IconButton(
          tooltip: 'Back',
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20, color: AppColors.brand),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        titleSpacing: 0,
        centerTitle: false,
        shape: const Border(bottom: BorderSide(color: AppColors.separator, width: 0.5)),
        title: InkWell(
          onTap: _openInfo,
          child: Row(children: [
            if (c != null) ChatAvatar.conversation(c, size: 36),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                Text(c?.title ?? 'Chat', maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.navTitle),
                if (subtitle.isNotEmpty)
                  Text(subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppType.caption.copyWith(color: typingText != null ? AppColors.brand : null)),
              ]),
            ),
          ]),
        ),
        actions: [AppIconButton(icon: Icons.info_outline_rounded, tooltip: 'Info', onPressed: _openInfo)],
      ),
      body: Column(children: [
        Expanded(
          child: _loading && _msgs.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : _error != null && _msgs.isEmpty
                  ? ErrorState(message: friendlyError(_error!), onRetry: _loadMessages)
                  : _msgs.isEmpty
                      ? EmptyState(
                          icon: Icons.waving_hand_outlined,
                          title: 'Say hello',
                          message: c?.isEventCrew == true
                              ? 'Coordinate with the crew working this event.'
                              : 'Messages you send appear here.',
                        )
                      : GestureDetector(
                          onTap: () => FocusScope.of(context).unfocus(),
                          child: ListView.builder(
                            controller: _scroll,
                            reverse: true,
                            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                            padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                            itemCount: _msgs.length + (_hasMore ? 1 : 0),
                            itemBuilder: (context, i) {
                              if (i == _msgs.length) {
                                return const Padding(
                                  padding: EdgeInsets.all(16),
                                  child: Center(
                                      child: SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))),
                                );
                              }
                              final m = _msgs[i];
                              final older = i + 1 < _msgs.length ? _msgs[i + 1] : null;
                              final newer = i > 0 ? _msgs[i - 1] : null;
                              final newDay = older == null || !_sameDay(older.createdAt, m.createdAt);
                              final firstOfRun = newDay || !_sameRun(older, m);
                              final lastOfRun = newer == null || !_sameDay(newer.createdAt, m.createdAt) || !_sameRun(m, newer);
                              return Column(children: [
                                if (newDay) _DayChip(chatDay(m.createdAt)),
                                _Bubble(
                                  message: m,
                                  mine: m.sender?.id == _me,
                                  showName: (c?.isGroup ?? false) && firstOfRun && m.sender?.id != _me,
                                  tail: lastOfRun,
                                  seen: identical(m, myLatest) ? _seenLabel(m) : null,
                                  progress: m.clientId == null ? null : _progress[m.clientId],
                                  onLongPress: () => _actions(m),
                                  onTap: m.failed ? () => _actions(m) : null,
                                ),
                              ]);
                            },
                          ),
                        ),
        ),
        _Composer(
          controller: _input,
          focus: _focus,
          readOnly: c?.readOnly ?? false,
          replyTo: _replyTo,
          editing: _editing,
          onCancel: () => setState(() {
            if (_editing != null) _input.clear();
            _replyTo = null;
            _editing = null;
          }),
          onChanged: (_) => _ctrl.typing(_id),
          onSend: _submit,
          onAttach: _sendPhoto,
        ),
      ]),
    );
  }

  static bool _sameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;

  /// Same sender within 5 minutes: grouped without repeating the name.
  static bool _sameRun(ChatMessage? older, ChatMessage newer) =>
      older != null &&
      older.sender?.id == newer.sender?.id &&
      newer.createdAt.difference(older.createdAt).inMinutes.abs() < 5;
}

class _DayChip extends StatelessWidget {
  final String label;
  const _DayChip(this.label);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: AppColors.ink100, borderRadius: BorderRadius.circular(99)),
        child: Text(label, style: AppType.body(12, weight: FontWeight.w500, color: AppColors.ink600)),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  final ChatMessage message;
  final bool mine;
  final bool showName;
  final bool tail;
  final String? seen;
  final double? progress;
  final VoidCallback onLongPress;
  final VoidCallback? onTap;

  const _Bubble({
    required this.message,
    required this.mine,
    required this.showName,
    required this.tail,
    required this.seen,
    this.progress,
    required this.onLongPress,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final m = message;
    final fg = mine ? Colors.white : AppColors.textPrimary;
    final sub = mine ? Colors.white.withValues(alpha: 0.75) : AppColors.textTertiary;
    const r = Radius.circular(18);
    const small = Radius.circular(6);
    final radius = BorderRadius.only(
      topLeft: r,
      topRight: r,
      bottomLeft: !mine && tail ? small : r,
      bottomRight: mine && tail ? small : r,
    );
    final meta = [
      DateFormat('HH:mm').format(m.createdAt),
      if (m.editedAt != null && !m.isDeleted) 'edited',
    ].join(' · ');

    final content = Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      if (showName)
        Padding(
          padding: const EdgeInsets.only(bottom: 2),
          child: Text(m.sender?.name ?? 'Someone', style: AppType.body(12.5, weight: FontWeight.w600, color: AppColors.brand)),
        ),
      if (m.replyTo != null && !m.isDeleted)
        Container(
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.fromLTRB(8, 5, 8, 5),
          decoration: BoxDecoration(
            color: mine ? Colors.white.withValues(alpha: 0.16) : AppColors.ink50,
            borderRadius: BorderRadius.circular(8),
            border: Border(left: BorderSide(color: mine ? Colors.white : AppColors.brand, width: 3)),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(m.replyTo!.senderName ?? 'Message',
                style: AppType.body(12, weight: FontWeight.w600, color: mine ? Colors.white : AppColors.brand)),
            Text(m.replyTo!.preview, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.body(12.5, color: sub)),
          ]),
        ),
      if (m.localImagePath != null && m.attachment == null && !m.isDeleted)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Stack(alignment: Alignment.center, children: [
              Image.file(File(m.localImagePath!), width: 220, fit: BoxFit.cover),
              if (m.pending)
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.45), shape: BoxShape.circle),
                  padding: const EdgeInsets.all(12),
                  child: CircularProgressIndicator(
                    strokeWidth: 3,
                    color: Colors.white,
                    value: progress == null || progress! <= 0 || progress! >= 1 ? null : progress,
                  ),
                ),
            ]),
          ),
        )
      else if (m.attachment != null && m.attachment!.isImage && !m.isDeleted)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: GestureDetector(
            onTap: () => Navigator.of(context, rootNavigator: true).push(PageRouteBuilder(
              opaque: false,
              pageBuilder: (_, __, ___) => ImageViewerScreen(url: m.attachment!.url, heroTag: m.id),
              transitionsBuilder: (_, a, __, child) => FadeTransition(opacity: a, child: child),
            )),
            child: Hero(
              tag: m.id,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: CachedNetworkImage(
                  imageUrl: m.attachment!.url,
                  width: 220,
                  fit: BoxFit.cover,
                  placeholder: (_, __) => Container(width: 220, height: 160, color: AppColors.ink100),
                  errorWidget: (_, __, ___) => Container(
                    width: 220,
                    height: 80,
                    color: AppColors.ink100,
                    alignment: Alignment.center,
                    child: const Icon(Icons.broken_image_outlined, color: AppColors.ink400),
                  ),
                ),
              ),
            ),
          ),
        ),
      if (m.isDeleted)
        Text('This message was deleted', style: AppType.body(14.5, color: sub).copyWith(fontStyle: FontStyle.italic))
      else if (m.body.isNotEmpty)
        Text(m.body, style: AppType.body(15, color: fg, height: 1.35)),
      const SizedBox(height: 2),
      Row(mainAxisSize: MainAxisSize.min, children: [
        Text(meta, style: AppType.body(10.5, color: sub, height: 1.2)),
        if (mine && m.pending) ...[const SizedBox(width: 4), Icon(Icons.schedule_rounded, size: 11, color: sub)],
        if (mine && !m.pending && !m.failed) ...[const SizedBox(width: 4), Icon(Icons.done_rounded, size: 12, color: sub)],
      ]),
    ]);

    return Padding(
      padding: EdgeInsets.only(top: showName || tail ? 4 : 1, bottom: tail ? 4 : 1),
      child: Column(crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start, children: [
        Row(
          mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
          children: [
            if (mine && m.failed)
              const Padding(
                padding: EdgeInsets.only(right: 6),
                child: Icon(Icons.error_rounded, color: AppColors.danger, size: 20),
              ),
            Flexible(
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
                child: GestureDetector(
                  onLongPress: onLongPress,
                  onTap: onTap,
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
                    decoration: BoxDecoration(
                      gradient: mine && !m.isDeleted
                          ? const LinearGradient(colors: [Color(0xFFD63A70), AppColors.brand])
                          : null,
                      color: mine ? (m.isDeleted ? AppColors.ink300 : null) : AppColors.surface,
                      borderRadius: radius,
                      border: mine ? null : Border.all(color: AppColors.ink200.withValues(alpha: 0.8), width: 0.5),
                    ),
                    child: Opacity(opacity: m.pending ? 0.75 : 1, child: content),
                  ),
                ),
              ),
            ),
          ],
        ),
        if (seen != null)
          Padding(
            padding: const EdgeInsets.only(top: 2, right: 4),
            child: Text(seen!, style: AppType.body(11, weight: FontWeight.w500, color: AppColors.ink500)),
          ),
        if (m.failed)
          Padding(
            padding: const EdgeInsets.only(top: 2, right: 4),
            child: Text('Not sent · tap to retry', style: AppType.body(11, color: AppColors.danger)),
          ),
      ]),
    );
  }
}

class _Composer extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode focus;
  final bool readOnly;
  final ChatMessage? replyTo;
  final ChatMessage? editing;
  final VoidCallback onCancel;
  final ValueChanged<String> onChanged;
  final VoidCallback onSend;
  final VoidCallback onAttach;

  const _Composer({
    required this.controller,
    required this.focus,
    required this.readOnly,
    required this.replyTo,
    required this.editing,
    required this.onCancel,
    required this.onChanged,
    required this.onSend,
    required this.onAttach,
  });

  @override
  Widget build(BuildContext context) {
    final banner = editing != null
        ? ('Editing message', editing!.body)
        : replyTo != null
            ? ('Replying to ${replyTo!.sender?.name ?? 'message'}', replyTo!.preview)
            : null;
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.ink50.withValues(alpha: 0.92),
            border: const Border(top: BorderSide(color: AppColors.separator, width: 0.5)),
          ),
          child: SafeArea(
            top: false,
            child: readOnly
                ? Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text('This person is no longer on your team, so you can\'t reply.',
                        textAlign: TextAlign.center, style: AppType.caption),
                  )
                : Padding(
                    padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      if (banner != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 6, left: 4),
                          child: Row(children: [
                            Container(width: 3, height: 32, color: AppColors.brand),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(banner.$1, style: AppType.body(12, weight: FontWeight.w600, color: AppColors.brand)),
                                Text(banner.$2, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.caption),
                              ]),
                            ),
                            IconButton(
                              tooltip: 'Cancel',
                              icon: const Icon(Icons.close_rounded, size: 20, color: AppColors.ink400),
                              onPressed: onCancel,
                            ),
                          ]),
                        ),
                      Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        if (editing == null)
                          AppIconButton(
                            icon: Icons.add_photo_alternate_outlined,
                            tooltip: 'Send a photo',
                            color: AppColors.ink500,
                            onPressed: onAttach,
                          ),
                        Expanded(
                          child: TextField(
                            controller: controller,
                            focusNode: focus,
                            minLines: 1,
                            maxLines: 5,
                            maxLength: 4000,
                            textCapitalization: TextCapitalization.sentences,
                            onChanged: onChanged,
                            style: AppType.body(15),
                            decoration: InputDecoration(
                              hintText: 'Message',
                              counterText: '',
                              isDense: true,
                              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                              border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(22),
                                  borderSide: const BorderSide(color: AppColors.ink200)),
                              enabledBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(22),
                                  borderSide: const BorderSide(color: AppColors.ink200)),
                              focusedBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(22),
                                  borderSide: const BorderSide(color: AppColors.brand, width: 1.2)),
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        ValueListenableBuilder<TextEditingValue>(
                          valueListenable: controller,
                          builder: (_, v, __) => AppIconButton(
                            icon: editing != null ? Icons.check_rounded : Icons.arrow_upward_rounded,
                            tooltip: editing != null ? 'Save' : 'Send',
                            color: Colors.white,
                            background: v.text.trim().isEmpty ? AppColors.ink300 : AppColors.brand,
                            onPressed: v.text.trim().isEmpty ? null : onSend,
                          ),
                        ),
                      ]),
                    ]),
                  ),
          ),
        ),
      ),
    );
  }
}

/// Full-screen photo with pinch-to-zoom; tap or swipe down to close.
class ImageViewerScreen extends StatelessWidget {
  final String url;
  final Object heroTag;
  const ImageViewerScreen({super.key, required this.url, required this.heroTag});

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(children: [
          Positioned.fill(
            child: GestureDetector(
              onTap: () => Navigator.of(context).maybePop(),
              onVerticalDragEnd: (d) {
                if ((d.primaryVelocity ?? 0).abs() > 600) Navigator.of(context).maybePop();
              },
              child: InteractiveViewer(
                minScale: 1,
                maxScale: 5,
                child: Center(
                  child: Hero(
                    tag: heroTag,
                    child: CachedNetworkImage(
                      imageUrl: url,
                      fit: BoxFit.contain,
                      placeholder: (_, __) => const CircularProgressIndicator(color: Colors.white),
                      errorWidget: (_, __, ___) =>
                          const Icon(Icons.broken_image_outlined, color: Colors.white54, size: 48),
                    ),
                  ),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(4),
              child: AppIconButton(
                icon: Icons.close_rounded,
                tooltip: 'Close',
                color: Colors.white,
                background: Colors.white.withValues(alpha: 0.12),
                onPressed: () => Navigator.of(context).maybePop(),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}
