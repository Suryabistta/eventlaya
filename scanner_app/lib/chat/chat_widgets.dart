import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../ui/ui.dart';
import 'chat_models.dart';

/// "14:05" today, "Yesterday", "Mon" this week, else "12 Mar".
String chatTime(DateTime? t) {
  if (t == null) return '';
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(t.year, t.month, t.day);
  final diff = today.difference(day).inDays;
  if (diff == 0) return DateFormat('HH:mm').format(t);
  if (diff == 1) return 'Yesterday';
  if (diff < 7) return DateFormat('EEE').format(t);
  return DateFormat('d MMM').format(t);
}

/// "Today", "Yesterday", "Monday 12 March".
String chatDay(DateTime t) {
  final now = DateTime.now();
  final diff = DateTime(now.year, now.month, now.day).difference(DateTime(t.year, t.month, t.day)).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Yesterday';
  return DateFormat(t.year == now.year ? 'EEEE d MMMM' : 'd MMMM y').format(t);
}

/// Avatar for a person or a conversation (group / event crew icon).
class ChatAvatar extends StatelessWidget {
  final String name;
  final String? imageUrl;
  final double size;
  final IconData? icon;
  final List<Color>? gradient;
  const ChatAvatar({super.key, required this.name, this.imageUrl, this.size = 44, this.icon, this.gradient});

  factory ChatAvatar.conversation(Conversation c, {double size = 48}) {
    if (c.isEventCrew) {
      return ChatAvatar(
        name: c.title,
        size: size,
        icon: Icons.badge_rounded,
        gradient: const [Color(0xFFF5B031), AppColors.marigoldDark],
      );
    }
    if (c.isGroup) {
      return ChatAvatar(
        name: c.title,
        size: size,
        icon: Icons.groups_rounded,
        gradient: const [Color(0xFFD63A70), AppColors.brandDark],
      );
    }
    return ChatAvatar(name: c.otherMember?.name ?? c.title, imageUrl: c.otherMember?.avatar, size: size);
  }

  @override
  Widget build(BuildContext context) {
    if (icon != null) {
      return Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: gradient!),
        ),
        child: Icon(icon, color: Colors.white, size: size * 0.5),
      );
    }
    final fallback = InitialsAvatar(name: name, size: size);
    if (imageUrl == null) return fallback;
    return ClipOval(
      child: CachedNetworkImage(
        imageUrl: imageUrl!,
        width: size,
        height: size,
        fit: BoxFit.cover,
        placeholder: (_, __) => fallback,
        errorWidget: (_, __, ___) => fallback,
      ),
    );
  }
}

/// Brand pill with a count (unread).
class CountBadge extends StatelessWidget {
  final int count;
  final bool muted;
  const CountBadge(this.count, {super.key, this.muted = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 20),
      height: 20,
      padding: const EdgeInsets.symmetric(horizontal: 6),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: muted ? AppColors.ink300 : AppColors.brand,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(count > 99 ? '99+' : '$count',
          style: AppType.body(11, weight: FontWeight.w700, color: Colors.white, height: 1.1)),
    );
  }
}

/// Multi-select list of people (new group, add members).
class ContactPicker extends StatefulWidget {
  final List<ChatUser> people;
  final Set<String> selected;
  final ValueChanged<Set<String>> onChanged;
  const ContactPicker({super.key, required this.people, required this.selected, required this.onChanged});

  @override
  State<ContactPicker> createState() => _ContactPickerState();
}

class _ContactPickerState extends State<ContactPicker> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final list = widget.people
        .where((p) => _q.isEmpty || p.name.toLowerCase().contains(_q) || p.email.toLowerCase().contains(_q))
        .toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextField(
          onChanged: (v) => setState(() => _q = v.trim().toLowerCase()),
          decoration: const InputDecoration(hintText: 'Search people', prefixIcon: Icon(Icons.search_rounded)),
        ),
      ),
      if (list.isEmpty)
        const EmptyState(icon: Icons.person_search_rounded, title: 'No one found', message: 'Try another name.')
      else
        GroupedSection(
          separatorInset: 68,
          children: [
            for (final p in list)
              ListRow(
                leading: ChatAvatar(name: p.name, imageUrl: p.avatar, size: 40),
                title: p.name,
                subtitle: [if (p.roleLabel.isNotEmpty) p.roleLabel, p.email].join(' · '),
                trailing: Icon(
                  widget.selected.contains(p.id) ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
                  color: widget.selected.contains(p.id) ? AppColors.brand : AppColors.ink300,
                ),
                onTap: () {
                  final next = {...widget.selected};
                  next.contains(p.id) ? next.remove(p.id) : next.add(p.id);
                  widget.onChanged(next);
                },
              ),
          ],
        ),
    ]);
  }
}
