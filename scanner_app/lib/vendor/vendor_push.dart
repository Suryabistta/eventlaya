import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/notification_service.dart';
import '../providers/auth_provider.dart';
import '../providers/modules_provider.dart';
import 'data/vendor_models.dart';
import 'providers/vendor_providers.dart';
import 'widgets/request_sheet.dart';

/// Push types for the listing owner (`{type, kind, inquiry_id, slot_id}`).
const bookingPushTypes = {'booking_request', 'booking_cancelled'};

bool isBookingPush(Map<String, dynamic> data) => bookingPushTypes.contains(data['type']);

/// Opens the request when a `booking_request` / `booking_cancelled` push is
/// tapped (background, terminated or foreground local notification), and
/// refreshes the inbox when one arrives in the foreground. Mixed into the
/// vendor shell and the organizer shell (organizers with marketplace access).
mixin BookingPushHandler<T extends ConsumerStatefulWidget> on ConsumerState<T> {
  StreamSubscription? _bookingTapSub;
  StreamSubscription? _bookingMsgSub;

  void initBookingPush() {
    _bookingTapSub = NotificationService.taps.listen(_handleBookingTap);
    _bookingMsgSub = NotificationService.messages.listen((data) {
      if (isBookingPush(data) && mounted && _canManage) ref.refreshVendorData();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final pending = NotificationService.takePendingTap(where: isBookingPush);
      if (pending != null) _handleBookingTap(pending);
    });
  }

  void disposeBookingPush() {
    _bookingTapSub?.cancel();
    _bookingMsgSub?.cancel();
  }

  bool get _canManage => ref.read(authProvider).user?.hasBusinessPortal ?? false;

  Future<void> _handleBookingTap(Map<String, dynamic> data) async {
    if (!isBookingPush(data)) return;
    final id = data['inquiry_id']?.toString();
    if (id == null || id.isEmpty || !mounted || !_canManage) return;
    try {
      await ref.read(modulesProvider.future);
    } catch (_) {}
    if (!mounted || !ref.read(moduleEnabledProvider(AppModule.marketplace))) return;
    await openRequestById(context, ref, ListingKindX.parse(data['kind']), id);
  }
}
