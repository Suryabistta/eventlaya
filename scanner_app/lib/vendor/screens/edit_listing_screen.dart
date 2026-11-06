import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../ui/ui.dart';
import '../data/vendor_api.dart';
import '../data/vendor_models.dart';
import '../providers/vendor_providers.dart';
import '../widgets/vendor_widgets.dart';

/// Cities offered on the website's listing forms.
const _cities = ['Dharan', 'Itahari', 'Biratnagar', 'Damak', 'Kathmandu'];

const _venueTypes = [
  ('banquet', 'Banquet hall'),
  ('auditorium', 'Auditorium'),
  ('resort', 'Resort and lawn'),
  ('hotel', 'Hotel ballroom'),
  ('open_ground', 'Open ground'),
  ('community', 'Community hall'),
];

Future<void> openEditListing(BuildContext context, OwnerListing listing) =>
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => EditListingScreen(listing: listing)));

/// Edit a venue listing / service profile: the text, number and choice fields
/// the owner API accepts (`PATCH venues/<id>/`, `vendors/<id>/`). Photos and
/// venue spaces are edited on the website. Only changed fields are sent, so
/// saving without changes never sends a "changes needed" listing back for review.
class EditListingScreen extends ConsumerStatefulWidget {
  final OwnerListing listing;
  const EditListingScreen({super.key, required this.listing});

  @override
  ConsumerState<EditListingScreen> createState() => _EditListingScreenState();
}

class _EditListingScreenState extends ConsumerState<EditListingScreen> {
  final _formKey = GlobalKey<FormState>();
  final _text = <String, TextEditingController>{};
  final _choice = <String, String>{};
  late final Map<String, Object?> _initial;
  List<({String id, String name})>? _categories;
  bool _busy = false;

  bool get _isVenue => widget.listing.kind == ListingKind.venue;
  Map<String, dynamic> get _json => widget.listing.json;

  /// With active spaces the API derives the capacity range from them.
  bool get _hasActiveSpaces => widget.listing.spaces.any((s) => s.isActive);

  static String _str(Object? v) => v?.toString() ?? '';

  /// "25000.00" → "25000".
  static String _num(Object? v) {
    final d = double.tryParse(_str(v));
    if (d == null) return '';
    return d == d.roundToDouble() ? d.toInt().toString() : d.toString();
  }

  List<String> get _textFields => _isVenue
      ? [
          'name',
          'address',
          'description',
          'rules_policy',
          if (!_hasActiveSpaces) ...['capacity_min', 'capacity_max'],
          'price_per_day',
          'amenities',
          'contact_person',
          'contact_phone',
          'contact_email',
        ]
      : ['business_name', 'address', 'description', 'starting_price', 'phone', 'email'];

  @override
  void initState() {
    super.initState();
    for (final f in _textFields) {
      final v = _json[f];
      final text = switch (f) {
        'price_per_day' || 'starting_price' => _num(v),
        'amenities' => v is List ? v.join(', ') : '',
        _ => _str(v),
      };
      _text[f] = TextEditingController(text: text);
    }
    _choice['city'] = _str(_json['city']);
    if (_isVenue) {
      _choice['venue_type'] = _str(_json['venue_type']);
    } else {
      _choice['category'] = _str(_json['category']);
      ref.read(vendorApiProvider).vendorCategories().then((c) {
        if (mounted) setState(() => _categories = c);
      }).catchError((Object _) {
        if (mounted) setState(() => _categories = const []);
      });
    }
    _initial = _values();
  }

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// The form as API values.
  Map<String, Object?> _values() => {
        for (final e in _text.entries)
          e.key: switch (e.key) {
            'amenities' => [
                for (final a in e.value.text.split(','))
                  if (a.trim().isNotEmpty) a.trim(),
              ],
            'capacity_min' || 'capacity_max' => int.tryParse(e.value.text.trim()),
            _ => e.value.text.trim(),
          },
        ..._choice,
      };

