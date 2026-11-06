import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import '../../ui/ui.dart';
import '../models/contest.dart';

/// "Vote for #07 Asha Rai in Miss Dharan 2026!" + the web link.
String shareText(Contest contest, [Contestant? c]) => c == null
    ? 'Vote in ${contest.title}! ${contest.webUrl}'
    : 'Vote for ${c.label} in ${contest.title}! ${contest.contestantUrl(c.ref)}';

/// Share sheet for a contest (link) or a contestant (link + a 1080×1350 share card, like the web's).
Future<void> shareContest(BuildContext context, Contest contest, {Contestant? contestant}) {
  return showAppSheet<void>(context, builder: (_) => _ShareSheet(contest: contest, contestant: contestant));
}

class _ShareSheet extends StatefulWidget {
  final Contest contest;
  final Contestant? contestant;
  const _ShareSheet({required this.contest, this.contestant});

  @override
  State<_ShareSheet> createState() => _ShareSheetState();
}

class _ShareSheetState extends State<_ShareSheet> {
  Uint8List? _card;
  bool _rendering = false;
  bool _sharing = false;

  String get _url => widget.contestant == null ? widget.contest.webUrl : widget.contest.contestantUrl(widget.contestant!.ref);

  @override
  void initState() {
    super.initState();
    if (widget.contestant != null) _render();
  }

  Future<void> _render() async {
    setState(() => _rendering = true);
    try {
      final png = await renderShareCard(widget.contest, widget.contestant!);
      if (mounted) setState(() => _card = png);
    } catch (e) {
      debugPrint('share card: $e');
    } finally {
      if (mounted) setState(() => _rendering = false);
    }
  }

  Rect? _origin() {
    final box = context.findRenderObject() as RenderBox?;
    return box == null ? null : box.localToGlobal(Offset.zero) & box.size;
  }

