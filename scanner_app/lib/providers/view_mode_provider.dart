import 'package:flutter_riverpod/flutter_riverpod.dart';

/// True when a signed-in organizer / gate staff member chose "Switch to
/// attendee view". Loaded from storage at launch (see SplashScreen) and kept
/// in sync by `switchToAttendeeView` / `switchToRoleView`.
final preferAttendeeViewProvider = StateProvider<bool>((ref) => false);
