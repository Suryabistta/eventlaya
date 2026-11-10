import '../../core/media_url.dart';
import '../../models/event_model.dart';
import '../../models/ticket_type_model.dart';
import '../../payments/payment_models.dart';

String? _str(Object? v) {
  final s = v?.toString().trim();
  return (s == null || s.isEmpty) ? null : s;
}

List<Map<String, dynamic>> _maps(Object? v) =>
    v is List ? [for (final x in v) if (x is Map) Map<String, dynamic>.from(x)] : const [];

/// Event categories (backend `Event.Category`).
class EventCategories {
  EventCategories._();
  static const labels = {
    'conference': 'Conference',
    'hackathon': 'Hackathon',
    'concert': 'Concert',
    'festival': 'Festival',
    'workshop': 'Workshop',
    'sports': 'Sports',
    'wedding': 'Wedding',
    'meetup': 'Meetup',
    'other': 'Other',
  };

  static String label(String? slug) => labels[slug] ?? 'Event';
}

/// An event type managed by the superadmin (`GET /api/platform/event-categories/`).
class EventType {
  final String slug;
  final String name;
  const EventType(this.slug, this.name);
}

/// A ticket type as attendees see it (`public_ticket_type` on the server),
/// optionally with promo pricing from `POST /public/<slug>/promo/`.
class PublicTicketType {
  final String id;
  final String name;
  final String description;
  final double price;

  /// Null = unlimited.
  final int? remaining;

  /// 'on_sale', 'not_started', 'ended', 'sold_out' or 'inactive'.
  final String availability;
  final String note;
  final double? discountedPrice;
  final bool promoApplies;
  final bool unlocked;

  /// Must be paid online (Khalti / eSewa), never at the venue.
  final bool onlineOnly;

  const PublicTicketType({
    required this.id,
    required this.name,
    this.description = '',
    this.price = 0,
    this.remaining,
    this.availability = 'on_sale',
    this.note = '',
    this.discountedPrice,
    this.promoApplies = false,
    this.unlocked = false,
    this.onlineOnly = false,
  });

  factory PublicTicketType.fromJson(Map<String, dynamic> j) => PublicTicketType(
        id: j['id']?.toString() ?? '',
        name: _str(j['name']) ?? 'Ticket',
        description: _str(j['description']) ?? '',
        price: parseMoney(j['price']),
        remaining: j['remaining'] == null ? null : int.tryParse(j['remaining'].toString()),
        availability: _str(j['availability']) ?? 'on_sale',
        note: _str(j['note']) ?? '',
        discountedPrice: j['discounted_price'] == null ? null : parseMoney(j['discounted_price']),
        promoApplies: j['promo_applies'] == true,
        unlocked: j['unlocked'] == true,
        onlineOnly: j['online_only'] == true,
      );

  bool get onSale => availability == 'on_sale';

  /// What the attendee pays at the venue, with the promo when it applies.
  double get due => promoApplies && discountedPrice != null ? discountedPrice! : price;

  String get priceLabel => due > 0 ? formatRupees(due) : 'Free';

  /// "Sold out", "Sales start soon", "12 left"… or null when nothing to say.
  String? get availabilityLabel => switch (availability) {
        'sold_out' => 'Sold out',
        'not_started' => 'Sales start soon',
        'ended' => 'Sales ended',
        'inactive' => 'Unavailable',
        _ => remaining != null && remaining! <= 20 ? '${remaining!} left' : null,
      };
}

class FaqItem {
  final String question;
  final String answer;
  const FaqItem(this.question, this.answer);
}

class AgendaItem {
  final String? day;
  final String? startTime;
  final String? endTime;
  final String title;
  final String description;
  final String location;
  const AgendaItem({this.day, this.startTime, this.endTime, required this.title, this.description = '', this.location = ''});
}

class Speaker {
  final String name;
  final String role;
  final String organization;
  final String? photoUrl;
  const Speaker({required this.name, this.role = '', this.organization = '', this.photoUrl});
}