  Future<void> _shareCard() async {
    final png = _card;
    final c = widget.contestant;
    if (png == null || c == null) return;
    setState(() => _sharing = true);
    try {
      final dir = await getTemporaryDirectory();
      final name = 'vote-${c.displayNumber.replaceAll(RegExp(r'[^A-Za-z0-9]'), '')}-${c.slug.isEmpty ? 'card' : c.slug}.png';
      final file = File('${dir.path}/$name');
      await file.writeAsBytes(png, flush: true);
      await SharePlus.instance.share(ShareParams(
        files: [XFile(file.path, mimeType: 'image/png', name: name)],
        text: shareText(widget.contest, c),
        subject: 'Vote for ${c.label}',
        sharePositionOrigin: _origin(),
      ));
    } catch (e) {
      if (mounted) AppToast.error(context, "Couldn't share the card");
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  Future<void> _shareLink() async {
    final c = widget.contestant;
    await SharePlus.instance.share(ShareParams(
      text: shareText(widget.contest, c),
      subject: c == null ? widget.contest.title : 'Vote for ${c.label}',
      sharePositionOrigin: _origin(),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.contestant;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      SheetHeader(
        title: c == null ? 'Share this contest' : 'Ask friends to vote for ${c.name}',
        message: c == null ? null : 'Post the card on Facebook, Instagram or your story, or send the link.',
      ),
      if (c != null) ...[
        Center(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: SizedBox(
              height: 300,
              child: AspectRatio(
                aspectRatio: 1080 / 1350,
                child: _card != null
                    ? Image.memory(_card!, fit: BoxFit.cover, semanticLabel: 'Share card for ${c.label}')
                    : ColoredBox(
                        color: AppColors.ink100,
                        child: Center(
                          child: _rendering
                              ? const CircularProgressIndicator()
                              : const Icon(Icons.image_not_supported_outlined, color: AppColors.ink400),
                        ),
                      ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        PrimaryButton(
          label: 'Share card',
          icon: Icons.image_outlined,
          loading: _sharing,
          onPressed: _card == null ? null : _shareCard,
        ),
        const SizedBox(height: 8),
      ],
      PrimaryButton(
        label: c == null ? 'Share link' : 'Share link only',
        icon: Icons.ios_share_rounded,
        tonal: c != null,
        onPressed: _shareLink,
      ),
      const SizedBox(height: 8),
      PrimaryButton(
        label: 'Copy link',
        icon: Icons.link_rounded,
        tone: ButtonTone.neutral,
        tonal: true,
        onPressed: () {
          Clipboard.setData(ClipboardData(text: _url));
          AppToast.success(context, 'Link copied');
        },
      ),
      const SizedBox(height: 6),
      Text(_url, textAlign: TextAlign.center, style: AppType.caption),
    ]);
  }
}

// ── Share card (1080×1350 PNG: photo, number, name, contest, QR to the profile) ──

const _w = 1080.0, _h = 1350.0, _photoH = 860.0;

Future<ui.Image?> _loadImage(String? url) async {
  if (url == null) return null;
  final completer = Completer<ui.Image?>();
  final stream = CachedNetworkImageProvider(url).resolve(ImageConfiguration.empty);
  late final ImageStreamListener listener;
  listener = ImageStreamListener(
    (info, _) {
      if (!completer.isCompleted) completer.complete(info.image.clone());
      stream.removeListener(listener);
    },
    onError: (_, __) {
      if (!completer.isCompleted) completer.complete(null);
      stream.removeListener(listener);
    },
  );
  stream.addListener(listener);
  return completer.future.timeout(const Duration(seconds: 12), onTimeout: () => null);
}

double _text(Canvas canvas, String text, TextStyle style, Offset at, double width, {int maxLines = 1}) {
  final tp = TextPainter(
    text: TextSpan(text: text, style: style),
    textDirection: TextDirection.ltr,
    maxLines: maxLines,
    ellipsis: '…',
  )..layout(maxWidth: width);
  tp.paint(canvas, at);
  return at.dy + tp.height;
}

/// Draws the card with the app's fonts and colours. Throws if the image can't be encoded.
Future<Uint8List> renderShareCard(Contest contest, Contestant c) async {
  final photo = await _loadImage(c.photoUrl);
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder, const Rect.fromLTWH(0, 0, _w, _h));

  canvas.drawRect(const Rect.fromLTWH(0, 0, _w, _h), Paint()..color = const Color(0xFFF1ECF3));
  if (photo != null) {
    final scale = [_w / photo.width, _photoH / photo.height].reduce((a, b) => a > b ? a : b);
    final sw = _w / scale, sh = _photoH / scale;
    final sx = (photo.width - sw) / 2;
    final sy = ((photo.height - sh) / 4).clamp(0.0, double.infinity); // favour faces near the top
    canvas.drawImageRect(photo, Rect.fromLTWH(sx, sy, sw, sh), const Rect.fromLTWH(0, 0, _w, _photoH),
        Paint()..filterQuality = FilterQuality.high);
  } else {
    canvas.drawRect(const Rect.fromLTWH(0, 0, _w, _photoH), Paint()..color = AppColors.brand);
    final tp = TextPainter(
      text: TextSpan(
        text: InitialsAvatar.initialsOf(c.name),
        style: AppType.heading(260, weight: FontWeight.w800, color: Colors.white.withValues(alpha: 0.9)),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, Offset((_w - tp.width) / 2, (_photoH - tp.height) / 2));
  }
  // Fade into the panel
  canvas.drawRect(
    const Rect.fromLTWH(0, _photoH - 260, _w, 260),
    Paint()
      ..shader = ui.Gradient.linear(
        const Offset(0, _photoH - 260),
        const Offset(0, _photoH),
        [const Color(0x001C1724), const Color(0xD91C1724)],
      ),
  );
  // Number badge
  if (c.displayNumber.isNotEmpty) {
    final tp = TextPainter(
      text: TextSpan(text: c.displayNumber, style: AppType.heading(96, weight: FontWeight.w800, color: Colors.white)),
      textDirection: TextDirection.ltr,
    )..layout();
    final r = RRect.fromRectAndRadius(Rect.fromLTWH(56, _photoH - 170, tp.width + 64, 124), const Radius.circular(28));
    canvas.drawRRect(r, Paint()..color = AppColors.brand);
    tp.paint(canvas, Offset(88, _photoH - 170 + (124 - tp.height) / 2));
  }
  // Bottom panel + QR
  canvas.drawRect(const Rect.fromLTWH(0, _photoH, _w, _h - _photoH), Paint()..color = AppColors.ink900);
  const qrSize = 300.0;
  const qrX = _w - 56 - qrSize, qrY = _photoH + 70;
  canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(qrX - 20, qrY - 20, qrSize + 40, qrSize + 40), const Radius.circular(24)),
      Paint()..color = Colors.white);
  canvas.save();
  canvas.translate(qrX, qrY);
  QrPainter(
    data: contest.contestantUrl(c.ref),
    version: QrVersions.auto,
    errorCorrectionLevel: QrErrorCorrectLevel.M,
    eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: AppColors.ink900),
    dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: AppColors.ink900),
  ).paint(canvas, const Size(qrSize, qrSize));
  canvas.restore();

  const left = 56.0;
  const width = qrX - 40 - left - 20;
  var y = _text(canvas, 'VOTE FOR', AppType.body(36, weight: FontWeight.w700, color: const Color(0xFFF9A8C9)),
      const Offset(left, _photoH + 66), width);
  y = _text(canvas, c.name, AppType.heading(70, weight: FontWeight.w800, color: Colors.white, height: 1.05),
      Offset(left, y + 8), width, maxLines: 2);
  y = _text(canvas, contest.title, AppType.body(32, weight: FontWeight.w500, color: Colors.white.withValues(alpha: 0.8)),
      Offset(left, y + 14), width, maxLines: 2);
  _text(canvas, '${contest.eventTitle} · Scan to vote', AppType.body(26, color: Colors.white.withValues(alpha: 0.55)),
      Offset(left, (y + 12).clamp(0, _h - 70)), width);

  final image = await recorder.endRecording().toImage(_w.toInt(), _h.toInt());
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  if (data == null) throw StateError('Could not encode the share card');
  return data.buffer.asUint8List();
}