  static bool _same(Object? a, Object? b) =>
      a is List && b is List ? a.length == b.length && a.indexed.every((x) => x.$2 == b[x.$1]) : a == b;

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    final now = _values();
    final changes = {
      for (final e in now.entries)
        if (!_same(e.value, _initial[e.key])) e.key: e.value,
    };
    if (changes.isEmpty) {
      Navigator.of(context).pop();
      return;
    }
    setState(() => _busy = true);
    try {
      final saved = await ref.read(vendorApiProvider).updateListing(widget.listing, changes);
      ref.invalidate(myListingsProvider);
      if (!mounted) return;
      final resubmitted =
          widget.listing.status == ListingStatus.rejected && saved['listing_status'] == ListingStatus.pending;
      AppToast.success(context, resubmitted ? 'Saved and sent back for review' : 'Changes saved');
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) AppToast.error(context, vendorErrorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pick(String field, String title, List<(String, String)> options) async {
    final picked = await showAppSheet<String>(
      context,
      builder: (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          SheetHeader(title: title),
          for (final (value, label) in options)
            SheetAction(
              icon: _choice[field] == value ? Icons.radio_button_checked_rounded : Icons.radio_button_unchecked_rounded,
              label: label,
              selected: _choice[field] == value,
              onTap: () => Navigator.pop(ctx, value),
            ),
        ],
      ),
    );
    if (picked != null && mounted) setState(() => _choice[field] = picked);
  }

  String? _required(String? v, String what) => (v ?? '').trim().isEmpty ? 'Enter $what' : null;

  String? _number(String? v, {bool required = false}) {
    final t = (v ?? '').trim();
    if (t.isEmpty) return required ? 'Enter a number' : null;
    final n = double.tryParse(t);
    return n == null || n < 0 ? 'Enter a number (0 or more)' : null;
  }

  String? _email(String? v) {
    final t = (v ?? '').trim();
    if (t.isEmpty) return null;
    return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(t) ? null : 'Enter a valid email';
  }

  Widget _field(
    String key,
    String label, {
    IconData? icon,
    String? hint,
    int maxLines = 1,
    TextInputType? keyboard,
    FormFieldValidator<String>? validator,
    TextCapitalization caps = TextCapitalization.sentences,
  }) =>
      FieldRow(
        controller: _text[key]!,
        label: label,
        hint: hint,
        icon: icon,
        maxLines: maxLines,
        keyboardType: keyboard ?? (maxLines > 1 ? TextInputType.multiline : null),
        textCapitalization: caps,
        validator: validator,
      );