/// An event from the public API (`/api/events/public/…`).
class PublicEvent {
  /// Shared model, used for phase / dates logic.
  final EventModel base;
  final String? tagline;
  final String? category;

  /// Registration only (`registration_mode: form`): free, one per person, no pass or check-in.
  final bool registrationOnly;

  /// Registrations must include a phone number (on unless the organizer turned it off).
  final bool phoneRequired;

  /// Applications stage on and tickets off (for now only an open call: film submissions, pageant applications).
  final bool isOpenCall;

  /// Applications are open right now (the Apply page is on the website).
  final bool applicationsOpen;
  final String applyLabel;

  /// Main button text chosen by the organizer (Apply, Submit entry...); null = automatic.
  final String? ctaLabel;

  /// Picked by the superadmin: listed first on Explore, with a badge.
  final bool isFeatured;

  /// Server display name of [category] ('' for none/other).
  final String? categoryName;

  /// Label for the category chip: the server's name, else the built-in one.
  String get categoryLabel => (categoryName?.isNotEmpty ?? false) ? categoryName! : EventCategories.label(category);
  final String? bannerUrl;
  final String organizerName;
  final String? organizerLogo;
  final bool organizerVerified;

  /// Main event (title, slug) when this is a sub-event.
  final (String, String)? parent;

  /// Published sub-events of a main event: (title, slug, date, registration open).
  final List<SubEventSummary> subEvents;
  final List<PublicTicketType> ticketTypes;
  final bool hasPromoCodes;
  /// Null when unlimited — or when the organizer hides the count
  /// ([spotsHidden]); use [fullyBooked] to know if any spots remain.
  final int? spotsLeft;

  /// The organizer hides how many spots / tickets are left: the server then
  /// sends no counts (capacity 0, spots_left and each type's remaining null).
  final bool spotsHidden;

  /// No spots left (sent even when counts are hidden).
  final bool isFull;
  final bool isPaid;
  final double ticketPrice;
  final List<String> highlights;
  final List<AgendaItem> agenda;
  final List<Speaker> speakers;
  final List<FaqItem> faqs;

  /// The event's own terms & conditions, as the organizer wrote them.
  final String? terms;

  /// Heading of the speakers section (Performers, Line-up...); null = Speakers.
  final String? speakersLabel;
  final String? contactEmail;
  final String? contactPhone;

  /// Most tickets one registration may include (set by the organizer).
  final int maxTicketsPerOrder;

  /// Pay online (Khalti / eSewa) and/or at the venue (detail endpoint only).
  final PaymentOptions paymentOptions;

  /// True when this came from the detail endpoint (ticket types etc. present).
  final bool detailed;

  const PublicEvent({
    required this.base,
    this.tagline,
    this.category,
    this.categoryName,
    this.registrationOnly = false,
    this.phoneRequired = true,
    this.isOpenCall = false,
    this.applicationsOpen = false,
    this.applyLabel = 'Apply',
    this.ctaLabel,
    this.isFeatured = false,
    this.bannerUrl,
    this.organizerName = '',
    this.organizerLogo,
    this.organizerVerified = false,
    this.parent,
    this.subEvents = const [],
    this.ticketTypes = const [],
    this.hasPromoCodes = false,
    this.spotsLeft,
    this.spotsHidden = false,
    this.isFull = false,
    this.isPaid = false,
    this.ticketPrice = 0,
    this.highlights = const [],
    this.agenda = const [],
    this.speakers = const [],
    this.faqs = const [],
    this.terms,
    this.speakersLabel,
    this.contactEmail,
    this.contactPhone,
    this.maxTicketsPerOrder = 10,
    this.detailed = false,
    this.paymentOptions = PaymentOptions.venueOnly,
  });

