import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/storage.dart';
import '../../providers/auth_provider.dart';
import '../../providers/modules_provider.dart';
import '../../ui/ui.dart';
import '../data/attendee_api.dart';
import '../models/poll.dart';
import '../providers/explore_providers.dart';
import '../providers/pass_providers.dart';
import '../widgets/attendee_widgets.dart';
import 'profile_screen.dart' show openSignIn;

/// One poll: pick candidate(s) and vote. Uses the existing public voting API:
/// ticket polls vote with the pass saved on this phone (or a typed ticket
/// code), contact polls with a phone / email, open polls once per device.
/// Signed-in users whose account can vote (`viewer.can_vote_with_account`)
/// just pick and vote; polls they already voted in show their picks.
class PollScreen extends ConsumerStatefulWidget {
  final String slug;
  final String pollId;
  final Poll? initial;
  const PollScreen({super.key, required this.slug, required this.pollId, this.initial});

  @override
  ConsumerState<PollScreen> createState() => _PollScreenState();
}

class _PollScreenState extends ConsumerState<PollScreen> {
  Poll? _poll;
  Object? _error;
  bool _loading = false;
  final Set<String> _picked = {};
  final _ticketCtrl = TextEditingController();
  final _contactCtrl = TextEditingController();
  bool _voting = false;
  String? _doneMessage;

  @override
  void initState() {
    super.initState();
    _poll = widget.initial;
    final user = ref.read(authProvider).user;
    if (user != null) _contactCtrl.text = user.email;
    _load();
  }

