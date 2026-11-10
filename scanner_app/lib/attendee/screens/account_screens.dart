import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/photo_picker.dart';
import '../../providers/auth_provider.dart';
import '../../providers/event_provider.dart';
import '../../providers/modules_provider.dart';
import '../../providers/view_mode_provider.dart';
import '../../reviews/review_models.dart';
import '../../reviews/review_widgets.dart';
import '../../screens/staff/staff_shell.dart' show UserAvatar;
import '../../ui/ui.dart';
import '../attendee_shell.dart';
import '../data/account_api.dart';
import '../data/attendee_api.dart';
import '../providers/explore_providers.dart';
import 'vendor_detail_screen.dart';
import 'venue_detail_screen.dart';
import '../../core/bs_date.dart';

/// Edit photo, name, phone and city (`PATCH /api/auth/me/`). Email can't
/// change. The photo is uploaded first (`/api/uploads/`, kind=avatar) and
/// saved as `avatar_url`; removing sends `avatar_url: ""`.
class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  late final _first = TextEditingController(text: ref.read(authProvider).user?.firstName ?? '');
  late final _last = TextEditingController(text: ref.read(authProvider).user?.lastName ?? '');
  late final _phone = TextEditingController(text: ref.read(authProvider).user?.phoneNumber ?? '');
  late final _city = TextEditingController(text: ref.read(authProvider).user?.city ?? '');
  bool _busy = false;
  bool _photoBusy = false;
  double? _photoProgress;

  Future<void> _changePhoto() async {
    final hasPhoto = ref.read(authProvider).user?.avatar != null;
    final path = await pickPhoto(
      context,
      title: 'Profile photo',
      maxSize: 800,
      quality: 85,
      allowRemove: hasPhoto,
      onRemove: () => _savePhoto(''),
    );
    if (path == null || !mounted) return;
    setState(() {
      _photoBusy = true;
      _photoProgress = 0;
    });
    try {
      final url = await AccountApi().uploadPhoto(path,
          kind: 'avatar', onProgress: (p) => mounted ? setState(() => _photoProgress = p) : null);
      await _savePhoto(url);
    } catch (e) {
      if (mounted) {
        AppToast.error(context, AccountError.from(e).message);
        setState(() => _photoBusy = false);
      }
    }
  }

  Future<void> _savePhoto(String url) async {
    setState(() => _photoBusy = true);
    try {
      final user = await AccountApi().updateProfile({'avatar_url': url});
      await ref.read(authProvider.notifier).setUser(user);
      if (mounted) AppToast.success(context, url.isEmpty ? 'Photo removed' : 'Photo updated');
    } catch (e) {
      if (mounted) AppToast.error(context, AccountError.from(e).message);
    } finally {
      if (mounted) {
        setState(() {
          _photoBusy = false;
          _photoProgress = null;
        });
      }
    }
  }

  @override
  void dispose() {
    for (final c in [_first, _last, _phone, _city]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() => _busy = true);
    try {
      final user = await AccountApi().updateProfile({
        'first_name': _first.text.trim(),
        'last_name': _last.text.trim(),
        'phone': _phone.text.trim(),
        'city': _city.text.trim(),
      });
      await ref.read(authProvider.notifier).setUser(user);
      if (!mounted) return;
      AppToast.success(context, 'Profile saved');
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) AppToast.error(context, AccountError.from(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final email = ref.watch(authProvider).user?.email ?? '';
    return AppScaffold(
      title: 'Edit profile',
      bottomBar: PrimaryButton(label: 'Save', loading: _busy, onPressed: _save),
      slivers: [
        SliverToBoxAdapter(
          child: Form(
            key: _formKey,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Padding(
                padding: const EdgeInsets.only(bottom: 24),
                child: Column(children: [
                  GestureDetector(
                    onTap: _photoBusy ? null : _changePhoto,
                    child: Stack(alignment: Alignment.center, children: [
                      UserAvatar(user: ref.watch(authProvider).user, size: 96),
                      if (_photoBusy)
                        Container(
                          width: 96,
                          height: 96,
                          decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.4), shape: BoxShape.circle),
                          padding: const EdgeInsets.all(30),
                          child: CircularProgressIndicator(
                            strokeWidth: 3,
                            color: Colors.white,
                            value: _photoProgress == null || _photoProgress! <= 0 || _photoProgress! >= 1
                                ? null
                                : _photoProgress,
                          ),
                        ),
                    ]),
                  ),
                  TextButton(
                    onPressed: _photoBusy ? null : _changePhoto,
                    child: Text(ref.watch(authProvider).user?.avatar == null ? 'Add photo' : 'Change photo'),
                  ),
                ]),
              ),
              GroupedSection(
                separatorInset: 50,
                children: [
                  FieldRow(
                    controller: _first,
                    label: 'First name',
                    icon: Icons.person_outline_rounded,
                    textCapitalization: TextCapitalization.words,
                    validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your first name' : null,
                  ),
                  FieldRow(
                    controller: _last,
                    label: 'Last name',
                    icon: Icons.badge_outlined,
                    textCapitalization: TextCapitalization.words,
                  ),
                  FieldRow(
                    controller: _phone,
                    label: 'Phone',
                    icon: Icons.phone_outlined,
                    keyboardType: TextInputType.phone,
                  ),
                  FieldRow(
                    controller: _city,
                    label: 'City',
                    icon: Icons.location_city_outlined,
                    textCapitalization: TextCapitalization.words,
                  ),
                ],
              ),
              GroupedSection(
                footer: 'Your email is used to sign in and can\'t be changed here.',
                children: [ListRow(title: 'Email', value: email)],
              ),
            ]),
          ),
        ),
      ],
    );
  }
}

