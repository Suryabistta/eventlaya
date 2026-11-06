import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import '../ui/ui.dart';

/// Lets the user take or choose a photo, resized to ≤[maxSize] px and
/// re-encoded as JPEG at [quality]. Returns the file path, or null if
/// cancelled. Gallery uses the system photo picker (no permission needed);
/// the camera asks for camera permission when needed.
Future<String?> pickPhoto(
  BuildContext context, {
  String title = 'Add a photo',
  double maxSize = 1600,
  int quality = 80,
  bool allowRemove = false,
  VoidCallback? onRemove,
}) async {
  final source = await showAppSheet<String>(
    context,
    builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, children: [
      SheetHeader(title: title),
      SheetAction(icon: Icons.photo_library_outlined, label: 'Choose from library', onTap: () => Navigator.pop(ctx, 'gallery')),
      SheetAction(icon: Icons.photo_camera_outlined, label: 'Take a photo', onTap: () => Navigator.pop(ctx, 'camera')),
      if (allowRemove)
        SheetAction(
          icon: Icons.delete_outline_rounded,
          label: 'Remove photo',
          destructive: true,
          onTap: () => Navigator.pop(ctx, 'remove'),
        ),
    ]),
  );
  if (source == null) return null;
  if (source == 'remove') {
    onRemove?.call();
    return null;
  }
  try {
    final file = await ImagePicker().pickImage(
      source: source == 'camera' ? ImageSource.camera : ImageSource.gallery,
      maxWidth: maxSize,
      maxHeight: maxSize,
      imageQuality: quality,
      requestFullMetadata: false,
    );
    return file?.path;
  } on PlatformException catch (e) {
    if (context.mounted) {
      AppToast.error(
        context,
        e.code.contains('camera_access_denied')
            ? 'Allow camera access in Settings to take a photo.'
            : e.code.contains('photo_access_denied')
                ? 'Allow photo access in Settings to choose a photo.'
                : "Couldn't open photos. Try again.",
      );
    }
    return null;
  }
}