  @override
  void dispose() {
    _ticketCtrl.dispose();
    _contactCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final p = await ref.read(attendeeApiProvider).poll(widget.slug, widget.pollId);
      if (mounted) {
        setState(() {
          _poll = p;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        noteModuleDisabled(ref, e);
        setState(() => _error = e);
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _vote() async {
    final poll = _poll!;
    if (_picked.isEmpty) {
      AppToast.error(context, 'Pick who you\'re voting for');
      return;
    }
    final pass = ref.read(passForEventProvider(widget.slug));
    String? ticketCode, contact, deviceId;
    final byAccount = _byAccount(poll);
    if (!byAccount) {
      switch (poll.voteMode) {
        case 'ticket':
          ticketCode = pass?.qrToken ?? _ticketCtrl.text.trim();
          if (ticketCode.isEmpty) {
            AppToast.error(context, 'Enter the ticket code from your pass');
            return;
          }
        case 'contact':
          contact = _contactCtrl.text.trim();
          if (contact.isEmpty) {
            AppToast.error(context, 'Enter your phone number or email');
            return;
          }
        case 'account':
          AppToast.error(context, 'Sign in to vote');
          return;
        default:
          deviceId = await AppStorage.getDeviceId();
      }
    }
    if (!mounted) return;
    FocusScope.of(context).unfocus();
    setState(() => _voting = true);
    try {
      final r = await ref.read(attendeeApiProvider).vote(
            widget.slug,
            poll.id,
            candidateIds: _picked.toList(),
            ticketCode: ticketCode,
            contact: contact,
            deviceId: deviceId,
          );
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      setState(() {
        _doneMessage = r.message;
        if (r.poll != null) _poll = r.poll;
      });
      ref.invalidate(eventPollsProvider(widget.slug));
      AppToast.success(context, r.message);
    } catch (e) {
      if (!mounted) return;
      noteModuleDisabled(ref, e);
      AppToast.error(context, friendlyError(e));
    } finally {
      if (mounted) setState(() => _voting = false);
    }
  }

  bool _byAccount(Poll poll) =>
      ref.read(authProvider).user != null &&
      ((poll.viewer?.canVoteWithAccount ?? false) || poll.voteMode == 'account') &&
      poll.voteMode != 'open';

  @override
  Widget build(BuildContext context) {
    final poll = _poll;
    if (poll == null) {
      return AppScaffold(
        title: 'Live voting',
        slivers: [
          SliverFillRemaining(
            hasScrollBody: false,
            child: _error != null
                ? AsyncErrorView(error: _error!, onRetry: _load, title: "Couldn't load this poll")
                : const Center(child: CircularProgressIndicator()),
          ),
        ],
      );
    }

    final pass = ref.watch(passForEventProvider(widget.slug));
    final voted = poll.viewer?.hasVoted == true;
    final canVote = poll.isOpen && _doneMessage == null && !voted;
    final multi = poll.maxChoices > 1;

    return AppScaffold(
      title: 'Live voting',
      onRefresh: _load,
      bottomBar: canVote
          ? PrimaryButton(
              label: _picked.isEmpty ? 'Pick ${multi ? 'up to ${poll.maxChoices}' : 'one'}' : 'Vote',
              icon: Icons.how_to_vote_rounded,
              loading: _voting,
              onPressed: _picked.isEmpty ? null : _vote,
            )
          : null,
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(4, 0, 4, 20),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                StatusBadge(
                  poll.isOpen ? 'Open' : (poll.isScheduled ? 'Opens soon' : 'Closed'),
                  tone: poll.isOpen ? Tone.success : (poll.isScheduled ? Tone.warning : Tone.neutral),
                  dot: poll.isOpen,
                ),
                if (_loading) ...[
                  const SizedBox(width: 8),
                  const SizedBox.square(dimension: 14, child: CircularProgressIndicator(strokeWidth: 2)),
                ],
              ]),
              const SizedBox(height: 10),
              Text(poll.title, style: AppType.heading(24, weight: FontWeight.w800)),
              if (poll.description.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(poll.description, style: AppType.body(15, color: AppColors.textSecondary)),
              ],
              if (poll.resultsVisible && poll.totalVotes != null) ...[
                const SizedBox(height: 6),
                Text('${poll.totalVotes} votes so far', style: AppType.caption),
              ],
            ]),
          ),
        ),
        if (_doneMessage == null && voted)
          SliverToBoxAdapter(
            child: Container(
              margin: const EdgeInsets.only(bottom: 20),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: AppColors.successTint, borderRadius: BorderRadius.circular(14)),
              child: Row(children: [
                const Icon(Icons.how_to_vote_rounded, color: AppColors.success),
                const SizedBox(width: 10),
                Expanded(child: Text('You\'ve voted in this poll.', style: AppType.body(14, weight: FontWeight.w600))),
              ]),
            ),
          ),
        if (_doneMessage != null)
          SliverToBoxAdapter(
            child: Container(
              margin: const EdgeInsets.only(bottom: 20),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: AppColors.successTint, borderRadius: BorderRadius.circular(14)),
              child: Row(children: [
                const Icon(Icons.check_circle_rounded, color: AppColors.success),
                const SizedBox(width: 10),
                Expanded(child: Text(_doneMessage!, style: AppType.body(14, weight: FontWeight.w600))),
              ]),
            ),
          ),
        SliverToBoxAdapter(
          child: GroupedSection(
            header: canVote ? (multi ? 'Pick up to ${poll.maxChoices}' : 'Pick one') : 'Candidates',
            separatorInset: 72,
            children: [
              for (final c in poll.candidates)
                _CandidateRow(
                  candidate: c,
                  showResults: poll.resultsVisible,
                  selected: _picked.contains(c.id) || (poll.viewer?.candidateIds.contains(c.id) ?? false),
                  multi: multi,
                  onTap: !canVote
                      ? null
                      : () => setState(() {
                            if (_picked.contains(c.id)) {
                              _picked.remove(c.id);
                            } else if (!multi) {
                              _picked
                                ..clear()
                                ..add(c.id);
                            } else if (_picked.length < poll.maxChoices) {
                              _picked.add(c.id);
                            } else {
                              AppToast.info(context, 'You can pick up to ${poll.maxChoices}');
                            }
                          }),
                ),
            ],
          ),
        ),
        if (canVote) SliverToBoxAdapter(child: _voterSection(poll, pass?.ticketNumber)),
      ],
    );
  }

  Widget _voterSection(Poll poll, String? passCode) {
    if (_byAccount(poll)) {
      return GroupedSection(
        header: 'Voting with your account',
        footer: switch (poll.voteMode) {
          'ticket' => 'Uses the ticket on your account.${poll.requireCheckedIn ? ' It must be scanned at the gate first.' : ''}',
          'account' => 'Each account counts as one voter.',
          _ => 'Uses your verified email. One vote per person.',
        },
        children: [
          ListRow(
            leading: const RowIcon(Icons.verified_user_rounded, background: AppColors.success),
            title: ref.read(authProvider).user?.email ?? 'Your account',
          ),
        ],
      );
    }
    switch (poll.voteMode) {
      case 'ticket':
        if (passCode != null) {
          return GroupedSection(
            header: 'Voting with your ticket',
            footer: poll.requireCheckedIn ? 'Your ticket must be scanned at the gate before you can vote.' : null,
            children: [
              ListRow(
                leading: const RowIcon(Icons.confirmation_number_rounded, background: AppColors.success),
                title: passCode,
                subtitle: 'Saved on this phone',
              ),
            ],
          );
        }
        return GroupedSection(
          header: 'Your ticket',
          footer: 'One vote per ticket. Enter the code printed under the QR on your pass.'
              '${poll.requireCheckedIn ? ' Your ticket must be scanned at the gate first.' : ''}',
          children: [
            FieldRow(
              controller: _ticketCtrl,
              label: 'Ticket code',
              icon: Icons.confirmation_number_outlined,
              textCapitalization: TextCapitalization.characters,
            ),
          ],
        );
      case 'contact':
        return GroupedSection(
          header: 'Your phone or email',
          footer: 'One vote per phone number or email. It is only used to stop duplicate votes.',
          children: [
            FieldRow(
              controller: _contactCtrl,
              label: 'Phone or email',
              icon: Icons.alternate_email_rounded,
              keyboardType: TextInputType.emailAddress,
            ),
          ],
        );
      case 'account':
        // Signed in: handled above (viewer.can_vote_with_account). Signed out: sign in first.
        return GroupedSection(
          header: 'Sign in to vote',
          footer: 'Each Eventlaya account counts as one voter.',
          children: [
            ListRow(
              leading: const RowIcon(Icons.login_rounded),
              title: 'Sign in or create an account',
              chevron: true,
              onTap: () async {
                if (await openSignIn(context)) _load();
              },
            ),
          ],
        );
      default:
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Text('One vote per phone.', style: AppType.caption),
        );
    }
  }
}

