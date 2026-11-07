import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:gal/gal.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../ui/ui.dart';
import '../models/stored_pass.dart';
import '../widgets/attendee_widgets.dart';

/// Width the pass is laid out at for the image, so the saved file looks the same on every phone.
const _verticalWidth = 380.0;
const _landscapeWidth = 720.0;

/// Preview of the pass in the event's layout (vertical or landscape) with "Save to gallery" and "Print".
Future<void> showSavePassSheet(BuildContext context, StoredPass pass) {
  return showAppSheet<void>(
    context,
    background: AppColors.background,
    builder: (_) => _SavePassSheet(pass: pass),
  );
}

class _SavePassSheet extends StatefulWidget {
  final StoredPass pass;
  const _SavePassSheet({required this.pass});

  @override
  State<_SavePassSheet> createState() => _SavePassSheetState();
}

class _SavePassSheetState extends State<_SavePassSheet> {
  final _boundary = GlobalKey();
  String? _busy; // 'save' | 'print'

  String get _fileName => 'eventlaya-pass-${widget.pass.ticketNumber}';

  /// The pass as a PNG at 3× for a sharp image.
  Future<Uint8List> _png() async {
    final box = _boundary.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await box.toImage(pixelRatio: 3);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return data!.buffer.asUint8List();
  }

  Future<void> _save() async {
    setState(() => _busy = 'save');
    try {
      if (!await Gal.hasAccess(toAlbum: true) && !await Gal.requestAccess(toAlbum: true)) {
        if (mounted) AppToast.error(context, 'Allow Eventlaya to add photos, then try again.');
        return;
      }
      await Gal.putImageBytes(await _png(), album: 'Eventlaya', name: _fileName);
      if (mounted) AppToast.success(context, 'Pass saved to your gallery');
    } on GalException catch (e) {
      if (mounted) AppToast.error(context, e.type.message);
    } catch (_) {
      if (mounted) AppToast.error(context, 'Couldn’t save the pass. Try again.');
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _print() async {
    setState(() => _busy = 'print');
    try {
      final img = pw.MemoryImage(await _png());
      final landscape = widget.pass.isLandscape;
      final doc = pw.Document(title: widget.pass.eventTitle);
      doc.addPage(pw.Page(
        pageFormat: landscape ? PdfPageFormat.a4.landscape : PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(36),
        build: (_) => pw.Center(child: pw.Image(img, fit: pw.BoxFit.contain)),
      ));
      await Printing.layoutPdf(name: _fileName, onLayout: (_) => doc.save());
    } catch (_) {
      if (mounted) AppToast.error(context, 'Couldn’t open printing. Try again.');
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final width = widget.pass.isLandscape ? _landscapeWidth : _verticalWidth;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(widget.pass.isLandscape ? 'Landscape pass' : 'Vertical pass',
            textAlign: TextAlign.center, style: AppType.caption),
        const SizedBox(height: 10),
        // Laid out at a fixed width and scaled to fit the sheet; the capture uses the fixed width.
        ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.55),
          child: FittedBox(
            child: SizedBox(
              width: width,
              child: RepaintBoundary(
                key: _boundary,
                child: Container(
                  color: AppColors.background,
                  padding: const EdgeInsets.all(16),
                  child: passWidget(widget.pass),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        PrimaryButton(
          label: 'Save to gallery',
          icon: Icons.download_rounded,
          loading: _busy == 'save',
          onPressed: _busy == null ? _save : null,
        ),
        const SizedBox(height: 8),
        PrimaryButton(
          label: 'Print',
          icon: Icons.print_rounded,
          tone: ButtonTone.neutral,
          tonal: true,
          loading: _busy == 'print',
          onPressed: _busy == null ? _print : null,
        ),
      ],
    );
  }
}
