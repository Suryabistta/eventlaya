import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../../ui/ui.dart';

/// Cloudflare Turnstile ("I'm not a robot") for contests that ask for it.
///
/// The widget runs in a small web view whose page is given eventlaya.com as its origin, so the
/// site key's domain check passes, and hands the one-time token back through a JavaScript channel.
/// If the check can't load (no Google Play WebView, blocked network…) the sheet offers to vote on
/// the website instead. Tokens are single use: ask for a new one before each OTP request / vote.
Future<String?> requestCaptcha(BuildContext context, {required String siteKey, required String fallbackUrl}) {
  return showAppSheet<String>(
    context,
    scrollable: false,
    builder: (_) => _CaptchaSheet(siteKey: siteKey, fallbackUrl: fallbackUrl),
  );
}

String turnstileHtml(String siteKey) {
  final key = jsonEncode(siteKey);
  return '''<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:#fff}body{display:flex;justify-content:center;align-items:flex-start;padding-top:6px}</style>
<script>
function send(m){ try { Captcha.postMessage(m); } catch (e) {} }
function ready(){
  try {
    turnstile.render('#box', {
      sitekey: $key,
      callback: function (t) { send('token:' + t); },
      'error-callback': function () { send('error:'); },
      'expired-callback': function () { send('expired:'); },
    });
  } catch (e) { send('error:' + e); }
}
setTimeout(function () { if (!window.turnstile) send('error:load'); }, 15000);
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=ready&render=explicit" async defer></script>
</head><body><div id="box"></div></body></html>''';
}

class _CaptchaSheet extends StatefulWidget {
  final String siteKey;
  final String fallbackUrl;
  const _CaptchaSheet({required this.siteKey, required this.fallbackUrl});

  @override
  State<_CaptchaSheet> createState() => _CaptchaSheetState();
}

class _CaptchaSheetState extends State<_CaptchaSheet> {
  late final WebViewController _web;
  bool _failed = false;
  bool _done = false;

  @override
  void initState() {
    super.initState();
    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..addJavaScriptChannel('Captcha', onMessageReceived: (m) => _onMessage(m.message))
      ..setNavigationDelegate(NavigationDelegate(
        onWebResourceError: (e) {
          if (e.isForMainFrame != false && mounted) setState(() => _failed = true);
        },
      ));
    _load();
  }

  void _load() {
    setState(() => _failed = false);
    _web.loadHtmlString(turnstileHtml(widget.siteKey), baseUrl: 'https://eventlaya.com/');
  }

  void _onMessage(String m) {
    if (!mounted || _done) return;
    if (m.startsWith('token:') && m.length > 6) {
      _done = true;
      Navigator.of(context).pop(m.substring(6));
    } else if (m.startsWith('error:')) {
      setState(() => _failed = true);
    } else if (m.startsWith('expired:')) {
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SheetHeader(
        title: 'Quick check',
        message: "This contest asks every voter to show they're not a robot. It usually passes on its own.",
      ),
      if (_failed) ...[
        const ContestNoticeInline(
          text: "The robot check didn't load. Check your connection and try again — or vote on the website.",
        ),
        const SizedBox(height: 12),
        PrimaryButton(label: 'Try again', icon: Icons.refresh_rounded, onPressed: _load),
        const SizedBox(height: 8),
        PrimaryButton(
          label: 'Vote on the website',
          icon: Icons.open_in_new_rounded,
          tone: ButtonTone.neutral,
          tonal: true,
          onPressed: () => launchUrl(Uri.parse(widget.fallbackUrl), mode: LaunchMode.externalApplication),
        ),
      ] else
        SizedBox(
          height: 90,
          child: ClipRRect(borderRadius: BorderRadius.circular(12), child: WebViewWidget(controller: _web)),
        ),
    ]);
  }
}

/// Small warning box used inside sheets.
class ContestNoticeInline extends StatelessWidget {
  final String text;
  final Tone tone;
  const ContestNoticeInline({super.key, required this.text, this.tone = Tone.warning});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: tone.tint, borderRadius: BorderRadius.circular(12)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(tone == Tone.danger ? Icons.error_outline_rounded : Icons.info_outline_rounded, size: 18, color: tone.strong),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: AppType.body(13.5, weight: FontWeight.w500, color: AppColors.ink800))),
      ]),
    );
  }
}