class _CandidateRow extends StatelessWidget {
  final PollCandidate candidate;
  final bool showResults;
  final bool selected;
  final bool multi;
  final VoidCallback? onTap;
  const _CandidateRow({
    required this.candidate,
    required this.showResults,
    required this.selected,
    required this.multi,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = candidate;
    final pct = (c.percentage ?? 0) / 100;
    return ListRow(
      leading: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: SizedBox(
          width: 44,
          height: 44,
          child: c.photoUrl == null
              ? InitialsAvatar(name: c.name, size: 44)
              : NetImage(url: c.photoUrl, icon: Icons.person_rounded),
        ),
      ),
      title: c.name,
      subtitleWidget: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        if (c.subtitle.isNotEmpty)
          Text(c.subtitle, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppType.rowSubtitle),
        if (showResults && c.percentage != null) ...[
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: pct.clamp(0.0, 1.0),
              minHeight: 5,
              color: AppColors.brand,
              backgroundColor: AppColors.ink100,
            ),
          ),
          const SizedBox(height: 2),
          Text('${c.percentage!.toStringAsFixed(c.percentage! % 1 == 0 ? 0 : 1)}% · ${c.votes ?? 0} votes',
              style: AppType.caption),
        ],
      ]),
      trailing: onTap == null
          ? (selected ? const Icon(Icons.check_circle_rounded, color: AppColors.success) : null)
          : Icon(
              selected
                  ? (multi ? Icons.check_box_rounded : Icons.radio_button_checked_rounded)
                  : (multi ? Icons.check_box_outline_blank_rounded : Icons.radio_button_off_rounded),
              color: selected ? AppColors.brand : AppColors.ink300,
            ),
      onTap: onTap,
    );
  }
}
