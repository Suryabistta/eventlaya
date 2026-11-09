import 'package:flutter/material.dart';
import 'modern_qr.dart';
import 'logo.dart';
import 'sheets.dart';
import 'status.dart';
import 'tokens.dart';

class PassField {
  final String label;
  final String value;
  final bool mono;
  const PassField(this.label, this.value, {this.mono = false});
}

/// The Eventlaya signature object: a white ticket with a dashed perforation,
/// punched notches and a brand-coloured stub holding the QR code on a white tile.
class TicketPass extends StatelessWidget {
  final String eventTitle;
  final String? eventSubtitle;
  final String attendeeName;
  final String? ticketCode;
  final String? qrData;
  final String? statusLabel;
  final Tone statusTone;
  final List<PassField> fields;

  const TicketPass({
    super.key,
    required this.eventTitle,
    this.eventSubtitle,
    required this.attendeeName,
    this.ticketCode,
    this.qrData,
    this.statusLabel,
    this.statusTone = Tone.neutral,
    this.fields = const [],
    this.notchColor = AppColors.background,
    this.landscape = false,
  });

  /// Colour of the surface behind the pass, used for the punched notches.
  final Color notchColor;

  static const _notchRadius = 14.0;

  Widget _notch() => Container(
        width: _notchRadius * 2,
        height: _notchRadius * 2,
        decoration: BoxDecoration(color: notchColor, shape: BoxShape.circle),
      );

  /// Lay the stub beside the body (when there is room, about 440 wide). Phones in portrait still stack.
  final bool landscape;

  static const landscapeMinWidth = 440.0;

  Widget _body() => Padding(
        padding: const EdgeInsets.fromLTRB(22, 20, 22, 22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                const LogoMark(size: 24),
                const SizedBox(width: 8),
                Text('Eventlaya', style: AppType.heading(15, weight: FontWeight.w700)),
                const Spacer(),
                if (statusLabel != null) Flexible(child: StatusBadge(statusLabel!, tone: statusTone)),
              ],
            ),
            const SizedBox(height: 18),
            Text(eventTitle, style: AppType.heading(22, weight: FontWeight.w700)),
            if (eventSubtitle != null && eventSubtitle!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(eventSubtitle!, style: AppType.body(13, color: AppColors.textSecondary)),
            ],
            const SizedBox(height: 18),
            _Field(label: 'Attendee', value: attendeeName, large: true),
            if (fields.isNotEmpty) ...[
              const SizedBox(height: 14),
              _FieldGrid(fields: fields),
            ],
          ],
        ),
      );

  Widget _stub(double qrSize, {EdgeInsets padding = const EdgeInsets.fromLTRB(22, 4, 22, 22)}) => Container(
        color: AppColors.brand,
        padding: padding,
        alignment: Alignment.center,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (qrData != null && qrData!.isNotEmpty)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(AppRadius.lg),
                ),
                child: ModernQr(data: qrData!, size: qrSize, color: AppColors.ink900, semanticsLabel: 'Ticket QR code'),
              )
            else
              Container(
                height: 72,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(AppRadius.lg),
                ),
                child: Text('No QR code for this pass', style: AppType.body(13, color: Colors.white)),
              ),
            if (ticketCode != null && ticketCode!.isNotEmpty) ...[
              const SizedBox(height: 12),
              SelectableText(
                ticketCode!,
                textAlign: TextAlign.center,
                style: AppType.mono(15, weight: FontWeight.w600, color: Colors.white),
              ),
            ],
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      final side = landscape && c.maxWidth >= landscapeMinWidth;
      final qrSize = side ? 150.0 : (c.maxWidth * 0.5).clamp(140.0, 220.0);
      final Widget content = side
          ? IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(child: Container(color: AppColors.surface, child: _body())),
                  // Perforation with punched notches, running top to bottom
                  Container(
                    width: _notchRadius * 2,
                    color: AppColors.brand,
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        Positioned.fill(child: CustomPaint(painter: _DashPainter(inset: _notchRadius + 8, vertical: true))),
                        Positioned(top: -_notchRadius, left: 0, child: _notch()),
                        Positioned(bottom: -_notchRadius, left: 0, child: _notch()),
                      ],
                    ),
                  ),
                  SizedBox(width: qrSize + 56, child: _stub(qrSize, padding: const EdgeInsets.fromLTRB(4, 22, 22, 22))),
                ],
              ),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(color: AppColors.surface, child: _body()),
                // Perforation with punched notches
                Container(
                  height: _notchRadius * 2,
                  color: AppColors.brand,
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      Positioned.fill(child: CustomPaint(painter: _DashPainter(inset: _notchRadius + 8))),
                      Positioned(left: -_notchRadius, top: 0, child: _notch()),
                      Positioned(right: -_notchRadius, top: 0, child: _notch()),
                    ],
                  ),
                ),
                _stub(qrSize),
              ],
            );
      return DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppRadius.xl),
          boxShadow: [
            BoxShadow(color: AppColors.ink900.withValues(alpha: 0.08), blurRadius: 24, offset: const Offset(0, 8)),
          ],
        ),
        child: ClipRRect(borderRadius: BorderRadius.circular(AppRadius.xl), child: content),
      );
    });
  }
}