  factory PublicEvent.fromJson(Map<String, dynamic> j, {bool detailed = false}) {
    final org = j['organizer_info'] is Map ? Map<String, dynamic>.from(j['organizer_info'] as Map) : null;
    return PublicEvent(
      base: EventModel.fromJson(j),
      tagline: _str(j['tagline']),
      category: _str(j['category']),
      categoryName: _str(j['category_name']),
      registrationOnly: j['registration_mode'] == 'form',
      phoneRequired: j['phone_required'] != false,
      isOpenCall: j['applications_enabled'] == true && j['tickets_enabled'] == false,
      applicationsOpen: j['applications'] is Map ? (j['applications'] as Map)['open'] == true : false,
      applyLabel: j['applications'] is Map ? _str((j['applications'] as Map)['cta']) ?? 'Apply' : (_str(j['application_cta']) ?? 'Apply'),
      ctaLabel: _str(j['cta_label']),
      isFeatured: j['is_featured'] == true,
      bannerUrl: mediaUrl(_str(j['banner']) ?? j['banner_absolute']),
      organizerName: _str(org?['name']) ?? _str(j['organizer_name']) ?? '',
      organizerLogo: mediaUrl(org?['logo']),
      organizerVerified: org?['verified'] == true || j['organizer_verified'] == true,
      parent: j['parent'] is Map ? (j['parent']['title'].toString(), j['parent']['slug'].toString()) : null,
      subEvents: [for (final s in _maps(j['sub_events'])) SubEventSummary.fromJson(s)],
      ticketTypes: [for (final t in _maps(j['ticket_types'])) PublicTicketType.fromJson(t)],
      hasPromoCodes: j['has_promo_codes'] == true,
      spotsLeft: j['spots_left'] == null ? null : int.tryParse(j['spots_left'].toString()),
      spotsHidden: j['spots_hidden'] == true,
      isFull: j['is_full'] == true,
      isPaid: j['is_paid'] == true,
      ticketPrice: parseMoney(j['ticket_price']),
      highlights: [
        if (j['highlights'] is List)
          for (final h in j['highlights'] as List)
            if (_str(h) != null) _str(h)!,
      ],
      agenda: [
        for (final a in _maps(j['agenda']))
          AgendaItem(
            day: _str(a['day']),
            startTime: _str(a['start_time']),
            endTime: _str(a['end_time']),
            title: _str(a['title']) ?? '',
            description: _str(a['description']) ?? '',
            location: _str(a['location']) ?? '',
          ),
      ],
      speakers: [
        for (final s in _maps(j['speakers']))
          Speaker(
            name: _str(s['name']) ?? '',
            role: _str(s['role']) ?? '',
            organization: _str(s['organization']) ?? '',
            photoUrl: mediaUrl(s['photo_url']),
          ),
      ],
      faqs: [
        for (final f in _maps(j['faqs'])) FaqItem(_str(f['question']) ?? '', _str(f['answer']) ?? ''),
      ],
      terms: _str(j['terms']),
      speakersLabel: _str(j['speakers_label']),
      contactEmail: _str(j['contact_email']),
      contactPhone: _str(j['contact_phone']),
      maxTicketsPerOrder: (int.tryParse(j['max_tickets_per_order']?.toString() ?? '') ?? 10).clamp(1, 50),
      detailed: detailed,
      paymentOptions: j['payment_options'] is Map
          ? PaymentOptions.fromJson(Map<String, dynamic>.from(j['payment_options'] as Map))
          : PaymentOptions.venueOnly,
    );
  }

  String get slug => base.slug;
  String get title => base.title;
  String get venue => base.venue;
  String? get description => base.description;
  EventPhase get phase => base.phase;
  bool get isLive => phase == EventPhase.live;
  bool get registrationOpen => base.registrationOpen;

  /// No spots left, whether or not the count is shown.
  bool get fullyBooked => isFull || spotsLeft == 0;

  /// "12 spots left" when the organizer shows it, else null. Never shows a
  /// hidden count (capacity 0 then means "hidden", not "unlimited").
  String? get spotsLeftLabel => spotsHidden || spotsLeft == null || spotsLeft == 0
      ? null
      : '$spotsLeft spot${spotsLeft == 1 ? '' : 's'} left';
  String? get registrationClosedReason => base.registrationClosedReason;

  /// Cheapest on-sale price, for list cards: "Free", "Rs 500", "From Rs 300".
  /// What to show as the price: registration-only events read "Free · Registration".
  String get priceLabel => isOpenCall ? 'Free · Open call' : registrationOnly ? 'Free · Registration' : priceSummary;

