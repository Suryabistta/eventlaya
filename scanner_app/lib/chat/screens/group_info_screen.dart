import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../attendee/data/attendee_api.dart' show friendlyError;
import '../../providers/auth_provider.dart';
import '../../ui/ui.dart';
import '../chat_models.dart';
import '../chat_providers.dart';
import '../chat_widgets.dart';
import 'new_chat_screen.dart' show chatContactsProvider;

/// Conversation info: members, rename, add / remove people, roles, mute,
/// leave. Event crew groups are managed from gate assignments, so their
/// membership can't be edited here.
class GroupInfoScreen extends ConsumerStatefulWidget {
  final Conversation conversation;
  const GroupInfoScreen({super.key, required this.conversation});

  @override
  ConsumerState<GroupInfoScreen> createState() => _GroupInfoScreenState();
}

class _GroupInfoScreenState extends ConsumerState<GroupInfoScreen> {
  late Conversation _c = widget.conversation;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    try {
      final c = await ref.read(chatApiProvider).conversation(_c.id);
      if (mounted) setState(() => _c = c);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _run(Future<Conversation> Function() f, [String? done]) async {
    try {
      final c = await f();
      ref.read(chatControllerProvider.notifier).upsert(c);
      if (!mounted) return;
      setState(() => _c = c);
      if (done != null) AppToast.success(context, done);
    } catch (e) {
      if (mounted) AppToast.error(context, friendlyError(e));
    }
  }

  Future<void> _rename() async {
    final ctrl = TextEditingController(text: _c.title);
    final title = await showAppSheet<String>(
      context,
      builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const SheetHeader(title: 'Rename group'),
        TextField(controller: ctrl, autofocus: true, onSubmitted: (v) => Navigator.pop(ctx, v)),
        const SizedBox(height: 16),
        PrimaryButton(label: 'Save', onPressed: () => Navigator.pop(ctx, ctrl.text)),
      ]),
    );
    ctrl.dispose();
    if (title == null || title.trim().isEmpty) return;
    await _run(() => ref.read(chatApiProvider).rename(_c.id, title.trim()), 'Group renamed');
  }

  Future<void> _addMembers() async {
    final people = await ref.read(chatContactsProvider.future).catchError((_) => <ChatUser>[]);
    final inGroup = {for (final m in _c.members) m.user.id};
    final candidates = people.where((p) => !inGroup.contains(p.id)).toList();
    if (!mounted) return;
    if (candidates.isEmpty) {
      AppToast.info(context, 'Everyone on your team is already here');
      return;
    }
    Set<String> picked = {};
    final ok = await showAppSheet<bool>(
      context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const SheetHeader(title: 'Add people'),
          ContactPicker(people: candidates, selected: picked, onChanged: (s) => setSheet(() => picked = s)),
          const SizedBox(height: 12),
          PrimaryButton(label: 'Add', onPressed: () => Navigator.pop(ctx, true)),
        ]),
      ),
    );
    if (ok != true || picked.isEmpty) return;
    await _run(() => ref.read(chatApiProvider).addMembers(_c.id, picked.toList()), 'Added');
  }

  Future<void> _memberActions(ConvMember m) async {
    final action = await showAppSheet<String>(
      context,
      builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, children: [
        SheetHeader(title: m.user.name, message: m.user.email),
        SheetAction(
          icon: m.isAdmin ? Icons.remove_moderator_outlined : Icons.admin_panel_settings_outlined,
          label: m.isAdmin ? 'Remove as admin' : 'Make group admin',
          onTap: () => Navigator.pop(ctx, 'role'),
        ),
        SheetAction(
          icon: Icons.person_remove_outlined,
          label: 'Remove from group',
          destructive: true,
          onTap: () => Navigator.pop(ctx, 'remove'),
        ),
      ]),
    );
    final api = ref.read(chatApiProvider);
    if (action == 'role') {
      await _run(() => api.setRole(_c.id, m.user.id, m.isAdmin ? 'member' : 'admin'));
    } else if (action == 'remove') {
      await _run(() => api.removeMember(_c.id, m.user.id), 'Removed ${m.user.name}');
    }
  }

  Future<void> _leave() async {
    final ok = await confirmSheet(context,
        title: 'Leave ${_c.title}?', message: 'You won\'t get new messages from this group.', confirmLabel: 'Leave');
    if (!ok) return;
    try {
      await ref.read(chatApiProvider).leave(_c.id);
      ref.read(chatControllerProvider.notifier).remove(_c.id);
      if (!mounted) return;
      AppToast.info(context, 'You left the group');
      Navigator.of(context)
        ..pop()
        ..pop();
    } catch (e) {
      if (mounted) AppToast.error(context, friendlyError(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authProvider).user?.id;
    final c = _c;
    final canManage = c.isGroup && c.iAmAdmin && !c.isEventCrew;
    return AppScaffold(
      title: c.isGroup ? 'Group info' : 'Chat info',
      onRefresh: _reload,
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 20),
            child: Column(children: [
              ChatAvatar.conversation(c, size: 84),
              const SizedBox(height: 10),
              Text(c.title, textAlign: TextAlign.center, style: AppType.heading(22)),
              if (c.isEventCrew)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text('Event crew${c.eventTitle == null ? '' : ' · ${c.eventTitle}'}', style: AppType.caption),
                )
              else if (!c.isGroup && c.otherMember != null)
                Text([c.otherMember!.roleLabel, c.otherMember!.email].where((x) => x.isNotEmpty).join(' · '),
                    style: AppType.caption),
            ]),
          ),
        ),
        SliverToBoxAdapter(
          child: GroupedSection(
            separatorInset: 58,
            footer: c.isEventCrew ? 'Members follow gate assignments for this event and update automatically.' : null,
            children: [
              ListRow(
                leading: RowIcon(c.muted ? Icons.notifications_off_rounded : Icons.notifications_rounded,
                    background: AppColors.ink500),
                title: 'Mute notifications',
                trailing: Switch(
                  value: c.muted,
                  onChanged: (v) => _run(() => ref.read(chatApiProvider).setMuted(c.id, v)),
                ),
              ),
              if (canManage)
                ListRow(
                  leading: const RowIcon(Icons.edit_rounded),
                  title: 'Rename group',
                  chevron: true,
                  onTap: _rename,
                ),
            ],
          ),
        ),
        if (c.isGroup)
          SliverToBoxAdapter(
            child: GroupedSection(
              header: '${c.members.isEmpty ? c.memberCount : c.members.length} members',
              separatorInset: 68,
              children: [
                if (canManage)
                  ListRow(
                    leading: const RowIcon(Icons.person_add_alt_1_rounded, background: AppColors.success),
                    title: 'Add people',
                    onTap: _addMembers,
                  ),
                if (c.members.isEmpty && _loading) const ListRow(title: 'Loading…'),
                for (final m in c.members)
                  ListRow(
                    leading: ChatAvatar(name: m.user.name, imageUrl: m.user.avatar, size: 40),
                    title: m.user.id == me ? '${m.user.name} (you)' : m.user.name,
                    subtitle: [if (m.user.roleLabel.isNotEmpty) m.user.roleLabel, m.user.email].join(' · '),
                    trailing: m.isAdmin ? const StatusBadge('Admin', tone: Tone.brand, dot: false) : null,
                    onTap: canManage && m.user.id != me ? () => _memberActions(m) : null,
                  ),
              ],
            ),
          ),
        if (c.isGroup && !c.isEventCrew)
          SliverToBoxAdapter(
            child: GroupedSection(children: [
              ListRow(title: 'Leave group', destructive: true, centered: true, onTap: _leave),
            ]),
          ),
      ],
    );
  }
}
