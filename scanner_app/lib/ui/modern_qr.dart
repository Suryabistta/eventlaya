import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

/// Eventlaya's QR style, same as the website: round dots and rounded corner
/// squares. Full-size dots scan as reliably as square modules.
class ModernQrPainter extends CustomPainter {
  final String data;
  final Color color;
  final int errorCorrectLevel;

  ModernQrPainter({required this.data, this.color = Colors.black, this.errorCorrectLevel = QrErrorCorrectLevel.Q});

  @override
  void paint(Canvas canvas, Size size) {
    final qr = QrImage(QrCode.fromData(data: data, errorCorrectLevel: errorCorrectLevel));
    final n = qr.moduleCount;
    final u = size.shortestSide / n;
    final fill = Paint()
      ..color = color
      ..isAntiAlias = true;
    final finders = [(0, 0), (0, n - 7), (n - 7, 0)];
    bool inFinder(int r, int c) => finders.any((f) => r >= f.$1 && r < f.$1 + 7 && c >= f.$2 && c < f.$2 + 7);

    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c) && !inFinder(r, c)) {
          canvas.drawCircle(Offset((c + 0.5) * u, (r + 0.5) * u), u / 2, fill);
        }
      }
    }
    final ring = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = u
      ..isAntiAlias = true;
    for (final (r, c) in finders) {
      canvas.drawRRect(
          RRect.fromRectAndRadius(Rect.fromLTWH((c + 0.5) * u, (r + 0.5) * u, 6 * u, 6 * u), Radius.circular(1.8 * u)), ring);
      canvas.drawRRect(
          RRect.fromRectAndRadius(Rect.fromLTWH((c + 2) * u, (r + 2) * u, 3 * u, 3 * u), Radius.circular(0.9 * u)), fill);
    }
  }

  @override
  bool shouldRepaint(ModernQrPainter old) => old.data != data || old.color != color || old.errorCorrectLevel != errorCorrectLevel;
}

/// A QR code widget in Eventlaya's style (no margin: place it on a white tile).
class ModernQr extends StatelessWidget {
  final String data;
  final double size;
  final Color color;
  final String semanticsLabel;

  const ModernQr({super.key, required this.data, required this.size, this.color = Colors.black, this.semanticsLabel = 'QR code'});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: semanticsLabel,
      image: true,
      child: SizedBox.square(
        dimension: size,
        child: CustomPaint(painter: ModernQrPainter(data: data, color: color)),
      ),
    );
  }
}
