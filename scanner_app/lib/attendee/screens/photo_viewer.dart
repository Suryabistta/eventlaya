import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../ui/ui.dart';
import '../widgets/attendee_widgets.dart';

/// Full-screen photos: swipe between them, pinch or double-tap to zoom.
Future<void> openPhotoViewer(BuildContext context, List<String> photos, {int initial = 0, String? title, String? heroTag}) {
  return Navigator.of(context, rootNavigator: true).push(PageRouteBuilder(
    opaque: false,
    barrierColor: Colors.black,
    transitionDuration: const Duration(milliseconds: 220),
    pageBuilder: (_, __, ___) => PhotoViewer(photos: photos, initial: initial, title: title, heroTag: heroTag),
    transitionsBuilder: (_, a, __, child) => FadeTransition(opacity: a, child: child),
  ));
}

class PhotoViewer extends StatefulWidget {
  final List<String> photos;
  final int initial;
  final String? title;

  /// Hero tag of the first photo (the profile's main photo).
  final String? heroTag;
  const PhotoViewer({super.key, required this.photos, this.initial = 0, this.title, this.heroTag});

  @override
  State<PhotoViewer> createState() => _PhotoViewerState();
}

class _PhotoViewerState extends State<PhotoViewer> {
  late final PageController _pages = PageController(initialPage: widget.initial);
  late int _index = widget.initial;
  final _zoom = <int, TransformationController>{};
  bool _zoomed = false;

  TransformationController _ctrl(int i) => _zoom.putIfAbsent(i, () {
        final c = TransformationController();
        c.addListener(() {
          final z = c.value.getMaxScaleOnAxis() > 1.01;
          if (z != _zoomed && i == _index && mounted) setState(() => _zoomed = z);
        });
        return c;
      });

  @override
  void dispose() {
    _pages.dispose();
    for (final c in _zoom.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _toggleZoom(int i, TapDownDetails? at) {
    final c = _ctrl(i);
    if (c.value.getMaxScaleOnAxis() > 1.01) {
      c.value = Matrix4.identity();
    } else {
      final p = at?.localPosition ?? Offset.zero;
      c.value = Matrix4.identity()
        ..translateByDouble(-p.dx * 1.5, -p.dy * 1.5, 0, 1)
        ..scaleByDouble(2.5, 2.5, 1, 1);
    }
  }

  @override
  Widget build(BuildContext context) {
    final n = widget.photos.length;
    TapDownDetails? lastTap;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(children: [
          PageView.builder(
            controller: _pages,
            physics: _zoomed ? const NeverScrollableScrollPhysics() : const PageScrollPhysics(),
            itemCount: n,
            onPageChanged: (i) => setState(() {
              _zoom[_index]?.value = Matrix4.identity();
              _index = i;
              _zoomed = false;
            }),
            itemBuilder: (_, i) {
              Widget img = NetImage(url: widget.photos[i], icon: Icons.person_rounded, fit: BoxFit.contain);
              if (i == 0 && widget.heroTag != null) img = Hero(tag: widget.heroTag!, child: img);
              return GestureDetector(
                onDoubleTapDown: (d) => lastTap = d,
                onDoubleTap: () => _toggleZoom(i, lastTap),
                child: InteractiveViewer(
                  transformationController: _ctrl(i),
                  minScale: 1,
                  maxScale: 5,
                  child: Center(child: img),
                ),
              );
            },
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Row(children: [
                AppIconButton(
                  icon: Icons.close_rounded,
                  tooltip: 'Close',
                  color: Colors.white,
                  background: Colors.white.withValues(alpha: 0.14),
                  onPressed: () => Navigator.of(context).pop(),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(widget.title ?? '', maxLines: 1, overflow: TextOverflow.ellipsis,
                      style: AppType.body(15, weight: FontWeight.w600, color: Colors.white)),
                ),
                if (n > 1)
                  Text('${_index + 1} / $n', style: AppType.body(14, weight: FontWeight.w600, color: Colors.white70)),
                const SizedBox(width: 8),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}
