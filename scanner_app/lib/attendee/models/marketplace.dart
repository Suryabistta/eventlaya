import '../../core/media_url.dart';
import '../../models/ticket_type_model.dart';

String? _s(Object? v) {
  final t = v?.toString().trim();
  return (t == null || t.isEmpty) ? null : t;
}

List<String> _strings(Object? v) => [
      if (v is List)
        for (final x in v)
          if (_s(x is Map ? (x['url'] ?? x['name'] ?? x['label']) : x) != null)
            _s(x is Map ? (x['url'] ?? x['name'] ?? x['label']) : x)!,
    ];

List<String> _images(Object? v) => [for (final s in _strings(v)) if (mediaUrl(s) != null) mediaUrl(s)!];

/// The cover photo (`featured_image`) first, then the other photos without repeating it.
List<String> _withCover(Object? cover, List<String> images) {
  final c = mediaUrl(cover?.toString().trim().isEmpty ?? true ? null : cover.toString());
  return c == null ? images : [c, ...images.where((i) => i != c)];
}

int? _int(Object? v) => v == null ? null : int.tryParse(v.toString());

class VendorCategory {
  final String id;
  final String name;
  final String slug;
  final String icon;
  final int vendorsCount;
  const VendorCategory({required this.id, required this.name, required this.slug, this.icon = '', this.vendorsCount = 0});

  factory VendorCategory.fromJson(Map<String, dynamic> j) => VendorCategory(
        id: j['id']?.toString() ?? '',
        name: _s(j['name']) ?? 'Category',
        slug: _s(j['slug']) ?? '',
        icon: _s(j['icon']) ?? '',
        vendorsCount: _int(j['vendors_count']) ?? 0,
      );
}

/// A marketplace vendor (sound, photo, catering…).
class Vendor {
  final String id;
  final String businessName;
  final String categoryName;
  final String categorySlug;
  final String city;
  final String address;
  final String phone;
  final String email;
  final String description;
  final double startingPrice;
  final List<String> images;
  final bool isVerified;
  final bool isFeatured;

  /// Average of real reviews when there are any, else the platform-set value.
  final double? rating;

  /// Number of visible reviews (`review_total`).
  final int reviewTotal;

  const Vendor({
    required this.id,
    required this.businessName,
    this.categoryName = '',
    this.categorySlug = '',
    this.city = '',
    this.address = '',
    this.phone = '',
    this.email = '',
    this.description = '',
    this.startingPrice = 0,
    this.images = const [],
    this.isVerified = false,
    this.isFeatured = false,
    this.rating,
    this.reviewTotal = 0,
  });

  factory Vendor.fromJson(Map<String, dynamic> j) => Vendor(
        id: j['id']?.toString() ?? '',
        businessName: _s(j['business_name']) ?? 'Vendor',
        categoryName: _s(j['category_name']) ?? '',
        categorySlug: _s(j['category_slug']) ?? '',
        city: _s(j['city']) ?? '',
        address: _s(j['address']) ?? '',
        phone: _s(j['phone']) ?? '',
        email: _s(j['email']) ?? '',
        description: _s(j['description']) ?? '',
        startingPrice: parseMoney(j['starting_price']),
        images: _withCover(j['featured_image'], _images(j['portfolio_images'])),
        isVerified: j['is_verified'] == true,
        isFeatured: j['is_featured'] == true,
        rating: j['rating'] == null ? null : parseMoney(j['rating']),
        reviewTotal: _int(j['review_total']) ?? 0,
      );
}

class VenueSpace {
  final String id;
  final String name;
  final String typeLabel;
  final int seated;
  final int? standing;
  final double pricePerDay;
  final int? areaSqft;
  final List<String> amenities;
  final String description;

  const VenueSpace({
    required this.id,
    required this.name,
    this.typeLabel = '',
    this.seated = 0,
    this.standing,
    this.pricePerDay = 0,
    this.areaSqft,
    this.amenities = const [],
    this.description = '',
  });

  factory VenueSpace.fromJson(Map<String, dynamic> j) => VenueSpace(
        id: j['id']?.toString() ?? '',
        name: _s(j['name']) ?? 'Space',
        typeLabel: _s(j['space_type_display']) ?? '',
        seated: _int(j['capacity_seated']) ?? 0,
        standing: _int(j['capacity_standing']),
        pricePerDay: parseMoney(j['price_per_day']),
        areaSqft: _int(j['area_sqft']),
        amenities: _strings(j['amenities']),
        description: _s(j['description']) ?? '',
      );

