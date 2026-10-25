class RecentScan {
  final String attendeeName;
  final String scanType;
  final String scannedAt;
  final String gateName;

  RecentScan({
    required this.attendeeName,
    required this.scanType,
    required this.scannedAt,
    required this.gateName,
  });

  factory RecentScan.fromJson(Map<String, dynamic> json) => RecentScan(
        attendeeName: json['attendee_name']?.toString() ?? 'Unknown Attendee',
        scanType: json['scan_type']?.toString() ?? 'gate_in',
        scannedAt: json['scanned_at']?.toString() ?? '',
        gateName: json['gate_name']?.toString() ?? 'Main Gate',
      );
}

class GateStatsModel {
  final int totalRegistered;
  final int checkedIn;
  final int checkedOut;
  final int capacity;
  final List<RecentScan> recentScans;

  const GateStatsModel({
    required this.totalRegistered,
    required this.checkedIn,
    required this.checkedOut,
    required this.capacity,
    required this.recentScans,
  });

  double get occupancyRate => capacity > 0 ? (checkedIn / capacity).clamp(0.0, 1.0) : 0.0;
  int get currentlyInside => (checkedIn - checkedOut).clamp(0, totalRegistered);

  factory GateStatsModel.fromJson(Map<String, dynamic> json) {
    final scans = (json['recent_scans'] as List? ?? [])
        .map((s) => RecentScan.fromJson(s as Map<String, dynamic>))
        .toList();

    final reg = (json['total_registered'] as int?) ?? 0;
    final inCount = (json['total_checked_in'] as int?) ?? (json['currently_inside'] as int?) ?? 0;
    final outCount = (json['total_checked_out'] as int?) ?? 0;
    final cap = (json['capacity'] as int?) ?? 0;

    return GateStatsModel(
      totalRegistered: reg,
      checkedIn: inCount,
      checkedOut: outCount,
      capacity: cap,
      recentScans: scans,
    );
  }

  factory GateStatsModel.empty() => const GateStatsModel(
        totalRegistered: 0,
        checkedIn: 0,
        checkedOut: 0,
        capacity: 0,
        recentScans: [],
      );
}