  Widget _choiceRow(String field, String title, IconData icon, List<(String, String)> options) {
    final current = options.where((o) => o.$1 == _choice[field]).firstOrNull?.$2 ?? _choice[field] ?? '';
    return ListRow(
      leading: _RowIcon(icon),
      title: title,
      value: current.isEmpty ? 'Choose' : current,
      chevron: true,
      onTap: options.isEmpty ? null : () => _pick(field, title, options),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = widget.listing;
    final cities = [
      for (final c in {..._cities, if ((_choice['city'] ?? '').isNotEmpty) _choice['city']!}) (c, c),
    ];
    final capacityError = _isVenue && !_hasActiveSpaces
        ? () {
            final min = int.tryParse(_text['capacity_min']!.text.trim());
            final max = int.tryParse(_text['capacity_max']!.text.trim());
            return min != null && max != null && max < min ? 'Maximum guests must be at least the minimum' : null;
          }
        : null;

    return AppScaffold(
      title: _isVenue ? 'Edit venue' : 'Edit service',
      bottomBar: PrimaryButton(label: 'Save changes', loading: _busy, onPressed: _busy ? null : _save),
      slivers: [
        SliverToBoxAdapter(
          child: Form(
            key: _formKey,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (l.status == ListingStatus.rejected)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: AppColors.dangerTint, borderRadius: BorderRadius.circular(12)),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('Changes requested',
                          style: AppType.body(13, weight: FontWeight.w600, color: AppColors.danger)),
                      if (l.reviewNote != null) ...[
                        const SizedBox(height: 2),
                        Text(l.reviewNote!, style: AppType.body(13, color: AppColors.ink800)),
                      ],
                      const SizedBox(height: 4),
                      Text('Saving your changes sends the listing back for review.',
                          style: AppType.body(12.5, color: AppColors.ink600)),
                    ]),
                  ),
                ),
              if (_isVenue) ...[
                GroupedSection(
                  header: 'About the venue',
                  separatorInset: 50,
                  children: [
                    _field('name', 'Venue name',
                        icon: Icons.location_city_rounded,
                        caps: TextCapitalization.words,
                        validator: (v) => _required(v, 'the venue name')),
                    _choiceRow('venue_type', 'Type', Icons.category_outlined, _venueTypes),
                    _field('description', 'Description',
                        icon: Icons.notes_rounded, maxLines: 6, validator: (v) => _required(v, 'a description')),
                    _field('rules_policy', 'House rules (optional)',
                        icon: Icons.rule_rounded,
                        hint: 'Music cut-off, outside catering, advance payment',
                        maxLines: 4),
                  ],
                ),
                GroupedSection(
                  header: 'Location',
                  separatorInset: 50,
                  children: [
                    _choiceRow('city', 'City', Icons.place_outlined, cities),
                    _field('address', 'Address',
                        icon: Icons.signpost_outlined, validator: (v) => _required(v, 'the address')),
                  ],
                ),
                GroupedSection(
                  header: 'Capacity and price',
                  footer: _hasActiveSpaces
                      ? 'Guest capacity comes from your spaces. Change spaces on eventlaya.com.'
                      : null,
                  separatorInset: 50,
                  children: [
                    if (!_hasActiveSpaces) ...[
                      _field('capacity_min', 'Minimum guests',
                          icon: Icons.group_outlined,
                          keyboard: TextInputType.number,
                          validator: (v) => _number(v, required: true)),
                      _field('capacity_max', 'Maximum guests',
                          icon: Icons.groups_outlined,
                          keyboard: TextInputType.number,
                          validator: (v) => _number(v, required: true) ?? capacityError?.call()),
                    ],
                    _field('price_per_day', 'Price per day (Rs)',
                        icon: Icons.payments_outlined,
                        keyboard: const TextInputType.numberWithOptions(decimal: true),
                        validator: (v) => _number(v, required: true)),
                    _field('amenities', 'Amenities',
                        icon: Icons.check_circle_outline_rounded, hint: 'Parking, Power backup, Stage', maxLines: 3),
                  ],
                ),
                GroupedSection(
                  header: 'Contact',
                  separatorInset: 50,
                  children: [
                    _field('contact_person', 'Contact person',
                        icon: Icons.person_outline_rounded,
                        caps: TextCapitalization.words,
                        validator: (v) => _required(v, 'a contact person')),
                    _field('contact_phone', 'Phone',
                        icon: Icons.phone_outlined,
                        keyboard: TextInputType.phone,
                        validator: (v) => _required(v, 'a phone number')),
                    _field('contact_email', 'Email (optional)',
                        icon: Icons.mail_outline_rounded,
                        keyboard: TextInputType.emailAddress,
                        caps: TextCapitalization.none,
                        validator: _email),
                  ],
                ),
              ] else ...[
                GroupedSection(
                  header: 'About the service',
                  separatorInset: 50,
                  children: [
                    _field('business_name', 'Business name',
                        icon: Icons.storefront_rounded,
                        caps: TextCapitalization.words,
                        validator: (v) => _required(v, 'the business name')),
                    _choiceRow('category', 'Category', Icons.category_outlined, [
                      for (final c in _categories ?? const <({String id, String name})>[]) (c.id, c.name),
                    ]),
                    _field('description', 'Description',
                        icon: Icons.notes_rounded, maxLines: 6, validator: (v) => _required(v, 'a description')),
                    _field('starting_price', 'Starting price (Rs)',
                        icon: Icons.payments_outlined,
                        keyboard: const TextInputType.numberWithOptions(decimal: true),
                        validator: _number),
                  ],
                ),
                GroupedSection(
                  header: 'Contact and location',
                  separatorInset: 50,
                  children: [
                    _choiceRow('city', 'City', Icons.place_outlined, cities),
                    _field('address', 'Address (optional)', icon: Icons.signpost_outlined),
                    _field('phone', 'Phone',
                        icon: Icons.phone_outlined,
                        keyboard: TextInputType.phone,
                        validator: (v) => _required(v, 'a phone number')),
                    _field('email', 'Email (optional)',
                        icon: Icons.mail_outline_rounded,
                        keyboard: TextInputType.emailAddress,
                        caps: TextCapitalization.none,
                        validator: _email),
                  ],
                ),
              ],
              GroupedSection(
                footer: 'Photos${_isVenue ? ' and spaces' : ''} are changed on eventlaya.com (Business → Listings).',
                children: [
                  ListRow(
                    leading: const _RowIcon(Icons.photo_library_outlined),
                    title: 'Change photos on the website',
                    trailing: const Icon(Icons.copy_rounded, size: 18, color: AppColors.ink400),
                    onTap: () => copyText(context, l.editUrl, 'Edit link'),
                  ),
                ],
              ),
            ]),
          ),
        ),
      ],
    );
  }
}

/// Leading icon for choice rows, lined up with the [FieldRow] icons and labels.
class _RowIcon extends StatelessWidget {
  final IconData icon;
  const _RowIcon(this.icon);

  @override
  Widget build(BuildContext context) => SizedBox(
        width: 26,
        child: Align(alignment: Alignment.centerRight, child: Icon(icon, size: 20, color: AppColors.ink500)),
      );
}
