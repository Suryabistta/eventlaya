import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/notification_service.dart';
import '../providers/modules_provider.dart';
import '../screens/common/session_guard.dart' show appNavigatorKey;
import 'chat_providers.dart';
import 'screens/chat_thread_screen.dart';

/// Opens the right conversation when a chat push
/// (`{type: "chat_message", conversation_id, message_id}`) is tapped — from
/// the background, from a terminated app (pending tap), or a foreground
/// local notification. Mixed into the organizer and staff shells.
mixin ChatPushHandler<T extends ConsumerStatefulWidget> on ConsumerState<T> {
  StreamSubscription? _chatPushSub;

  void initChatPush() {
    _chatPushSub = NotificationService.taps.listen(_handleChatPush);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final pending = NotificationService.takePendingTap(where: (d) => d['type'] == 'chat_message');
      if (pending != null) _handleChatPush(pending);
    });
  }

  void disposeChatPush() => _chatPushSub?.cancel();

  Future<void> _handleChatPush(Map<String, dynamic> data) async {
    if (data['type'] != 'chat_message') return;
    final id = data['conversation_id']?.toString();
    if (id == null || id.isEmpty) return;
    try {
      await ref.read(modulesProvider.future); // chat availability is known after this
    } catch (_) {}
    if (!mounted || !ref.read(chatEnabledProvider)) return;
    if (NotificationService.activeChatConversationId == id) return;
    appNavigatorKey.currentState?.push(MaterialPageRoute(builder: (_) => ChatThreadScreen(conversationId: id)));
  }
}
