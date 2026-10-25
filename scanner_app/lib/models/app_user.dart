import 'dart:convert';

enum UserRole { superadmin, organizer, staff, attendee, unknown }

class AppUser {
  final String id;
  final String email;
  final String firstName;
  final String lastName;
  final UserRole role;
  final String? organizationName;
  final String? phoneNumber;

  AppUser({
    required this.id,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.role,
    this.organizationName,
    this.phoneNumber,
  });

  String get fullName {
    final name = '$firstName $lastName'.trim();
    return name.isEmpty ? email.split('@').first : name;
  }

  bool get isSuperAdmin => role == UserRole.superadmin;
  bool get isAdmin => role == UserRole.organizer || isSuperAdmin;
  bool get isStaff => role == UserRole.staff;
  bool get canAccessAdmin => isAdmin;

  factory AppUser.fromJson(Map<String, dynamic> json) {
    UserRole role;
    switch (json['role']?.toString().toLowerCase()) {
      case 'superadmin':
        role = UserRole.superadmin;
        break;
      case 'organizer':
        role = UserRole.organizer;
        break;
      case 'staff':
        role = UserRole.staff;
        break;
      case 'attendee':
        role = UserRole.attendee;
        break;
      default:
        role = UserRole.unknown;
    }
    return AppUser(
      id: json['id']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      firstName: json['first_name']?.toString() ?? '',
      lastName: json['last_name']?.toString() ?? '',
      role: role,
      organizationName: json['organization_name']?.toString(),
      phoneNumber: json['phone']?.toString() ?? json['phone_number']?.toString(),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'first_name': firstName,
        'last_name': lastName,
        'role': role.name,
        'organization_name': organizationName,
        'phone_number': phoneNumber,
      };

  String toJsonString() => jsonEncode(toJson());

  factory AppUser.fromJsonString(String jsonStr) =>
      AppUser.fromJson(jsonDecode(jsonStr) as Map<String, dynamic>);
}
