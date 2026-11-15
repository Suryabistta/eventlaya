import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Visual pieces of the voting screens (same look as the website's /voting pages):
/// a dark stage with a spotlight when there is no cover photo, and DD:HH:MM:SS countdown boxes.

const stageTop = Color(0xFF3B0A1F);
const stageBottom = Color(0xFF7A1A3C);

class StageArt extends StatelessWidget {
  final String seed;
  const StageArt({super.key, required this.seed});

  @override
  Widget build(BuildContext context) => CustomPaint(painter: _StagePainter(seed), child: const SizedBox.expand());
}

class _StagePainter extends CustomPainter {
  final String seed;
  _StagePainter(this.seed);

  @override
  void paint(Canvas canvas, Size s) {
    final rect = Offset.zero & s;
    canvas.drawRect(rect, Paint()..shader = const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [stageTop, stageBottom]).createShader(rect));
    final side = Paint()..color = Colors.white.withValues(alpha: 0.04);
    canvas.drawPath(Path()..moveTo(s.width * .05, 0)..lineTo(s.width * .18, 0)..lineTo(s.width * .38, s.height)..lineTo(-s.width * .1, s.height)..close(), side);
    canvas.drawPath(Path()..moveTo(s.width * .82, 0)..lineTo(s.width * .95, 0)..lineTo(s.width * 1.1, s.height)..lineTo(s.width * .62, s.height)..close(), side);
    final beam = Path()..moveTo(s.width * .45, 0)..lineTo(s.width * .55, 0)..lineTo(s.width * .82, s.height * .9)..lineTo(s.width * .18, s.height * .9)..close();
    canvas.drawPath(beam, Paint()..shader = LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [const Color(0xFFFFE9F1).withValues(alpha: .5), const Color(0xFFFFD1E0).withValues(alpha: .04)]).createShader(rect));
    canvas.drawOval(Rect.fromCenter(center: Offset(s.width / 2, s.height * .9), width: s.width * .62, height: s.height * .1), Paint()..color = const Color(0xBF1A0510));
    var h = 0;
    for (final c in seed.codeUnits) {
      h = (h * 31 + c) & 0x7fffffff;
    }
    final rnd = math.Random(h);
    final dot = Paint();
    for (var i = 0; i < 22; i++) {
      dot.color = const Color(0xFFF6C97A).withValues(alpha: .35 + rnd.nextDouble() * .6);
      canvas.drawCircle(Offset(rnd.nextDouble() * s.width, rnd.nextDouble() * s.height), .8 + rnd.nextDouble() * 2.2, dot);
    }
  }

  @override
  bool shouldRepaint(_StagePainter old) => old.seed != seed;
}

/// Cover photo, or the stage art.
class ContestCover extends StatelessWidget {
  final String? url;
  final String seed;
  const ContestCover({super.key, this.url, required this.seed});

  @override
  Widget build(BuildContext context) {
    if (url == null || url!.isEmpty) return StageArt(seed: seed);
    return Image.network(url!, fit: BoxFit.cover, width: double.infinity, height: double.infinity, errorBuilder: (_, __, ___) => StageArt(seed: seed));
  }
}

/// Ticking DD : HH : MM : SS boxes to [target]. Shows nothing once it has passed.
class CountdownBoxes extends StatefulWidget {
  final DateTime target;
  final bool dark;
  const CountdownBoxes({super.key, required this.target, this.dark = false});

  @override
  State<CountdownBoxes> createState() => _CountdownBoxesState();
}

class _CountdownBoxesState extends State<CountdownBoxes> {
  Timer? _t;

  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(seconds: 1), (_) => mounted ? setState(() {}) : null);
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final left = widget.target.difference(DateTime.now());
    if (left.isNegative) return const SizedBox.shrink();
    final parts = [(left.inDays, 'DAYS'), (left.inHours % 24, 'HRS'), (left.inMinutes % 60, 'MIN'), (left.inSeconds % 60, 'SEC')];
    final dark = widget.dark;
    return Semantics(
      label: '${parts[0].$1} days ${parts[1].$1} hours ${parts[2].$1} minutes left',
      child: ExcludeSemantics(
        child: Row(children: [
          for (var i = 0; i < parts.length; i++) ...[
            if (i > 0) const SizedBox(width: 6),
            Expanded(
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 6),
                decoration: BoxDecoration(
                  color: dark ? Colors.white.withValues(alpha: .12) : const Color(0xFFFAF8FB),
                  borderRadius: BorderRadius.circular(10),
                  border: dark ? Border.all(color: Colors.white.withValues(alpha: .25)) : null,
                ),
                child: Column(children: [
                  Text(parts[i].$1.toString().padLeft(2, '0'),
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: dark ? Colors.white : const Color(0xFF1C1724), fontFeatures: const [FontFeature.tabularFigures()])),
                  Text(parts[i].$2, style: TextStyle(fontSize: 9, fontWeight: FontWeight.w600, letterSpacing: .8, color: dark ? Colors.white70 : const Color(0xFF7B7186))),
                ]),
              ),
            ),
          ],
        ]),
      ),
    );
  }
}
