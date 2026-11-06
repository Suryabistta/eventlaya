import 'package:hive_flutter/hive_flutter.dart';
import 'package:flutter/foundation.dart';

class OfflineScan {
  final String qrToken;
  final String scanType; // 'gate_in' or 'gate_out'
  final String gateName;

  /// Dynamic gate id (preferred by the server); null for legacy name-only gates.
  final String? gateId;
  final String scannedAt; // ISO 8601 timestamp
  final String eventId;

  OfflineScan({
    required this.qrToken,
    required this.scanType,
    required this.gateName,
    this.gateId,
    required this.scannedAt,
    required this.eventId,
  });

  Map<String, dynamic> toJson() => {
        'qr_token': qrToken,
        'scan_type': scanType,
        'gate_name': gateName,
        if (gateId != null && gateId!.isNotEmpty) 'gate_id': gateId,
        'scanned_at_client': scannedAt,
        'event_id': eventId,
      };

  factory OfflineScan.fromMap(Map map) => OfflineScan(
        qrToken: map['qr_token']?.toString() ?? '',
        scanType: map['scan_type']?.toString() ?? 'gate_in',
        gateName: map['gate_name']?.toString() ?? '',
        gateId: map['gate_id']?.toString(),
        scannedAt: map['scanned_at_client']?.toString() ?? DateTime.now().toIso8601String(),
        eventId: map['event_id']?.toString() ?? '',
      );
}

class OfflineQueue {
  static const _boxName = 'offline_scan_queue';
  static Box? _box;

  static Future<void> init() async {
    _box = await Hive.openBox(_boxName);
  }

  static Future<void> enqueue(OfflineScan scan) async {
    await _box?.add(scan.toJson());
    debugPrint('OfflineQueue: Enqueued scan for ${scan.qrToken}. Queue size: ${_box?.length}');
  }

  static List<OfflineScan> getAll() {
    if (_box == null) return [];
    return _box!.values
        .map((v) => OfflineScan.fromMap(Map.from(v as Map)))
        .toList();
  }

  static int get count => _box?.length ?? 0;

  static Future<void> clear() async {
    await _box?.clear();
  }

  static Future<void> removeAt(int index) async {
    await _box?.deleteAt(index);
  }
}
