import 'package:flutter/material.dart';

/// Eventlaya app icon: white इ on the brand red tile.
class LogoMark extends StatelessWidget {
  final double size;
  const LogoMark({super.key, this.size = 40});

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/app_icon.png',
      width: size,
      height: size,
      filterQuality: FilterQuality.medium,
      semanticLabel: 'Eventlaya',
    );
  }
}

/// Eventlaya wordmark (इभेन्टलय). [tagline] adds "Every Event, Every Voice".
class Wordmark extends StatelessWidget {
  final double size;
  final bool tagline;
  const Wordmark({super.key, this.size = 28, this.tagline = false});

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      tagline ? 'assets/images/logo_full.png' : 'assets/images/logo_wordmark.png',
      height: size,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.medium,
      semanticLabel: 'Eventlaya',
    );
  }
}
