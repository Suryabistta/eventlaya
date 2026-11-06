import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../ui/ui.dart';
import 'attendee_widgets.dart';

/// Collapsing image header with a swipeable gallery and a glass back button.
class GalleryHeader extends StatefulWidget {
  final List<String> images;
  final IconData icon;
  final List<Widget> chips;
  const GalleryHeader({super.key, required this.images, required this.icon, this.chips = const []});

  @override
  State<GalleryHeader> createState() => _GalleryHeaderState();
}

class _GalleryHeaderState extends State<GalleryHeader> {
  int _page = 0;

  @override
  Widget build(BuildContext context) {
    final imgs = widget.images;
    return SliverAppBar(
      pinned: true,
      stretch: true,
      expandedHeight: 250,
      backgroundColor: AppColors.brandDark,
      foregroundColor: Colors.white,
      systemOverlayStyle: SystemUiOverlayStyle.light,
      leading: Padding(
        padding: const EdgeInsets.all(6),
        child: ClipOval(
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
            child: ColoredBox(
              color: AppColors.ink950.withValues(alpha: 0.3),
              child: IconButton(
                tooltip: 'Back',
                icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18, color: Colors.white),
                onPressed: () => Navigator.of(context).maybePop(),
              ),
            ),
          ),
        ),
      ),
      flexibleSpace: FlexibleSpaceBar(
        stretchModes: const [StretchMode.zoomBackground],
        background: Stack(fit: StackFit.expand, children: [
          if (imgs.length <= 1)
            NetImage(url: imgs.firstOrNull, icon: widget.icon)
          else
            PageView.builder(
              itemCount: imgs.length,
              onPageChanged: (i) => setState(() => _page = i),
              itemBuilder: (_, i) => NetImage(url: imgs[i], icon: widget.icon),
            ),
          const IgnorePointer(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Color(0x66110D17), Color(0x00110D17), Color(0x77110D17)],
                  stops: [0, 0.45, 1],
                ),
              ),
            ),
          ),
          Positioned(
            left: 16,
            bottom: 16,
            right: 16,
            child: Row(children: [
              for (final c in widget.chips) ...[c, const SizedBox(width: 6)],
              const Spacer(),
              if (imgs.length > 1) GlassChip('${_page + 1}/${imgs.length}'),
            ]),
          ),
        ]),
      ),
    );
  }
}
