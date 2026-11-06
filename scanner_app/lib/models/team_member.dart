/// A gate-staff account owned by the signed-in organizer
/// (`/api/auth/team/`).
class TeamMember {
  final String id;
  final String name;
  final String firstName;
  final String lastName;
  final String email;
  final String phone;
  final bool isActive;
  final String? dateJoined;
  final String? lastLogin;
  final List<TeamAssignment> assignments;

  const TeamMember({
    required this.id,
    required this.name,
    required this.firstName,
    required this.lastName,
    required this.email,
    required this.phone,
    required this.isActive,
    this.dateJoined,
    this.lastLogin,
    this.assignments = const [],
  });

  /// Best label for the member: full name, else the email.
  String get displayName {
    final n = name.trim().isNotEmpty ? name.trim() : '$firstName $lastName'.trim();
    return n.isNotEmpty ? n : email;
  }

  List<TeamAssignment> get activeAssignments => assignments.where((a) => a.isActive).toList();

  /// "Event · Gate" for each active assignment, or a hint when there are none.
  String get assignmentSummary {
    final active = activeAssignments;
    if (active.isEmpty) return 'Not assigned to a gate yet';
    return active.map((a) => a.label).join(', ');
  }

  factory TeamMember.fromJson(Map<String, dynamic> json) {
    final raw = json['assignments'];
    return TeamMember(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      firstName: json['first_name']?.toString() ?? '',
      lastName: json['last_name']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      isActive: json['is_active'] != false,
      dateJoined: json['date_joined']?.toString(),
      lastLogin: json['last_login']?.toString(),
      assignments: raw is List
          ? raw.whereType<Map>().map((a) => TeamAssignment.fromJson(Map<String, dynamic>.from(a))).toList()
          : const [],
    );
  }
}

class TeamAssignment {
  final String id;
  final String eventId;
  final String eventTitle;
  final String? gateId;
  final String gateName;
  final bool isActive;

  const TeamAssignment({
    required this.id,
    required this.eventId,
    required this.eventTitle,
    this.gateId,
    required this.gateName,
    required this.isActive,
  });

  String get label {
    final gate = gateName.trim().isEmpty ? 'Any gate' : gateName.trim();
    return eventTitle.trim().isEmpty ? gate : '${eventTitle.trim()} · $gate';
  }

  factory TeamAssignment.fromJson(Map<String, dynamic> json) => TeamAssignment(
        id: json['id']?.toString() ?? '',
        eventId: json['event_id']?.toString() ?? '',
        eventTitle: json['event_title']?.toString() ?? '',
        gateId: json['gate_id']?.toString(),
        gateName: json['gate_name']?.toString() ?? '',
        isActive: json['is_active'] != false,
      );
}
