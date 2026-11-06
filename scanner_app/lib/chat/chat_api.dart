import '../core/api_client.dart';
import 'chat_models.dart';

/// Team chat REST API (`/api/chat/…`, module `chat`).
class ChatApi {
  ChatApi([ApiClient? client]) : _api = client ?? ApiClient();
  final ApiClient _api;
  static const _base = '/api/chat';

  Map<String, dynamic> _m(dynamic d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{};
  List _l(dynamic d) => d is List ? d : (d is Map && d['results'] is List ? d['results'] as List : const []);

  Future<List<Conversation>> conversations() async {
    final r = await _api.get('$_base/conversations/');
    return [for (final c in _l(r.data)) if (c is Map) Conversation.fromJson(_m(c))];
  }

  Future<Conversation> conversation(String id) async =>
      Conversation.fromJson(_m((await _api.get('$_base/conversations/$id/')).data));

  /// Get-or-create a direct chat.
  Future<Conversation> startDirect(String userId) async => Conversation.fromJson(
      _m((await _api.post('$_base/conversations/', data: {'kind': 'direct', 'user_id': userId})).data));

  /// Organizers only.
  Future<Conversation> createGroup(String title, List<String> userIds) async => Conversation.fromJson(_m(
      (await _api.post('$_base/conversations/', data: {'kind': 'group', 'title': title, 'user_ids': userIds})).data));

  Future<Conversation> rename(String id, String title) async =>
      Conversation.fromJson(_m((await _api.patch('$_base/conversations/$id/', data: {'title': title})).data));

  Future<Conversation> setMuted(String id, bool muted) async =>
      Conversation.fromJson(_m((await _api.post('$_base/conversations/$id/mute/', data: {'muted': muted})).data));

  Future<Conversation> addMembers(String id, List<String> userIds) async => Conversation.fromJson(
      _m((await _api.post('$_base/conversations/$id/members/', data: {'user_ids': userIds})).data));

  Future<Conversation> removeMember(String id, String userId) async =>
      Conversation.fromJson(_m((await _api.delete('$_base/conversations/$id/members/$userId/')).data));

  Future<Conversation> setRole(String id, String userId, String role) async => Conversation.fromJson(
      _m((await _api.patch('$_base/conversations/$id/members/$userId/', data: {'role': role})).data));

  Future<void> leave(String id) => _api.post('$_base/conversations/$id/leave/');

  Future<void> markRead(String id, {String? messageId}) =>
      _api.post('$_base/conversations/$id/read/', data: {if (messageId != null) 'message_id': messageId});

  /// Newest first (`before` = older page); with [after], oldest first (catch-up).
  Future<MessagePage> messages(String id, {String? before, String? after, int limit = 30}) async {
    final r = await _api.get('$_base/conversations/$id/messages/', queryParameters: {
      'limit': limit,
      if (before != null) 'before': before,
      if (after != null) 'after': after,
    });
    final d = _m(r.data);
    return MessagePage(
      [for (final m in _l(d['results'])) if (m is Map) ChatMessage.fromJson(_m(m))],
      hasMore: d['has_more'] == true,
      nextBefore: d['next_before']?.toString(),
      nextAfter: d['next_after']?.toString(),
    );
  }

  /// [attachment] is the URL from `/api/uploads/` (kind=chat) or `{url, name}`.
  Future<ChatMessage> send(String id, {required String body, String? replyTo, String? clientId, Object? attachment}) async =>
      ChatMessage.fromJson(_m((await _api.post('$_base/conversations/$id/messages/', data: {
        'body': body,
        if (replyTo != null) 'reply_to': replyTo,
        if (clientId != null) 'client_id': clientId,
        if (attachment != null) 'attachment': attachment,
      }))
          .data));

  /// Own messages, within 15 minutes.
  Future<ChatMessage> edit(String messageId, String body) async =>
      ChatMessage.fromJson(_m((await _api.patch('$_base/messages/$messageId/', data: {'body': body})).data));

  Future<ChatMessage> deleteMessage(String messageId) async =>
      ChatMessage.fromJson(_m((await _api.delete('$_base/messages/$messageId/')).data));

  /// People you can start a direct chat with.
  Future<List<ChatUser>> contacts() async {
    final r = await _api.get('$_base/contacts/');
    return [for (final u in _l(r.data)) if (u is Map) ChatUser.fromJson(_m(u))];
  }
}
