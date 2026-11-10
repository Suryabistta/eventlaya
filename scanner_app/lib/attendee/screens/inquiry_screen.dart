import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/auth_provider.dart';
import '../../providers/modules_provider.dart';
import '../../ui/ui.dart';
import '../data/attendee_api.dart';
import '../models/marketplace.dart';
import '../providers/explore_providers.dart';
import '../../core/bs_date.dart';

/// "Send inquiry" to a venue or a vendor (public endpoints, work signed
/// out; signed-in users see them later in My inquiries).
class InquiryScreen extends ConsumerStatefulWidget {
  final Venue? venue;
  final VenueSpace? space;
  final Vendor? vendor;
  const InquiryScreen({super.key, required Venue this.venue, this.space}) : vendor = null;
  const InquiryScreen.vendor({super.key, required Vendor this.vendor})
      : venue = null,
        space = null;

  @override
  ConsumerState<InquiryScreen> createState() => _InquiryScreenState();
}

class _InquiryScreenState extends ConsumerState<InquiryScreen> {
  static const _eventTypes = ['Wedding / Reception', 'Birthday', 'Corporate event', 'Conference', 'Concert', 'Other'];

  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _guests = TextEditingController(text: '200');
  final _budget = TextEditingController();
  final _message = TextEditingController();
  String _eventType = _eventTypes.first;
  DateTime? _date;
  VenueSpace? _space;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _space = widget.space;
    final user = ref.read(authProvider).user;
    if (user != null) {
      _name.text = user.fullName;
      _email.text = user.email;
      _phone.text = user.phoneNumber ?? '';
    }
  }

  @override
  void dispose() {
    for (final c in [_name, _email, _phone, _guests, _budget, _message]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _date ?? now.add(const Duration(days: 30)),
      firstDate: now,
      lastDate: DateTime(now.year + 3),
    );
    if (d != null) setState(() => _date = d);
  }

  Future<void> _send() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;
    if (_date == null && widget.venue != null) {
      AppToast.error(context, 'Choose your event date');
      return;
    }
    setState(() => _sending = true);
    try {
      final api = ref.read(attendeeApiProvider);
      if (widget.vendor != null) {
        await api.sendVendorInquiry(
          widget.vendor!.id,
          name: _name.text.trim(),
          email: _email.text.trim(),
          phone: _phone.text.trim(),
          eventType: _eventType,
          eventDate: _date,
          budget: _budget.text.trim(),
          message: _message.text.trim(),
        );
      } else {
        await api.sendVenueInquiry(
          widget.venue!.id,
          name: _name.text.trim(),
          email: _email.text.trim(),
          phone: _phone.text.trim(),
          eventType: _eventType,
          eventDate: _date!,
          guestCount: int.tryParse(_guests.text.trim()) ?? 0,
          budget: _budget.text.trim(),
          message: _message.text.trim(),
          spaceId: _space?.id,
        );
      }
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      AppToast.success(context, 'Inquiry sent to $_targetName');
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      noteModuleDisabled(ref, e);
      AppToast.error(context, friendlyError(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  String get _targetName => widget.vendor?.businessName ?? widget.venue!.name;

  @override
  Widget build(BuildContext context) {
    final v = widget.venue;
    final spaces = v?.spaces ?? const <VenueSpace>[];
    return AppScaffold(
      title: 'Send inquiry',
      bottomBar: PrimaryButton(label: 'Send inquiry', icon: Icons.send_rounded, loading: _sending, onPressed: _send),
      slivers: [
        SliverToBoxAdapter(
          child: Form(
            key: _formKey,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 0, 4, 20),
                child: Text('$_targetName will get back to you by phone or email.',
                    style: AppType.body(15, color: AppColors.textSecondary)),
              ),
              GroupedSection(
                header: 'Your event',
                separatorInset: 16,
                children: [
                  ListRow(
                    title: 'Type',
                    value: _eventType,
                    chevron: true,
                    onTap: () async {
                      final picked = await showAppSheet<String>(
                        context,
                        builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, children: [
                          const SheetHeader(title: 'Event type'),
                          for (final t in _eventTypes)
                            SheetAction(
                              icon: Icons.celebration_outlined,
                              label: t,
                              selected: t == _eventType,
                              onTap: () => Navigator.pop(ctx, t),
                            ),
                        ]),
                      );
                      if (picked != null) setState(() => _eventType = picked);
                    },
                  ),
                  ListRow(
                    title: 'Date',
                    value:
                        _date == null ? (v == null ? 'Optional' : 'Choose') : BsDate.format('EEE d MMM y', _date!),
                    chevron: true,
                    onTap: _pickDate,
                  ),
                  if (spaces.isNotEmpty)
                    ListRow(
                      title: 'Space',
                      value: _space?.name ?? 'Any',
                      chevron: true,
                      onTap: () async {
                        final picked = await showAppSheet<VenueSpace?>(
                          context,
                          builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, children: [
                            const SheetHeader(title: 'Space'),
                            SheetAction(
                              icon: Icons.all_inclusive_rounded,
                              label: 'Any space',
                              selected: _space == null,
                              onTap: () => Navigator.pop(ctx, const VenueSpace(id: '', name: '')),
                            ),
                            for (final s in spaces)
                              SheetAction(
                                icon: Icons.meeting_room_outlined,
                                label: s.name,
                                selected: s.id == _space?.id,
                                onTap: () => Navigator.pop(ctx, s),
                              ),
                          ]),
                        );
                        if (picked != null) setState(() => _space = picked.id.isEmpty ? null : picked);
                      },
                    ),
                  if (v != null)
                    FieldRow(
                      controller: _guests,
                      label: 'Guests',
                      keyboardType: TextInputType.number,
                      validator: (s) =>
                          (int.tryParse((s ?? '').trim()) ?? 0) <= 0 ? 'Enter the number of guests' : null,
                    ),
                  FieldRow(controller: _budget, label: 'Budget (optional)', hint: 'e.g. Rs 2–3 lakh'),
                ],
              ),
              GroupedSection(
                header: 'Your details',
                separatorInset: 50,
                children: [
                  FieldRow(
                    controller: _name,
                    label: 'Full name',
                    icon: Icons.person_outline_rounded,
                    textCapitalization: TextCapitalization.words,
                    validator: (s) => (s ?? '').trim().isEmpty ? 'Enter your name' : null,
                  ),
                  FieldRow(
                    controller: _email,
                    label: 'Email',
                    icon: Icons.mail_outline_rounded,
                    keyboardType: TextInputType.emailAddress,
                    validator: (s) => !(s ?? '').contains('@') ? 'Enter a valid email' : null,
                  ),
                  FieldRow(
                    controller: _phone,
                    label: 'Phone',
                    icon: Icons.phone_outlined,
                    keyboardType: TextInputType.phone,
                    validator: (s) =>
                        (s ?? '').replaceAll(RegExp(r'\D'), '').length < 7 ? 'Enter your phone number' : null,
                  ),
                ],
              ),
              GroupedSection(
                header: 'Message',
                children: [
                  FieldRow(
                    controller: _message,
                    label: 'What do you need?',
                    maxLines: 5,
                    keyboardType: TextInputType.multiline,
                    validator: (s) => (s ?? '').trim().isEmpty ? 'Write a short message' : null,
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
