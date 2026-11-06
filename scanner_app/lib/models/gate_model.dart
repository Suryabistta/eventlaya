/// A gate (entrance/exit) configured by the organizer for an event.
class GateModel {
  final String id;
  final String name;

  /// 'entry', 'exit' or 'both'.
  final String kind;
  final bool isVip;
  final bool isActive;
  final int order;

  /// Staff assigned to this gate (organizer view only), as raw assignment maps.
  final List<Map<String, dynamic>> staff;
  final int scansInToday;
  final int scansOutToday;

  const GateModel({
    required this.id,
    required this.name,
    this.kind = 'both',
    this.isVip = false,
    this.isActive = true,
    this.order = 0,
    this.staff = const [],
    this.scansInToday = 0,
    this.scansOutToday = 0,
  });

  static int _int(Object? v) => v is int ? v : int.tryParse('$v') ?? 0;

  factory GateModel.fromJson(Map<String, dynamic> json) => GateModel(
        id: json['id']?.toString() ?? '',
        name: json['name']?.toString() ?? 'Gate',
        kind: switch (json['kind']?.toString()) {
          'entry' => 'entry',
          'exit' => 'exit',
          _ => 'both',
        },
        isVip: json['is_vip'] == true,
        isActive: json['is_active'] != false,
        order: _int(json['order']),
        staff: (json['staff'] is List)
            ? (json['staff'] as List).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList()
            : const [],
        scansInToday: _int(json['scans_in_today'] ?? json['today_in']),
        scansOutToday: _int(json['scans_out_today'] ?? json['today_out']),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'kind': kind,
        'is_vip': isVip,
        'is_active': isActive,
        'order': order,
      };

  bool get allowsEntry => kind != 'exit';
  bool get allowsExit => kind != 'entry';

  /// Whether this gate accepts [scanType] ('gate_in' / 'gate_out').
  bool allows(String scanType) => scanType == 'gate_out' ? allowsExit : allowsEntry;

  String get kindLabel => switch (kind) {
        'entry' => 'Entry only',
        'exit' => 'Exit only',
        _ => 'Entry and exit',
      };

  @override
  bool operator ==(Object other) => other is GateModel && other.id == id && other.name == name;

  @override
  int get hashCode => Object.hash(id, name);
}