  String get priceSummary {
    final onSale = ticketTypes.where((t) => t.onSale).toList();
    if (onSale.isEmpty) {
      if (!detailed) return isPaid && ticketPrice > 0 ? formatRupees(ticketPrice) : 'Free';
      return ticketTypes.isEmpty ? 'Free' : 'Sold out';
    }
    final prices = onSale.map((t) => t.price).toList()..sort();
    if (prices.first == 0 && prices.last == 0) return 'Free';
    if (prices.first == prices.last) return formatRupees(prices.first);
    return prices.first == 0 ? 'Free & paid' : 'From ${formatRupees(prices.first)}';
  }
}

/// One field of the event's dynamic registration form.
class FormFieldSpec {
  final String id;
  final String type;
  final String label;
  final String placeholder;
  final String helpText;
  final bool required;
  final List<String> options;

  const FormFieldSpec({
    required this.id,
    required this.type,
    required this.label,
    this.placeholder = '',
    this.helpText = '',
    this.required = false,
    this.options = const [],
  });

  factory FormFieldSpec.fromJson(Map<String, dynamic> j) => FormFieldSpec(
        id: j['id']?.toString() ?? '',
        type: _str(j['field_type']) ?? 'text',
        label: _str(j['label']) ?? 'Question',
        placeholder: _str(j['placeholder']) ?? '',
        helpText: _str(j['help_text']) ?? '',
        required: j['required'] == true,
        options: [
          if (j['options'] is List)
            for (final o in j['options'] as List)
              if (o is Map ? _str(o['label'] ?? o['value']) != null : _str(o) != null)
                o is Map ? _str(o['label'] ?? o['value'])! : _str(o)!,
        ],
      );

  /// Forms often repeat the name / email / phone we already ask for (same
  /// detection as the web registration page), so they're asked once.
  String? get builtin {
    final l = label.trim().toLowerCase();
    if (type == 'email' || RegExp(r'e-?mail').hasMatch(l)) return 'email';
    if (type == 'phone' || RegExp(r'phone|mobile').hasMatch(l)) return 'phone';
    if (RegExp(r'full name|^name$|^your name$').hasMatch(l)) return 'name';
    return null;
  }

  /// A single required tick box ("I agree to the terms").
  bool get isConsent => type == 'checkbox' && options.isEmpty;

  /// Photo or file questions (the app can't upload yet, so it sends people to the website).
  bool get isFileUpload => type == 'file_upload' || type == 'image';
}

class FormSchema {
  final String title;
  final String description;
  final List<FormFieldSpec> fields;
  const FormSchema({this.title = '', this.description = '', this.fields = const []});

  factory FormSchema.fromJson(Map<String, dynamic> j) => FormSchema(
        title: _str(j['title']) ?? '',
        description: _str(j['description']) ?? '',
        fields: [for (final f in _maps(j['fields'])) FormFieldSpec.fromJson(f)],
      );
}

/// `GET /api/events/public/<slug>/`.
class EventDetail {
  final PublicEvent event;
  final FormSchema? form;
  const EventDetail(this.event, this.form);
}

/// `POST /api/events/public/<slug>/promo/`.
class PromoResult {
  final String code;
  final String label;
  final List<PublicTicketType> ticketTypes;
  const PromoResult({required this.code, required this.label, required this.ticketTypes});
}

/// One sub-event card on a main event's page (module `sub_events`).
class SubEventSummary {
  final String title;
  final String slug;
  final String? startDate;
  final String location;
  final bool registrationOpen;

  const SubEventSummary({required this.title, required this.slug, this.startDate, this.location = '', this.registrationOpen = false});

  factory SubEventSummary.fromJson(Map<String, dynamic> j) => SubEventSummary(
        title: _str(j['title']) ?? 'Sub-event',
        slug: _str(j['slug']) ?? '',
        startDate: _str(j['start_date']),
        location: _str(j['location']) ?? '',
        registrationOpen: j['registration_open'] == true,
      );
}
