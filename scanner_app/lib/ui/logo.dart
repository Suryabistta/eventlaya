import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../core/site_branding.dart';

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

/// Eventlaya wordmark (इभेन्टलय). Uses the superadmin's Site logo when one is
/// set, otherwise the built-in image. [tagline] only affects the built-in image
/// (adds "Every Event, Every Voice"); the Site logo has no tagline variant.
class Wordmark extends StatelessWidget {
  final double size;
  final bool tagline;
  const Wordmark({super.key, this.size = 28, this.tagline = false});

  @override
  Widget build(BuildContext context) {
    final builtIn = Image.asset(
      tagline
          ? 'assets/images/logo_full.png'
          : 'assets/images/logo_wordmark.png',
      height: size,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.medium,
      semanticLabel: 'Eventlaya',
    );
    return ValueListenableBuilder<String?>(
      valueListenable: SiteBranding.logo,
      builder: (context, url, _) {
        if (url == null || url.isEmpty) return builtIn;
        return Semantics(
          label: 'Eventlaya',
          image: true,
          child: CachedNetworkImage(
            imageUrl: url,
            height: size,
            fit: BoxFit.contain,
            filterQuality: FilterQuality.medium,
            fadeInDuration: Duration.zero,
            placeholder: (_, __) => SizedBox(height: size),
            errorWidget: (_, __, ___) => builtIn,
          ),
        );
      },
    );
  }
}
