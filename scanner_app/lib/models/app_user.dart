import 'dart:convert';

enum UserRole { superadmin, organizer, staff, attendee, vendor, unknown }

class AppUser {
  final String id;
  final String email;
  final String firstName;
  final String lastName;
  final UserRole role;
  final String? organizationName;
  final String? phoneNumber;
  final String? city;

  /// Path or URL of the profile photo, if any.
  final String? avatar;
  final bool emailVerified;

  /// False for Google/Facebook-only accounts that never set a password.
  final bool hasPassword;
  final List<String> socialProviders;

  /// Organizer marketplace access: `none`, `pending` or `approved`.
  final String marketplaceAccess;

  AppUser({
    required this.id,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.role,
    this.organizationName,
    this.phoneNumber,
    this.city,
    this.avatar,
    this.emailVerified = true,
    this.hasPassword = true,
    this.socialProviders = const [],
    this.marketplaceAccess = 'none',
  });

  String get fullName {
    final name = '$firstName $lastName'.trim();
    return name.isEmpty ? email.split('@').first : name;
  }

  bool get isSuperAdmin => role == UserRole.superadmin;
  bool get isAdmin => role == UserRole.organizer || isSuperAdmin;
  bool get isStaff => role == UserRole.staff;

  /// Marketplace business account (venue owner / service vendor).
  bool get isVendor => role == UserRole.vendor;

  /// Owns marketplace listings: vendors, and organizers with approved access.
  bool get hasBusinessPortal => isVendor || marketplaceAccess == 'approved';
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
      case 'vendor':
        role = UserRole.vendor;
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
      city: json['city']?.toString(),
      avatar: (json['avatar']?.toString().isEmpty ?? true) ? null : json['avatar'].toString(),
      // Older servers don't send these: assume verified / password accounts.
      emailVerified: json['email_verified'] != false,
      hasPassword: json['has_password'] != false,
      socialProviders: [
        if (json['social_providers'] is List)
          for (final p in json['social_providers'] as List) p.toString(),
      ],
      marketplaceAccess: json['marketplace_access']?.toString() ?? 'none',
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
        'city': city,
        'avatar': avatar,
        'email_verified': emailVerified,
        'has_password': hasPassword,
        'social_providers': socialProviders,
        'marketplace_access': marketplaceAccess,
      };

  String toJsonString() => jsonEncode(toJson());

  factory AppUser.fromJsonString(String jsonStr) =>
      AppUser.fromJson(jsonDecode(jsonStr) as Map<String, dynamic>);
}
