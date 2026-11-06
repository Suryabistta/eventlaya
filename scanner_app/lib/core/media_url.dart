import 'storage.dart';

/// Resolves an image/media reference from the API to a full URL.
///
/// The server sends absolute URLs (`https://…/media/x.jpg`) in some places and
/// relative paths (`/media/uploads/x.jpg` or `uploads/x.jpg`) in others.
/// Returns null for empty input.
String? mediaUrl(Object? raw) {
  final s = raw?.toString().trim() ?? '';
  if (s.isEmpty) return null;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('data:')) return null;
  final base = AppStorage.serverUrlSync;
  if (s.startsWith('/')) return '$base$s';
  if (s.startsWith('media/')) return '$base/$s';
  return '$base/media/$s';
}
