import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../ui/ui.dart';
import 'attendee_widgets.dart';

/// Full-screen photos: swipe between them, pinch to zoom, tap ✕ or swipe back to close.
Future<void> openPhotoViewer(BuildContext context, List<String> photos, {int initial = 0}) {
  if (photos.isEmpty) return Future.value();
  return Navigator.of(context, rootNavigator: true).push(PageRouteBuilder(
    opaque: true,
    transitionDuration: const Duration(milliseconds: 200),
    pageBuilder: (_, __, ___) => _PhotoViewer(photos: photos, initial: initial),
    transitionsBuilder: (_, a, __, child) => FadeTransition(opacity: a, child: child),
  ));
}

class _PhotoViewer extends StatefulWidget {
  final List<String> photos;
  final int initial;
  const _PhotoViewer({required this.photos, required this.initial});

  @override
  State<_PhotoViewer> createState() => _PhotoViewerState();
}

class _PhotoViewerState extends State<_PhotoViewer> {
  late final _controller = PageController(initialPage: widget.initial);
  late int _index = widget.initial;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final n = widget.photos.length;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(children: [
          PageView.builder(
            controller: _controller,
            itemCount: n,
            onPageChanged: (i) => setState(() => _index = i),
            itemBuilder: (_, i) => InteractiveViewer(
              minScale: 1,
              maxScale: 4,
              child: Center(child: NetImage(url: widget.photos[i], icon: Icons.image_outlined, fit: BoxFit.contain)),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Row(children: [
                if (n > 1) GlassChip('${_index + 1}/$n'),
                const Spacer(),
                AppIconButton(
                  icon: Icons.close_rounded,
                  tooltip: 'Close',
                  color: Colors.white,
                  onPressed: () => Navigator.of(context).maybePop(),
                ),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}