  String get capacityLabel => [
        if (seated > 0) '$seated seated',
        if (standing != null && standing! > 0) '$standing standing',
      ].join(' · ');
}

/// A marketplace venue (party palace, hall, resort…).
class Venue {
  final String id;
  final String name;
  final String slug;
  final String venueType;
  final String typeLabel;
  final String city;
  final String address;
  final int capacityMin;
  final int capacityMax;
  final double priceFrom;
  final List<String> amenities;
  final List<String> images;
  final String contactPerson;
  final String contactPhone;
  final String contactEmail;
  final String description;
  final String rules;
  final bool isVerified;
  final bool isFeatured;
  final double? rating;
  final int reviewCount;
  final List<VenueSpace> spaces;

  const Venue({
    required this.id,
    required this.name,
    this.slug = '',
    this.venueType = '',
    this.typeLabel = '',
    this.city = '',
    this.address = '',
    this.capacityMin = 0,
    this.capacityMax = 0,
    this.priceFrom = 0,
    this.amenities = const [],
    this.images = const [],
    this.contactPerson = '',
    this.contactPhone = '',
    this.contactEmail = '',
    this.description = '',
    this.rules = '',
    this.isVerified = false,
    this.isFeatured = false,
    this.rating,
    this.reviewCount = 0,
    this.spaces = const [],
  });

  factory Venue.fromJson(Map<String, dynamic> j) => Venue(
        id: j['id']?.toString() ?? '',
        name: _s(j['name']) ?? 'Venue',
        slug: _s(j['slug']) ?? '',
        venueType: _s(j['venue_type']) ?? '',
        typeLabel: _s(j['venue_type_display']) ?? '',
        city: _s(j['city']) ?? '',
        address: _s(j['address']) ?? '',
        capacityMin: _int(j['capacity_min']) ?? 0,
        capacityMax: _int(j['capacity_max']) ?? 0,
        priceFrom: parseMoney(j['price_from'] ?? j['price_per_day']),
        amenities: _strings(j['amenities']),
        images: _withCover(j['featured_image'], _images(j['images'])),
        contactPerson: _s(j['contact_person']) ?? '',
        contactPhone: _s(j['contact_phone']) ?? '',
        contactEmail: _s(j['contact_email']) ?? '',
        description: _s(j['description']) ?? '',
        rules: _s(j['rules_policy']) ?? '',
        isVerified: j['is_verified'] == true,
        isFeatured: j['is_featured'] == true,
        rating: j['rating'] == null ? null : parseMoney(j['rating']),
        reviewCount: _int(j['review_total']) ?? _int(j['review_count']) ?? 0,
        spaces: [
          if (j['spaces'] is List)
            for (final s in j['spaces'] as List)
              if (s is Map) VenueSpace.fromJson(Map<String, dynamic>.from(s)),
        ],
      );

  String get capacityLabel {
    if (capacityMax <= 0) return '';
    if (capacityMin > 0 && capacityMin < capacityMax) return '$capacityMin–$capacityMax guests';
    return 'Up to $capacityMax guests';
  }

  /// Venue types (backend `VenueListing.VenueType`) for the filter pills.
  static const types = {
    'banquet': 'Banquet & party palace',
    'resort': 'Resort & lawn',
    'auditorium': 'Auditorium / hall',
    'hotel': 'Hotel ballroom',
    'open_ground': 'Open ground',
    'community': 'Community center',
  };
}


/// A priced package a vendor or venue offers (module `packages`).
class ServicePackage {
  final String id;
  final String name;
  final double price;
  final String priceUnitLabel;
  final String description;
  final List<String> inclusions;
  final int? maxGuests;
  final String? imageUrl;

  const ServicePackage({
    required this.id,
    required this.name,
    required this.price,
    this.priceUnitLabel = '',
    this.description = '',
    this.inclusions = const [],
    this.maxGuests,
    this.imageUrl,
  });

  factory ServicePackage.fromJson(Map<String, dynamic> j) => ServicePackage(
        id: j['id']?.toString() ?? '',
        name: _s(j['name']) ?? 'Package',
        price: parseMoney(j['price']),
        priceUnitLabel: _s(j['price_unit_display']) ?? '',
        description: _s(j['description']) ?? '',
        inclusions: _strings(j['inclusions']),
        maxGuests: _int(j['max_guests']),
        imageUrl: mediaUrl(_s(j['image'])),
      );
}