/// Change (or, for Google/Facebook-only accounts, set) the password.
class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  ConsumerState<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _new = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_current, _new, _confirm]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final hasPassword = ref.read(authProvider).user?.hasPassword ?? true;
    setState(() => _busy = true);
    try {
      final msg = await AccountApi().changePassword(
        currentPassword: hasPassword ? _current.text : null,
        newPassword: _new.text,
      );
      await ref.read(authProvider.notifier).refreshMe();
      if (!mounted) return;
      AppToast.success(context, msg);
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) AppToast.error(context, AccountError.from(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasPassword = ref.watch(authProvider).user?.hasPassword ?? true;
    return AppScaffold(
      title: hasPassword ? 'Change password' : 'Set a password',
      bottomBar: PrimaryButton(label: 'Save', loading: _busy, onPressed: _save),
      slivers: [
        SliverToBoxAdapter(
          child: Form(
            key: _formKey,
            child: GroupedSection(
              separatorInset: 50,
              footer: hasPassword
                  ? null
                  : 'You signed in with Google or Facebook. Set a password to also sign in with your email.',
              children: [
                if (hasPassword)
                  FieldRow(
                    controller: _current,
                    label: 'Current password',
                    icon: Icons.lock_outline_rounded,
                    obscure: true,
                    autofillHints: const [AutofillHints.password],
                    validator: (v) => (v ?? '').isEmpty ? 'Enter your current password' : null,
                  ),
                FieldRow(
                  controller: _new,
                  label: 'New password',
                  icon: Icons.lock_reset_rounded,
                  obscure: true,
                  autofillHints: const [AutofillHints.newPassword],
                  validator: (v) => (v ?? '').length < 8 ? 'Use at least 8 characters' : null,
                ),
                FieldRow(
                  controller: _confirm,
                  label: 'Confirm new password',
                  icon: Icons.check_rounded,
                  obscure: true,
                  validator: (v) => v != _new.text ? 'Passwords don\'t match' : null,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Delete the account (`DELETE /api/auth/me/`), confirmed with the password
/// (or `{confirm: true}` for social-only accounts). Server refusals
/// (admin accounts, organizers with registrations, listings with inquiries,
/// billing history) are shown as they come.
Future<void> deleteAccountFlow(BuildContext context, WidgetRef ref) async {
  final user = ref.read(authProvider).user;
  if (user == null) return;
  final pw = TextEditingController();
  var busy = false;
  String? error;
  final deleted = await showAppSheet<bool>(
    context,
    builder: (ctx) => StatefulBuilder(builder: (ctx, setSheet) {
      Future<void> go() async {
        if (user.hasPassword && pw.text.isEmpty) {
          setSheet(() => error = 'Enter your password to confirm.');
          return;
        }
        setSheet(() {
          busy = true;
          error = null;
        });
        try {
          await AccountApi().deleteAccount(password: user.hasPassword ? pw.text : null);
          if (ctx.mounted) Navigator.pop(ctx, true);
        } catch (e) {
          setSheet(() {
            busy = false;
            error = AccountError.from(e).message;
          });
        }
      }

      return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const SheetHeader(
          title: 'Delete your account?',
          message:
              'Your profile, reviews and sign-in methods are removed. Tickets you registered stay valid with the organizer, and passes saved on this phone keep working. This can\'t be undone.',
        ),
        if (user.hasPassword)
          TextField(
            controller: pw,
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            decoration: const InputDecoration(labelText: 'Password', prefixIcon: Icon(Icons.lock_outline_rounded)),
          ),
        if (error != null) ...[
          const SizedBox(height: 10),
          Text(error!, style: AppType.body(13, color: AppColors.danger)),
        ],
        const SizedBox(height: 16),
        PrimaryButton(label: 'Delete account', tone: ButtonTone.danger, loading: busy, onPressed: go),
        const SizedBox(height: 8),
        PrimaryButton(label: 'Cancel', tone: ButtonTone.neutral, tonal: true, onPressed: () => Navigator.pop(ctx, false)),
      ]);
    }),
  );
  pw.dispose();
  if (deleted != true || !context.mounted) return;
  final nav = Navigator.of(context, rootNavigator: true);
  AppToast.info(context, 'Your account was deleted');
  nav.pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const AttendeeShell()), (_) => false);
  await ref.read(authProvider.notifier).logout();
  ref.read(preferAttendeeViewProvider.notifier).state = false;
  ref.read(eventProvider.notifier).reset();
}

/// Inquiries the signed-in user sent to venues and vendors.
final myInquiriesProvider = FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((ref, kind) {
  return ref.watch(attendeeApiProvider).myInquiries(kind: kind.isEmpty ? null : kind);
});

class MyInquiriesScreen extends ConsumerStatefulWidget {
  const MyInquiriesScreen({super.key});

  @override
  ConsumerState<MyInquiriesScreen> createState() => _MyInquiriesScreenState();
}

class _MyInquiriesScreenState extends ConsumerState<MyInquiriesScreen> {
  String _kind = '';

  static (String, Tone) _status(String? s) => switch (s) {
        'contacted' => ('Contacted', Tone.brand),
        'booked' => ('Booked', Tone.success),
        'rejected' => ('Declined', Tone.danger),
        _ => ('Waiting', Tone.warning),
      };

  void _open(Map<String, dynamic> q) {
    final target = q['target'] is Map ? Map<String, dynamic>.from(q['target'] as Map) : <String, dynamic>{};
    final isVenue = q['kind'] == 'venue';
    final id = target['id']?.toString() ?? '';
    final name = target['name']?.toString() ?? '';
    final (label, tone) = _status(q['status']?.toString());
    final reviews = ref.read(moduleEnabledProvider(AppModule.reviews));
    showAppSheet<void>(
      context,
      builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SheetHeader(title: name, message: [q['event_type'], q['event_date']].where((x) => x != null && '$x'.isNotEmpty).join(' · ')),
        Align(alignment: Alignment.centerLeft, child: StatusBadge(label, tone: tone)),
        const SizedBox(height: 12),
        Text(q['message']?.toString() ?? '', style: AppType.body(14, height: 1.5)),
        const SizedBox(height: 20),
        if (reviews && q['can_review'] == true) ...[
          PrimaryButton(
            label: 'Write a review',
            icon: Icons.star_rounded,
            tone: ButtonTone.warning,
            tonal: true,
            onPressed: () async {
              Navigator.pop(ctx);
              final t = isVenue ? ReviewTarget.venue(id, name) : ReviewTarget.vendor(id, name);
              if (await showWriteReviewSheet(context, ref, t)) {
                ref.invalidate(myInquiriesProvider(_kind));
                if (mounted) AppToast.success(context, 'Thanks for your review');
              }
            },
          ),
          const SizedBox(height: 8),
        ],
        PrimaryButton(
          label: isVenue ? 'View venue' : 'View vendor',
          tone: ButtonTone.neutral,
          tonal: true,
          onPressed: () {
            Navigator.pop(ctx);
            Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => isVenue ? VenueDetailScreen(id: id) : VendorDetailScreen(id: id),
            ));
          },
        ),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(myInquiriesProvider(_kind));
    final list = async.valueOrNull;
    return AppScaffold(
      title: 'My inquiries',
      onRefresh: () async {
        ref.invalidate(myInquiriesProvider(_kind));
        try {
          await ref.read(myInquiriesProvider(_kind).future);
        } catch (_) {}
      },
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: SegmentedControl<String>(
              segments: const [Segment('', 'All'), Segment('venue', 'Venues'), Segment('vendor', 'Vendors')],
              selected: _kind,
              onChanged: (v) => setState(() => _kind = v),
            ),
          ),
        ),
        if (list == null)
          SliverToBoxAdapter(
            child: async.hasError
                ? ErrorState(message: friendlyError(async.error!), onRetry: () => ref.invalidate(myInquiriesProvider(_kind)))
                : const LoadingList(rows: 4),
          )
        else if (list.isEmpty)
          const SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.forum_outlined,
              title: 'No inquiries yet',
              message: 'Ask a venue or vendor about your event from the Vendors tab — replies come by phone or email.',
            ),
          )
        else
          SliverToBoxAdapter(
            child: GroupedSection(
              separatorInset: 58,
              children: [
                for (final q in list)
                  Builder(builder: (context) {
                    final target = q['target'] is Map ? q['target'] as Map : const {};
                    final (label, tone) = _status(q['status']?.toString());
                    final created = DateTime.tryParse(q['created_at']?.toString() ?? '')?.toLocal();
                    return ListRow(
                      leading: RowIcon(q['kind'] == 'venue' ? Icons.location_city_rounded : Icons.storefront_rounded,
                          background: q['kind'] == 'venue' ? AppColors.brand : AppColors.ink600),
                      title: target['name']?.toString() ?? 'Listing',
                      subtitle: [
                        if ((q['event_type']?.toString() ?? '').isNotEmpty) q['event_type'].toString(),
                        if (created != null) 'Sent ${BsDate.format('d MMM', created)}',
                      ].join(' · '),
                      trailing: StatusBadge(label, tone: tone),
                      onTap: () => _open(q),
                    );
                  }),
              ],
            ),
          ),
      ],
    );
  }
}
