import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../core/api_client.dart';
import '../core/storage.dart';

enum ChatConnection { offline, connecting, online, disabled }

/// One WebSocket per signed-in user (`/ws/chat/?token=<access>`), carrying
/// events for all their conversations.
///
/// - Reconnects with exponential backoff (1 s → 30 s) after drops.
/// - Close 4401 (token missing/expired): refreshes the access token and
///   reconnects; if refresh fails the session is over and it stops.
/// - Close 4403 (chat switched off): stops and reports [ChatConnection.disabled].
/// - Sends `ping` every 25 s to keep proxies from dropping the socket.
///
/// Every server event is re-emitted on [events]. A synthetic
/// `{'type': 'ready', 'reconnected': true}` tells listeners to catch up.
class ChatSocket {
  ChatSocket();

  static const closeUnauthenticated = 4401;
  static const closeForbidden = 4403;

  final _events = StreamController<Map<String, dynamic>>.broadcast();
  final status = ValueNotifier<ChatConnection>(ChatConnection.offline);

  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  Timer? _retry;
  Timer? _ping;
  int _attempt = 0;
  bool _running = false;
  bool _everReady = false;

  Stream<Map<String, dynamic>> get events => _events.stream;
  bool get isOnline => status.value == ChatConnection.online;

  /// `https://host` → `wss://host/ws/chat/?token=…`.
  static Uri wsUri(String server, String token) {
    final base = Uri.parse(server);
    return base.replace(
      scheme: base.scheme == 'https' ? 'wss' : 'ws',
      path: '${base.path.replaceAll(RegExp(r'/$'), '')}/ws/chat/',
      queryParameters: {'token': token},
    );
  }

  void start() {
    if (_running) return;
    _running = true;
    _connect();
  }

  /// Reconnect right away (e.g. app back in the foreground).
  void kick() {
    if (!_running || status.value == ChatConnection.online || status.value == ChatConnection.connecting) return;
    _retry?.cancel();
    _attempt = 0;
    _connect();
  }

  Future<void> _connect() async {
    if (!_running) return;
    _retry?.cancel();
    status.value = ChatConnection.connecting;
    final token = await AppStorage.getAuthToken();
    if (token == null || token.isEmpty) {
      _stopInternal(ChatConnection.offline);
      return;
    }
    final uri = wsUri(await AppStorage.getServerUrl(), token);
    try {
      final channel = WebSocketChannel.connect(uri);
      _channel = channel;
      await channel.ready;
      if (!_running || _channel != channel) {
        channel.sink.close();
        return;
      }
      _sub = channel.stream.listen(
        _onData,
        onDone: () => _onClosed(channel.closeCode),
        onError: (Object e) => debugPrint('ChatSocket error: $e'),
        cancelOnError: false,
      );
    } catch (e) {
      debugPrint('ChatSocket connect failed: $e');
      _scheduleRetry();
    }
  }

  void _onData(dynamic raw) {
    Map<String, dynamic> msg;
    try {
      final decoded = jsonDecode(raw is String ? raw : utf8.decode(raw as List<int>));
      if (decoded is! Map) return;
      msg = Map<String, dynamic>.from(decoded);
    } catch (_) {
      return;
    }
    if (msg['type'] == 'ready') {
      _attempt = 0;
      status.value = ChatConnection.online;
      _ping?.cancel();
      _ping = Timer.periodic(const Duration(seconds: 25), (_) => send({'type': 'ping'}));
      msg['reconnected'] = _everReady;
      _everReady = true;
    }
    _events.add(msg);
  }

  Future<void> _onClosed(int? code) async {
    _ping?.cancel();
    _sub?.cancel();
    _sub = null;
    _channel = null;
    if (!_running) return;
    if (code == closeForbidden) {
      _stopInternal(ChatConnection.disabled);
      _events.add({'type': 'disabled'});
      return;
    }
    if (code == closeUnauthenticated) {
      final fresh = await ApiClient().refreshAccessToken();
      if (fresh == null) {
        _stopInternal(ChatConnection.offline);
        return;
      }
      _attempt = 0;
      _connect();
      return;
    }
    _scheduleRetry();
  }

  void _scheduleRetry() {
    if (!_running) return;
    status.value = ChatConnection.offline;
    final seconds = math.min(30, math.pow(2, _attempt).toInt());
    _attempt = math.min(_attempt + 1, 6);
    _retry?.cancel();
    _retry = Timer(Duration(seconds: seconds), _connect);
  }

  /// Sends a client event. False when not connected (use REST instead).
  bool send(Map<String, dynamic> event) {
    final c = _channel;
    if (c == null || status.value != ChatConnection.online) return false;
    try {
      c.sink.add(jsonEncode(event));
      return true;
    } catch (_) {
      return false;
    }
  }

  void _stopInternal(ChatConnection next) {
    _running = false;
    _retry?.cancel();
    _ping?.cancel();
    _sub?.cancel();
    _sub = null;
    _channel?.sink.close();
    _channel = null;
    status.value = next;
  }

  void stop() => _stopInternal(ChatConnection.offline);

  void dispose() {
    stop();
    _events.close();
    status.dispose();
  }
}
