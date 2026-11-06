import '../core/media_url.dart';

String? _s(Object? v) {
  final t = v?.toString().trim();
  return (t == null || t.isEmpty) ? null : t;
}

DateTime? _dt(Object? v) => DateTime.tryParse(v?.toString() ?? '')?.toLocal();

Map<String, dynamic> _m(Object? v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

class ChatUser {
  final String id;
  final String name;
  final String email;
  final String role;
  final String? avatar;
  const ChatUser({required this.id, required this.name, this.email = '', this.role = '', this.avatar});

  factory ChatUser.fromJson(Map<String, dynamic> j) => ChatUser(
        id: j['id']?.toString() ?? '',
        name: _s(j['name']) ?? _s(j['email']) ?? 'Someone',
        email: _s(j['email']) ?? '',
        role: _s(j['role']) ?? '',
        avatar: mediaUrl(j['avatar']),
      );

  String get roleLabel => switch (role) {
        'organizer' => 'Organizer',
        'staff' => 'Gate staff',
        'superadmin' => 'Admin',
        _ => '',
      };
}

class ChatAttachment {
  final String url;
  final String name;
  final String mime;
  const ChatAttachment({required this.url, this.name = '', this.mime = ''});

  bool get isImage => mime.startsWith('image/');
}

class ReplyRef {
  final String id;
  final String? senderName;
  final String body;
  final bool hasAttachment;
  final bool isDeleted;
  const ReplyRef({required this.id, this.senderName, this.body = '', this.hasAttachment = false, this.isDeleted = false});

  String get preview => isDeleted ? 'Deleted message' : (body.isNotEmpty ? body : (hasAttachment ? 'Photo' : ''));
}

class ChatMessage {
  final String id;
  final String conversationId;
  final ChatUser? sender;
  final String body;
  final ChatAttachment? attachment;
  final ReplyRef? replyTo;
  final String? clientId;
  final DateTime createdAt;
  final DateTime? editedAt;
  final bool isDeleted;

  /// Local only: sent from this phone and not yet confirmed / failed.
  final bool pending;
  final bool failed;

  /// Local only: photo picked on this phone (shown until the server copy
  /// arrives) and its uploaded URL once `/api/uploads/` succeeded.
  final String? localImagePath;
  final String? uploadedUrl;

  const ChatMessage({
    required this.id,
    required this.conversationId,
    this.sender,
    this.body = '',
    this.attachment,
    this.replyTo,
    this.clientId,
    required this.createdAt,
    this.editedAt,
    this.isDeleted = false,
    this.pending = false,
    this.failed = false,
    this.localImagePath,
    this.uploadedUrl,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> j) {
    final a = j['attachment'] is Map ? _m(j['attachment']) : null;
    final r = j['reply_to'] is Map ? _m(j['reply_to']) : null;
    return ChatMessage(
      id: j['id']?.toString() ?? '',
      conversationId: j['conversation_id']?.toString() ?? '',
      sender: j['sender'] is Map ? ChatUser.fromJson(_m(j['sender'])) : null,
      body: j['body']?.toString() ?? '',
      attachment: a == null || mediaUrl(a['url']) == null
          ? null
          : ChatAttachment(url: mediaUrl(a['url'])!, name: a['name']?.toString() ?? '', mime: a['mime']?.toString() ?? ''),
      replyTo: r == null
          ? null
          : ReplyRef(
              id: r['id']?.toString() ?? '',
              senderName: _s(r['sender_name']),
              body: r['body']?.toString() ?? '',
              hasAttachment: r['has_attachment'] == true,
              isDeleted: r['is_deleted'] == true,
            ),
      clientId: _s(j['client_id']),
      createdAt: _dt(j['created_at']) ?? DateTime.now(),
      editedAt: _dt(j['edited_at']),
      isDeleted: j['is_deleted'] == true,
    );
  }

  ChatMessage copyWith({bool? pending, bool? failed, String? uploadedUrl}) => ChatMessage(
        id: id,
        conversationId: conversationId,
        sender: sender,
        body: body,
        attachment: attachment,
        replyTo: replyTo,
        clientId: clientId,
        createdAt: createdAt,
        editedAt: editedAt,
        isDeleted: isDeleted,
        pending: pending ?? this.pending,
        failed: failed ?? this.failed,
        localImagePath: localImagePath,
        uploadedUrl: uploadedUrl ?? this.uploadedUrl,
      );

  /// One-line preview for the conversation list.
  String get preview =>
      isDeleted ? 'Message deleted' : (body.isNotEmpty ? body : (attachment != null || localImagePath != null ? 'Photo' : ''));

  bool canEdit(String me) =>
      sender?.id == me && !isDeleted && !pending && DateTime.now().difference(createdAt) < const Duration(minutes: 15);
}

class ConvMember {
  final ChatUser user;
  final String role;
  final DateTime? lastReadAt;
  final String? lastReadMessageId;
  const ConvMember({required this.user, this.role = 'member', this.lastReadAt, this.lastReadMessageId});

  factory ConvMember.fromJson(Map<String, dynamic> j) => ConvMember(
        user: ChatUser.fromJson(_m(j['user'])),
        role: _s(j['role']) ?? 'member',
        lastReadAt: _dt(j['last_read_at']),
        lastReadMessageId: _s(j['last_read_message_id']),
      );

  bool get isAdmin => role == 'admin';

  ConvMember withRead(DateTime at, String messageId) =>
      ConvMember(user: user, role: role, lastReadAt: at, lastReadMessageId: messageId);
}

class Conversation {
  final String id;

  /// 'direct' or 'group'.
  final String kind;
  final String title;
  final bool isEventCrew;
  final String? eventTitle;
  final DateTime? createdAt;
  final DateTime? lastMessageAt;
  final ChatMessage? lastMessage;
  final int unreadCount;
  final bool muted;
  final String myRole;
  final int memberCount;
  final ChatUser? otherMember;

  /// Direct chat with someone no longer on the team: can't send.
  final bool readOnly;
  final List<ConvMember> members;

  const Conversation({
    required this.id,
    this.kind = 'direct',
    this.title = '',
    this.isEventCrew = false,
    this.eventTitle,
    this.createdAt,
    this.lastMessageAt,
    this.lastMessage,
    this.unreadCount = 0,
    this.muted = false,
    this.myRole = 'member',
    this.memberCount = 0,
    this.otherMember,
    this.readOnly = false,
    this.members = const [],
  });

  factory Conversation.fromJson(Map<String, dynamic> j) => Conversation(
        id: j['id']?.toString() ?? '',
        kind: _s(j['kind']) ?? 'direct',
        title: _s(j['title']) ?? 'Chat',
        isEventCrew: j['is_event_crew'] == true,
        eventTitle: j['event'] is Map ? _s((j['event'] as Map)['title']) : null,
        createdAt: _dt(j['created_at']),
        lastMessageAt: _dt(j['last_message_at']),
        lastMessage: j['last_message'] is Map ? ChatMessage.fromJson(_m(j['last_message'])) : null,
        unreadCount: int.tryParse(j['unread_count']?.toString() ?? '') ?? 0,
        muted: j['muted'] == true,
        myRole: _s(j['my_role']) ?? 'member',
        memberCount: int.tryParse(j['member_count']?.toString() ?? '') ?? 0,
        otherMember: j['other_member'] is Map ? ChatUser.fromJson(_m(j['other_member'])) : null,
        readOnly: j['read_only'] == true,
        members: [
          if (j['members'] is List)
            for (final m in j['members'] as List)
              if (m is Map) ConvMember.fromJson(_m(m)),
        ],
      );

  bool get isGroup => kind == 'group';
  bool get iAmAdmin => myRole == 'admin';
  DateTime get sortTime => lastMessageAt ?? createdAt ?? DateTime(2000);

  Conversation copyWith({ChatMessage? lastMessage, DateTime? lastMessageAt, int? unreadCount, bool? muted}) =>
      Conversation(
        id: id,
        kind: kind,
        title: title,
        isEventCrew: isEventCrew,
        eventTitle: eventTitle,
        createdAt: createdAt,
        lastMessageAt: lastMessageAt ?? this.lastMessageAt,
        lastMessage: lastMessage ?? this.lastMessage,
        unreadCount: unreadCount ?? this.unreadCount,
        muted: muted ?? this.muted,
        myRole: myRole,
        memberCount: memberCount,
        otherMember: otherMember,
        readOnly: readOnly,
        members: members,
      );
}

/// A page of `GET /conversations/<id>/messages/`.
class MessagePage {
  final List<ChatMessage> results;
  final bool hasMore;
  final String? nextBefore;
  final String? nextAfter;
  const MessagePage(this.results, {this.hasMore = false, this.nextBefore, this.nextAfter});
}