/// Opens a [TicketPass] in a bottom sheet with optional actions beneath it.
Future<void> showTicketPassSheet(
  BuildContext context, {
  required TicketPass pass,
  List<Widget> actions = const [],
}) {
  return showAppSheet<void>(
    context,
    background: AppColors.background,
    builder: (ctx) => Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ConstrainedBox(constraints: const BoxConstraints(maxWidth: 420), child: pass),
        if (actions.isNotEmpty) ...[
          const SizedBox(height: 16),
          for (var i = 0; i < actions.length; i++) ...[
            if (i > 0) const SizedBox(height: 8),
            actions[i],
          ],
        ],
      ],
    ),
  );
}

class _Field extends StatelessWidget {
  final String label;
  final String value;
  final bool large;
  final bool mono;
  const _Field({required this.label, required this.value, this.large = false, this.mono = false});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: AppType.body(12, color: AppColors.textTertiary)),
        const SizedBox(height: 2),
        Text(
          value,
          maxLines: mono ? 1 : 2,
          overflow: TextOverflow.ellipsis,
          style: mono
              ? AppType.mono(14, weight: FontWeight.w600)
              : large
                  ? AppType.heading(20, weight: FontWeight.w700)
                  : AppType.body(14, weight: FontWeight.w500),
        ),
      ],
    );
  }
}

class _FieldGrid extends StatelessWidget {
  final List<PassField> fields;
  const _FieldGrid({required this.fields});

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < fields.length; i += 2) {
      final a = fields[i];
      final b = i + 1 < fields.length ? fields[i + 1] : null;
      if (rows.isNotEmpty) rows.add(const SizedBox(height: 12));
      rows.add(Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: _Field(label: a.label, value: a.value, mono: a.mono)),
          const SizedBox(width: 12),
          Expanded(
            child: b == null ? const SizedBox() : _Field(label: b.label, value: b.value, mono: b.mono),
          ),
        ],
      ));
    }
    return Column(children: rows);
  }
}

class _DashPainter extends CustomPainter {
  final double inset;
  final bool vertical;
  _DashPainter({required this.inset, this.vertical = false});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.55)
      ..strokeWidth = 1.5
      ..strokeCap = StrokeCap.round;
    const dash = 7.0, gap = 6.0;
    final length = vertical ? size.height : size.width;
    final mid = (vertical ? size.width : size.height) / 2;
    var t = inset;
    while (t < length - inset) {
      final end = (t + dash).clamp(0.0, length - inset);
      canvas.drawLine(
        vertical ? Offset(mid, t) : Offset(t, mid),
        vertical ? Offset(mid, end) : Offset(end, mid),
        paint,
      );
      t += dash + gap;
    }
  }

  @override
  bool shouldRepaint(_DashPainter old) => old.inset != inset || old.vertical != vertical;
}
