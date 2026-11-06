import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';
import '../../models/team_member.dart';
import '../../ui/ui.dart';
import '../common/format.dart';
import 'staff_credentials_sheet.dart';

/// Loads the organizer's team (`GET /api/auth/team/`).
Future<List<TeamMember>> fetchTeamMembers(ApiClient api) async {
  final resp = await api.get('/api/auth/team/');
  final data = resp.data;
  final list = data is List ? data : (data is Map && data['results'] is List ? data['results'] as List : const []);
  return list.whereType<Map>().map((m) => TeamMember.fromJson(Map<String, dynamic>.from(m))).toList();
}

enum _MemberAction { edit, resetPassword, toggleActive, remove }

/// Organizer's gate-staff accounts: onboard, edit, deactivate, reset, remove.
class TeamScreen extends ConsumerStatefulWidget {
  const TeamScreen({super.key});

  @override
  ConsumerState<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends ConsumerState<TeamScreen> {
  final _api = ApiClient();
  List<TeamMember> _members = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final members = await fetchTeamMembers(_api);
      if (mounted) setState(() => _members = members);
    } on DioException catch (e) {
      if (mounted) setState(() => _error = _api.errorMessage(e));
    } catch (e) {
      if (mounted) setState(() => _error = 'Something went wrong: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String? _tempPassword(Response resp) {
    final data = resp.data;
    if (data is! Map) return null;
    final p = data['temporary_password']?.toString();
    return (p == null || p.isEmpty) ? null : p;
  }

  String? _message(Response resp) => resp.data is Map ? resp.data['message']?.toString() : null;

  // ---------------------------------------------------------------- add

  Future<void> _openAddSheet() async {
    final firstCtrl = TextEditingController();
    final lastCtrl = TextEditingController();
    final emailCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    final passwordCtrl = TextEditingController();
    var obscure = true;
    var saving = false;

    await showAppSheet<void>(
      context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) {
          Future<void> save() async {
            final email = emailCtrl.text.trim();
            if (email.isEmpty || !email.contains('@')) {
              AppToast.error(ctx, "Enter the staff member's email");
              return;
            }
            final password = passwordCtrl.text;
            if (password.isNotEmpty && password.length < 8) {
              AppToast.error(ctx, 'Use at least 8 characters, or leave the password blank');
              return;
            }
            setSheet(() => saving = true);
            try {
              final resp = await _api.post('/api/auth/team/', data: {
                'email': email,
                if (firstCtrl.text.trim().isNotEmpty) 'first_name': firstCtrl.text.trim(),
                if (lastCtrl.text.trim().isNotEmpty) 'last_name': lastCtrl.text.trim(),
                if (phoneCtrl.text.trim().isNotEmpty) 'phone': phoneCtrl.text.trim(),
                if (password.isNotEmpty) 'password': password,
              });
              final temp = _tempPassword(resp);
              final msg = _message(resp);
              final name = '${firstCtrl.text.trim()} ${lastCtrl.text.trim()}'.trim();
              if (ctx.mounted) Navigator.pop(ctx);
              _load();
              if (!mounted) return;
              if (temp != null) {
                await showStaffCredentialsSheet(context, email: email, password: temp, name: name);
              } else {
                AppToast.success(context, msg ?? '$email added to your team');
              }
            } on DioException catch (e) {
              if (ctx.mounted) {
                setSheet(() => saving = false);
                AppToast.error(ctx, _api.errorMessage(e));
              }
            }
          }

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              const SheetHeader(
                title: 'Add staff member',
                message: 'Create a sign-in for someone who will scan passes at your gates.',
              ),
              GroupedSection(
                separatorInset: 50,
                margin: const EdgeInsets.only(bottom: 16),
                children: [
                  FieldRow(
                    controller: firstCtrl,
                    label: 'First name',
                    icon: Icons.person_outline_rounded,
                    autofocus: true,
                    textCapitalization: TextCapitalization.words,
                    textInputAction: TextInputAction.next,
                  ),
                  FieldRow(
                    controller: lastCtrl,
                    label: 'Last name',
                    icon: Icons.person_outline_rounded,
                    textCapitalization: TextCapitalization.words,
                    textInputAction: TextInputAction.next,
                  ),
                  FieldRow(
                    controller: emailCtrl,
                    label: 'Email',
                    hint: 'staff@example.com',
                    icon: Icons.mail_outline_rounded,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                  ),
                  FieldRow(
                    controller: phoneCtrl,
                    label: 'Phone (optional)',
                    icon: Icons.phone_outlined,
                    keyboardType: TextInputType.phone,
                    textInputAction: TextInputAction.next,
                  ),
                ],
              ),
              GroupedSection(
                separatorInset: 50,
                footer: "Leave blank and we'll generate a temporary password to share with them.",
                margin: const EdgeInsets.only(bottom: 20),
                children: [
                  FieldRow(
                    controller: passwordCtrl,
                    label: 'Password (optional)',
                    icon: Icons.lock_outline_rounded,
                    obscure: obscure,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => save(),
                    suffix: IconButton(
                      tooltip: obscure ? 'Show password' : 'Hide password',
                      icon: Icon(obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined, size: 20),
                      onPressed: () => setSheet(() => obscure = !obscure),
                    ),
                  ),
                ],
              ),
              PrimaryButton(
                label: 'Add to team',
                icon: Icons.person_add_alt_1_rounded,
                loading: saving,
                onPressed: save,
              ),
            ],
          );
        },
      ),
    );
  }

  // ------------------------------------------------------------- member

  Future<void> _openMember(TeamMember m) async {
    final action = await showAppSheet<_MemberAction>(
      context,
      builder: (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Row(
              children: [
                _avatar(m, size: 52),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(m.displayName, style: AppType.heading(22), maxLines: 2, overflow: TextOverflow.ellipsis),
                      const SizedBox(height: 2),
                      Text(m.email, style: AppType.body(14, color: AppColors.textSecondary)),
                    ],
                  ),
                ),
                if (!m.isActive) const StatusBadge('Deactivated', tone: Tone.danger, dot: false),
              ],
            ),
          ),
          GroupedSection(
            margin: const EdgeInsets.only(bottom: 16),
            children: [
              ListRow(title: 'Phone', value: m.phone.isEmpty ? '—' : m.phone),
              ListRow(title: 'Joined', value: m.dateJoined == null ? '—' : Fmt.date(m.dateJoined)),
              ListRow(title: 'Last sign-in', value: m.lastLogin == null ? 'Never' : Fmt.timeIso(m.lastLogin)),
            ],
          ),
          GroupedSection(
            header: 'Gates',
            separatorInset: 58,
            margin: const EdgeInsets.only(bottom: 16),
            children: m.activeAssignments.isEmpty
                ? [const ListRow(title: 'Not assigned to a gate yet', subtitle: 'Assign them from Gate staff.')]
                : [
                    for (final a in m.activeAssignments)
                      ListRow(
                        leading: const RowIcon(Icons.door_front_door_outlined, background: AppColors.ink600),
                        title: a.gateName.isEmpty ? 'Any gate' : a.gateName,
                        subtitle: a.eventTitle,
                      ),
                  ],
          ),
          SheetAction(
            icon: Icons.edit_outlined,
            label: 'Edit name & phone',
            onTap: () => Navigator.pop(ctx, _MemberAction.edit),
          ),
          SheetAction(
            icon: Icons.key_rounded,
            label: 'Reset password',
            onTap: () => Navigator.pop(ctx, _MemberAction.resetPassword),
          ),
          SheetAction(
            icon: m.isActive ? Icons.block_rounded : Icons.check_circle_outline_rounded,
            label: m.isActive ? 'Deactivate' : 'Reactivate',
            onTap: () => Navigator.pop(ctx, _MemberAction.toggleActive),
          ),
          SheetAction(
            icon: Icons.person_remove_outlined,
            label: 'Remove from team',
            destructive: true,
            onTap: () => Navigator.pop(ctx, _MemberAction.remove),
          ),
        ],
      ),
    );
    if (action == null || !mounted) return;
    switch (action) {
      case _MemberAction.edit:
        await _openEditSheet(m);
      case _MemberAction.resetPassword:
        await _resetPassword(m);
      case _MemberAction.toggleActive:
        await _toggleActive(m);
      case _MemberAction.remove:
        await _remove(m);
    }
  }

  Future<void> _openEditSheet(TeamMember m) async {
    final firstCtrl = TextEditingController(text: m.firstName);
    final lastCtrl = TextEditingController(text: m.lastName);
    final phoneCtrl = TextEditingController(text: m.phone);
    var saving = false;

    await showAppSheet<void>(
      context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) {
          Future<void> save() async {
            setSheet(() => saving = true);
            try {
              await _api.patch('/api/auth/team/${m.id}/', data: {
                'first_name': firstCtrl.text.trim(),
                'last_name': lastCtrl.text.trim(),
                'phone': phoneCtrl.text.trim(),
              });
              if (ctx.mounted) {
                AppToast.success(ctx, 'Details saved');
                Navigator.pop(ctx);
              }
              _load();
            } on DioException catch (e) {
              if (ctx.mounted) {
                setSheet(() => saving = false);
                AppToast.error(ctx, _api.errorMessage(e));
              }
            }
          }

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              SheetHeader(title: 'Edit details', message: m.email),
              GroupedSection(
                separatorInset: 50,
                margin: const EdgeInsets.only(bottom: 20),
                children: [
                  FieldRow(
                    controller: firstCtrl,
                    label: 'First name',
                    icon: Icons.person_outline_rounded,
                    textCapitalization: TextCapitalization.words,
                    textInputAction: TextInputAction.next,
                  ),
                  FieldRow(
                    controller: lastCtrl,
                    label: 'Last name',
                    icon: Icons.person_outline_rounded,
                    textCapitalization: TextCapitalization.words,
                    textInputAction: TextInputAction.next,
                  ),
                  FieldRow(
                    controller: phoneCtrl,
                    label: 'Phone',
                    icon: Icons.phone_outlined,
                    keyboardType: TextInputType.phone,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => save(),
                  ),
                ],
              ),
              PrimaryButton(label: 'Save', loading: saving, onPressed: save),
            ],
          );
        },
      ),
    );
  }

  Future<void> _resetPassword(TeamMember m) async {
    final ok = await confirmSheet(
      context,
      title: 'Reset password?',
      message: "${m.displayName}'s current password stops working. You'll get a new temporary password to share.",
      confirmLabel: 'Reset password',
      destructive: false,
    );
    if (!ok || !mounted) return;
    try {
      final resp = await _api.patch('/api/auth/team/${m.id}/', data: {'reset_password': true});
      final temp = _tempPassword(resp);
      if (!mounted) return;
      if (temp != null) {
        await showStaffCredentialsSheet(context,
            email: m.email, password: temp, name: m.displayName, title: 'New password');
      } else {
        AppToast.success(context, _message(resp) ?? 'Password reset');
      }
    } on DioException catch (e) {
      if (mounted) AppToast.error(context, _api.errorMessage(e));
    }
  }

  Future<void> _toggleActive(TeamMember m) async {
    if (m.isActive) {
      final ok = await confirmSheet(
        context,
        title: 'Deactivate ${m.displayName}?',
        message: "They won't be able to sign in or scan until you reactivate them. Their gate assignments are kept.",
        confirmLabel: 'Deactivate',
      );
      if (!ok || !mounted) return;
    }
    try {
      await _api.patch('/api/auth/team/${m.id}/', data: {'is_active': !m.isActive});
      if (mounted) {
        AppToast.success(context, m.isActive ? '${m.displayName} deactivated' : '${m.displayName} reactivated');
      }
      _load();
    } on DioException catch (e) {
      if (mounted) AppToast.error(context, _api.errorMessage(e));
    }
  }

  Future<void> _remove(TeamMember m) async {
    final ok = await confirmSheet(
      context,
      title: 'Remove ${m.displayName}?',
      message: "They'll be removed from your team and from all of your event gates.",
      confirmLabel: 'Remove from team',
    );
    if (!ok || !mounted) return;
    try {
      final resp = await _api.delete('/api/auth/team/${m.id}/');
      if (mounted) AppToast.success(context, _message(resp) ?? '${m.displayName} removed');
      _load();
    } on DioException catch (e) {
      if (mounted) AppToast.error(context, _api.errorMessage(e));
    }
  }

  // ---------------------------------------------------------------- UI

  Widget _avatar(TeamMember m, {double size = 40}) => InitialsAvatar(
        name: m.displayName,
        size: size,
        background: m.isActive ? AppColors.brandTint : AppColors.ink100,
        foreground: m.isActive ? AppColors.brand : AppColors.ink400,
      );

  Widget _memberRow(TeamMember m) {
    final assigned = m.activeAssignments.isNotEmpty;
    return ListRow(
      leading: _avatar(m),
      title: m.displayName,
      subtitleWidget: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (m.displayName != m.email)
            Text(m.email, style: AppType.rowSubtitle, maxLines: 1, overflow: TextOverflow.ellipsis),
          Text(
            m.assignmentSummary,
            style: AppType.rowSubtitle.copyWith(color: assigned ? AppColors.textSecondary : AppColors.textTertiary),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
      chevron: true,
      onTap: () => _openMember(m),
    );
  }

  @override
  Widget build(BuildContext context) {
    final active = _members.where((m) => m.isActive).toList();
    final inactive = _members.where((m) => !m.isActive).toList();

    return AppScaffold(
      title: 'Team',
      onRefresh: _load,
      actions: [
        AppIconButton(icon: Icons.person_add_alt_1_rounded, tooltip: 'Add staff member', onPressed: _openAddSheet),
      ],
      slivers: [
        if (_error != null && _members.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: ErrorState(title: "Couldn't load your team", message: _error!, onRetry: _load),
          )
        else if (_loading && _members.isEmpty)
          const SliverToBoxAdapter(child: LoadingList(rows: 4))
        else if (_members.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.groups_outlined,
              title: 'No team members yet',
              message: 'Add the people who will scan passes at your gates. They sign in to this app with their own account.',
              actionLabel: 'Add staff member',
              actionIcon: Icons.person_add_alt_1_rounded,
              onAction: _openAddSheet,
            ),
          )
        else
          SliverToBoxAdapter(
            child: Column(
              children: [
                if (active.isNotEmpty)
                  GroupedSection(
                    header: 'Active · ${active.length}',
                    footer: inactive.isEmpty ? 'Staff sign in to this app with their email and password.' : null,
                    separatorInset: 68,
                    children: [for (final m in active) _memberRow(m)],
                  ),
                if (inactive.isNotEmpty)
                  GroupedSection(
                    header: 'Deactivated · ${inactive.length}',
                    footer: "Deactivated staff can't sign in or scan.",
                    separatorInset: 68,
                    children: [for (final m in inactive) _memberRow(m)],
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
