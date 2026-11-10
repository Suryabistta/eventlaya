import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/bs_date.dart';
import '../../core/legal.dart';
import '../../core/photo_picker.dart';
import '../../providers/auth_provider.dart';
import '../../ui/ui.dart';
import '../data/attendee_api.dart';
import '../models/public_event.dart';
import '../providers/explore_providers.dart';

/// Applications stage (film submissions, pageant applications…): the event's application form, photos included.
/// No ticket or pass; the organizer reviews each application. Same API as the website's Apply page.
class ApplyScreen extends ConsumerStatefulWidget {
  final PublicEvent event;
  const ApplyScreen({super.key, required this.event});

  /// File (PDF) questions still need the website.
  static bool needsWebsite(PublicEvent e) => e.applicationForm?.fields.any((f) => f.type == 'file_upload') ?? false;

  @override
  ConsumerState<ApplyScreen> createState() => _ApplyScreenState();
}

class _ApplyScreenState extends ConsumerState<ApplyScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _email;
  late final TextEditingController _phone;
  final _text = <String, TextEditingController>{};
  final _answers = <String, dynamic>{};
  final _errors = <String, String>{};
  final _uploading = <String>{};
  bool _sending = false;

  List<FormFieldSpec> get _fields => widget.event.applicationForm?.fields ?? const [];

  @override
  void initState() {
    super.initState();
    final user = ref.read(authProvider).user;
    _name = TextEditingController(text: user?.fullName ?? '');
    _email = TextEditingController(text: user?.email ?? '');
    _phone = TextEditingController(text: user?.phoneNumber ?? '');
    for (final f in _fields) {
      if (!['select', 'radio', 'checkbox', 'date', 'heading', 'image', 'file_upload'].contains(f.type)) {
        _text[f.id] = TextEditingController();
      }
    }
  }

  @override
  void dispose() {
    for (final c in [_name, _email, _phone, ..._text.values]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _pickPhoto(FormFieldSpec f) async {
    final path = await pickPhoto(context, title: f.label);
    if (path == null) return;
    setState(() => _uploading.add(f.id));
    try {
      final url = await ref.read(attendeeApiProvider).formUpload(widget.event.slug, path);
      setState(() {
        _answers[f.id] = url;
        _errors.remove(f.id);
      });
    } catch (e) {
      if (mounted) AppToast.error(context, friendlyError(e));
    } finally {
      if (mounted) setState(() => _uploading.remove(f.id));
    }
  }

  Future<void> _submit() async {
    _errors.clear();
    for (final f in _fields) {
      if (!f.required || f.type == 'heading' || _text.containsKey(f.id) || !f.visible(_answers)) continue;
      final v = _answers[f.id];
      if (v == null || v == '' || (v is List && v.isEmpty)) _errors[f.id] = f.type == 'image' ? 'Add a photo' : 'Choose an answer';
    }
    final formOk = _formKey.currentState?.validate() ?? false;
    setState(() {});
    if (!formOk || _errors.isNotEmpty) return;
    for (final e in _text.entries) {
      final v = e.value.text.trim();
      if (v.isNotEmpty) _answers[e.key] = v;
    }
    setState(() => _sending = true);
    try {
      final (number, already) = await ref.read(attendeeApiProvider).apply(
            widget.event.slug,
            name: _name.text.trim(),
            email: _email.text.trim(),
            phone: _phone.text.trim(),
            answers: _answers,
          );
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          icon: const Icon(Icons.check_circle_rounded, color: AppColors.success, size: 40),
          title: Text(already ? "You've already applied" : 'Application received'),
          content: Text('Application no. $number. A confirmation was sent to ${_email.text.trim()}. '
              "You'll get another email once the organizer reviews it."),
          actions: [TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Done'))],
        ),
      );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) AppToast.error(context, friendlyError(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Widget _question(FormFieldSpec f) {
    final label = f.required ? f.label : '${f.label} (optional)';
    switch (f.type) {
      case 'heading':
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(f.label, style: AppType.heading(16)),
            if (f.helpText.isNotEmpty) Text(f.helpText, style: AppType.caption),
          ]),
        );
      case 'image':
        final url = _answers[f.id] as String?;
        return ListRow(
          title: label,
          subtitle: _errors[f.id] ?? (url != null ? 'Photo added' : (f.helpText.isNotEmpty ? f.helpText : 'JPG or PNG, up to 5 MB')),
          value: _uploading.contains(f.id) ? 'Uploading…' : (url == null ? 'Add' : 'Change'),
          chevron: true,
          onTap: _uploading.contains(f.id) ? null : () => _pickPhoto(f),
        );
      case 'select':
      case 'radio':
      case 'checkbox':
        final multi = f.type == 'checkbox';
        if (multi && f.options.isEmpty) {
          return CheckboxListTile(
            value: _answers[f.id] == true,
            title: Text(f.label, style: AppType.body(14)),
            subtitle: _errors[f.id] == null ? null : Text(_errors[f.id]!, style: AppType.body(12, color: AppColors.danger)),
            onChanged: (v) => setState(() {
              _answers[f.id] = v == true;
              _errors.remove(f.id);
            }),
          );
        }
        final selected = multi ? List<String>.from(_answers[f.id] as List? ?? const []) : _answers[f.id];
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: AppType.body(14, weight: FontWeight.w500)),
            if (f.helpText.isNotEmpty) Text(f.helpText, style: AppType.caption),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final o in f.options)
                ChoiceChip(
                  label: Text(o),
                  selected: multi ? (selected as List<String>).contains(o) : selected == o,
                  selectedColor: AppColors.brandTint,
                  onSelected: (on) => setState(() {
                    _errors.remove(f.id);
                    if (multi) {
                      final cur = List<String>.from(selected as List<String>);
                      on ? cur.add(o) : cur.remove(o);
                      _answers[f.id] = cur;
                    } else {
                      _answers[f.id] = on ? o : null;
                    }
                  }),
                ),
            ]),
            if (_errors[f.id] != null) Text(_errors[f.id]!, style: AppType.body(12, color: AppColors.danger)),
          ]),
        );
      case 'date':
        final v = _answers[f.id] as String?;
        return ListRow(
          title: label,
          subtitle: _errors[f.id] ?? (f.helpText.isNotEmpty ? f.helpText : null),
          value: v == null ? 'Choose' : BsDate.format('d MMM y', DateTime.parse(v)),
          chevron: true,
          onTap: () async {
            final now = DateTime.now();
            final picked = await showDatePicker(context: context, initialDate: v == null ? DateTime(now.year - 20) : DateTime.parse(v), firstDate: DateTime(1900), lastDate: DateTime(now.year + 10));
            if (picked != null) {
              setState(() {
                _answers[f.id] = DateFormat('yyyy-MM-dd').format(picked); // the API takes AD
                _errors.remove(f.id);
              });
            }
          },
        );
      default:
        return FieldRow(
          controller: _text[f.id]!,
          label: label,
          hint: f.placeholder.isEmpty ? null : f.placeholder,
          maxLines: f.type == 'paragraph' ? 4 : 1,
          keyboardType: switch (f.type) {
            'number' => const TextInputType.numberWithOptions(decimal: true),
            'email' => TextInputType.emailAddress,
            'phone' => TextInputType.phone,
            'url' => TextInputType.url,
            'paragraph' => TextInputType.multiline,
            _ => TextInputType.text,
          },
          validator: (v) {
            final s = (v ?? '').trim();
            if (f.required && s.isEmpty) return 'This field is required';
            if (s.isNotEmpty && f.type == 'number' && num.tryParse(s) == null) return 'Enter a number';
            if (s.isNotEmpty && f.type == 'url' && !RegExp(r'^https?://\S+\.\S+$', caseSensitive: false).hasMatch(s)) {
              return 'Paste a full link starting with https://';
            }
            return null;
          },
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final e = widget.event;
    return AppScaffold(
      title: e.applyLabel,
      bottomBar: PrimaryButton(label: e.applyLabel, icon: Icons.send_rounded, loading: _sending, onPressed: _submit),
      slivers: [
        SliverToBoxAdapter(
          child: Form(
            key: _formKey,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 0, 4, 16),
                child: Text('${e.title}: free to apply. The organizer reviews every application and emails you.',
                    style: AppType.body(15, color: AppColors.textSecondary)),
              ),
              GroupedSection(header: 'Your details', separatorInset: 50, children: [
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
                  label: e.phoneRequired ? 'Mobile number' : 'Mobile number (optional)',
                  icon: Icons.phone_outlined,
                  keyboardType: TextInputType.phone,
                  validator: (s) => e.phoneRequired && (s ?? '').replaceAll(RegExp(r'\D'), '').length < 7 ? 'Enter your mobile number' : null,
                ),
              ]),
              if (_fields.isNotEmpty)
                GroupedSection(header: e.applicationForm?.title ?? 'Application', separatorInset: 16, children: [for (final f in _fields) if (f.visible(_answers)) _question(f)]),
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 8, 4, 24),
                child: TextButton(
                  onPressed: () => openLegal(context, '/e/${e.slug}/apply'),
                  child: const Text('Apply on the website instead'),
                ),
              ),
            ]),
          ),
        ),
      ],
    );
  }
}
