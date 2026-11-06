import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// A link the app knows how to open (App Links on https://eventlaya.com).
sealed class DeepLink {
  const DeepLink();
}

/// `/e/<slug>` (and `/e/<slug>/register`, `/e/<slug>/vote`).
class EventLink extends DeepLink {
  final String eventSlug;
  const EventLink(this.eventSlug);
  @override
  bool operator ==(Object other) => other is EventLink && other.eventSlug == eventSlug;
  @override
  int get hashCode => eventSlug.hashCode;
  @override
  String toString() => 'EventLink($eventSlug)';
}

/// `/e/<slug>/vote/<contest slug | poll id>`.
class VoteLink extends DeepLink {
  final String eventSlug;
  final String ref;
  const VoteLink(this.eventSlug, this.ref);
  @override
  bool operator ==(Object other) => other is VoteLink && other.eventSlug == eventSlug && other.ref == ref;
  @override
  int get hashCode => Object.hash(eventSlug, ref);
  @override
  String toString() => 'VoteLink($eventSlug, $ref)';
}

/// `/e/<slug>/vote/<contest>/c/<number | slug>`.
class ContestantLinkTarget extends DeepLink {
  final String eventSlug;
  final String contestRef;
  final String contestantRef;
  const ContestantLinkTarget(this.eventSlug, this.contestRef, this.contestantRef);
  @override
  bool operator ==(Object other) =>
      other is ContestantLinkTarget &&
      other.eventSlug == eventSlug &&
      other.contestRef == contestRef &&
      other.contestantRef == contestantRef;
  @override
  int get hashCode => Object.hash(eventSlug, contestRef, contestantRef);
  @override
  String toString() => 'ContestantLinkTarget($eventSlug, $contestRef, $contestantRef)';
}

/// `/ticket/<qr token>` (the pass link in the confirmation email).
class TicketLink extends DeepLink {
  final String token;
  const TicketLink(this.token);
  @override
  bool operator ==(Object other) => other is TicketLink && other.token == token;
  @override
  int get hashCode => token.hashCode;
  @override
  String toString() => 'TicketLink($token)';
}

/// Any of our pages with `?payment=<intent id>&status=…`: the provider's way back after paying.
class PaymentReturnLink extends DeepLink {
  final String intentId;
  final String? status;

  /// The page it came back to, if it's a known one (e.g. the event's register page).
  final DeepLink? page;
  const PaymentReturnLink(this.intentId, {this.status, this.page});
  @override
  bool operator ==(Object other) => other is PaymentReturnLink && other.intentId == intentId && other.status == status && other.page == page;
  @override
  int get hashCode => Object.hash(intentId, status, page);
  @override
  String toString() => 'PaymentReturnLink($intentId, $status, $page)';
}

const linkHosts = {'eventlaya.com', 'www.eventlaya.com'};
final _uuid = RegExp(r'^[0-9a-fA-F-]{32,36}$');

/// Parses an App Link. Null for anything the app doesn't open.
DeepLink? parseDeepLink(String raw) {
  final uri = Uri.tryParse(raw.trim());
  if (uri == null || (uri.scheme != 'https' && uri.scheme != 'http') || !linkHosts.contains(uri.host.toLowerCase())) {
    return null;
  }
  final seg = [for (final s in uri.pathSegments) if (s.isNotEmpty) Uri.decodeComponent(s)];
  DeepLink? page;
  if (seg.length >= 2 && seg[0] == 'e') {
    final slug = seg[1];
    if (seg.length >= 6 && seg[2] == 'vote' && seg[4] == 'c') {
      page = ContestantLinkTarget(slug, seg[3], seg[5]);
    } else if (seg.length >= 4 && seg[2] == 'vote') {
      page = VoteLink(slug, seg[3]);
    } else {
      page = EventLink(slug);
    }
  } else if (seg.length >= 2 && seg[0] == 'ticket') {
    page = TicketLink(seg[1]);
  }
  final payment = uri.queryParameters['payment'];
  if (payment != null && _uuid.hasMatch(payment)) {
    return PaymentReturnLink(payment, status: uri.queryParameters['status'], page: page);
  }
  return page;
}

/// Receives App Links from MainActivity (`com.eventlaya/links`): the one the app was opened
/// with, and any that arrive while it runs.
class DeepLinks {
  DeepLinks._();
  static final instance = DeepLinks._();

  static const _channel = MethodChannel('com.eventlaya/links');
  final _links = StreamController<DeepLink>.broadcast();
  bool _started = false;

  Stream<DeepLink> get links => _links.stream;

  /// Starts listening; returns the link the app was launched with (once), if any.
  Future<DeepLink?> start() async {
    if (_started) return null;
    _started = true;
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'link' && call.arguments is String) {
        final l = parseDeepLink(call.arguments as String);
        if (l != null) _links.add(l);
      }
      return null;
    });
    try {
      final raw = await _channel.invokeMethod<String>('initialLink');
      return raw == null ? null : parseDeepLink(raw);
    } on MissingPluginException {
      return null; // tests, iOS without the handler
    } catch (e) {
      debugPrint('DeepLinks.initialLink: $e');
      return null;
    }
  }
}
