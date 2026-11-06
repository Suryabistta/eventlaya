import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../ui/ui.dart';
import 'payment_models.dart';

/// How the buyer left the checkout page.
enum CheckoutExit {
  /// The provider sent them back to our return URL (status in [CheckoutResult.status]).
  returned,

  /// They closed the page themselves.
  closed,

  /// They chose to finish in the phone's browser; poll the intent when they come back.
  browser,
}

class CheckoutResult {
  final CheckoutExit exit;

  /// `status` from the return URL (paid / pending / cancelled / failed / expired), as a hint only:
  /// the intent's status from the API is what counts.
  final String? status;
  const CheckoutResult(this.exit, [this.status]);
}

/// True when [url] is the provider's way back to us for [intentId]: the API verifies the payment and
/// redirects to `<return_url>?payment=<id>&status=…` (docs/payments.md §1).
bool isPaymentReturn(String url, String intentId) {
  final uri = Uri.tryParse(url);
  return uri != null && uri.queryParameters['payment'] == intentId;
}

/// Khalti / eSewa / test checkout inside the app.
///
/// Why a web view and not a Custom Tab: eSewa needs a signed form POST, and the provider's final
/// redirect lands on our web return URL — inside a web view the app sees that redirect, stops it and
/// shows its own result screen. A Custom Tab would need verified App Links plus a second activity
/// instance to come back. The page is the provider's own (address shown in the top bar); "Open in
/// browser" is offered for redirect checkouts if the buyer prefers.
class CheckoutScreen extends StatefulWidget {
  final String intentId;
  final Checkout checkout;
  final String providerName;
  final String amountLabel;

  const CheckoutScreen({
    super.key,
    required this.intentId,
    required this.checkout,
    required this.providerName,
    required this.amountLabel,
  });

  /// Opens the checkout; resolves when the buyer comes back or leaves.
  static Future<CheckoutResult> open(
    BuildContext context, {
    required String intentId,
    required Checkout checkout,
    required String providerName,
    required String amountLabel,
  }) async {
    final r = await Navigator.of(context).push<CheckoutResult>(MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => CheckoutScreen(
        intentId: intentId,
        checkout: checkout,
        providerName: providerName,
        amountLabel: amountLabel,
      ),
    ));
    return r ?? const CheckoutResult(CheckoutExit.closed);
  }

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  late final WebViewController _web;
  int _progress = 0;
  String _host = '';
  String? _error;
  bool _done = false;

  @override
  void initState() {
    super.initState();
    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: (req) {
          if (_catchReturn(req.url)) return NavigationDecision.prevent;
          final scheme = Uri.tryParse(req.url)?.scheme ?? '';
          if (scheme != 'http' && scheme != 'https' && scheme != 'about' && scheme != 'data') {
            // Wallet app links (khalti://, esewa://, intent://…): hand them to the phone.
            unawaited(launchUrl(Uri.parse(req.url), mode: LaunchMode.externalApplication).catchError((_) => false));
            return NavigationDecision.prevent;
          }
          return NavigationDecision.navigate;
        },
        onPageStarted: (url) {
          if (_catchReturn(url)) return;
          if (mounted) setState(() => _host = Uri.tryParse(url)?.host ?? '');
        },
        onUrlChange: (change) {
          final url = change.url;
          if (url != null) _catchReturn(url);
        },
        onProgress: (p) {
          if (mounted) setState(() => _progress = p);
        },
        onWebResourceError: (err) {
          if (err.isForMainFrame == false || !mounted) return;
          setState(() => _error = err.description.isEmpty ? "The payment page didn't load." : err.description);
        },
      ));
    _load();
  }

  void _load() {
    setState(() => _error = null);
    final c = widget.checkout;
    if (c.redirectUrl != null) {
      _web.loadRequest(Uri.parse(c.redirectUrl!));
    } else if (c.formAction != null) {
      // eSewa: POST the signed fields as a normal form submission.
      _web.loadRequest(
        Uri.parse(c.formAction!),
        method: c.method.toUpperCase() == 'GET' ? LoadRequestMethod.get : LoadRequestMethod.post,
        headers: const {'Content-Type': 'application/x-www-form-urlencoded'},
        body: Uint8List.fromList(utf8.encode(c.formBody)),
      );
    }
  }

  bool _catchReturn(String url) {
    if (_done || !isPaymentReturn(url, widget.intentId)) return false;
    _done = true;
    final status = Uri.tryParse(url)?.queryParameters['status'];
    if (mounted) Navigator.of(context).pop(CheckoutResult(CheckoutExit.returned, status));
    return true;
  }

  Future<void> _close() async {
    final leave = await confirmSheet(
      context,
      title: 'Leave the payment?',
      message: "If you already paid, we'll still pick it up — the next screen checks with ${widget.providerName}.",
      confirmLabel: 'Leave',
    );
    if (leave && mounted && !_done) {
      _done = true;
      Navigator.of(context).pop(const CheckoutResult(CheckoutExit.closed));
    }
  }

  Future<void> _openInBrowser() async {
    final url = widget.checkout.redirectUrl;
    if (url == null) return;
    final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!mounted) return;
    if (!ok) {
      AppToast.error(context, "Couldn't open the browser");
      return;
    }
    _done = true;
    Navigator.of(context).pop(const CheckoutResult(CheckoutExit.browser));
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _web.canGoBack()) {
          await _web.goBack();
        } else {
          await _close();
        }
      },
      child: Scaffold(
        backgroundColor: AppColors.surface,
        appBar: AppBar(
          backgroundColor: AppColors.surface,
          surfaceTintColor: Colors.transparent,
          leading: IconButton(
            tooltip: 'Close',
            icon: const Icon(Icons.close_rounded, color: AppColors.ink700),
            onPressed: _close,
          ),
          titleSpacing: 0,
          title: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text('Pay ${widget.amountLabel} · ${widget.providerName}', style: AppType.heading(16)),
            if (_host.isNotEmpty)
              Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(_host.startsWith('10.') || _host == 'localhost' ? Icons.lock_open_rounded : Icons.lock_rounded,
                    size: 12, color: AppColors.success),
                const SizedBox(width: 4),
                Flexible(child: Text(_host, overflow: TextOverflow.ellipsis, style: AppType.caption)),
              ]),
          ]),
          actions: [
            if (widget.checkout.redirectUrl != null)
              PopupMenuButton<String>(
                tooltip: 'More',
                onSelected: (v) {
                  if (v == 'browser') _openInBrowser();
                  if (v == 'reload') _web.reload();
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'reload', child: Text('Reload page')),
                  PopupMenuItem(value: 'browser', child: Text('Open in browser instead')),
                ],
              ),
          ],
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(2),
            child: _progress < 100
                ? LinearProgressIndicator(value: _progress / 100, minHeight: 2, color: AppColors.brand, backgroundColor: Colors.transparent)
                : const SizedBox(height: 2),
          ),
        ),
        body: _error != null
            ? ErrorState(
                title: "The payment page didn't load",
                message: '$_error\nCheck your connection and try again.',
                onRetry: _load,
              )
            : WebViewWidget(controller: _web),
      ),
    );
  }
}
