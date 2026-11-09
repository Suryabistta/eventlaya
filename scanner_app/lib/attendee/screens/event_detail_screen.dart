import 'dart:ui';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/event_model.dart';
import '../../providers/modules_provider.dart';
import '../../reviews/review_models.dart';
import '../../reviews/review_widgets.dart';
import '../../screens/common/event_phase.dart';
import '../../screens/common/format.dart';
import '../../ui/ui.dart';
import '../models/contest.dart';
import '../models/poll.dart';
import '../models/public_event.dart';
import '../models/stored_pass.dart';
import '../providers/explore_providers.dart';
import '../providers/pass_providers.dart';
import '../widgets/attendee_widgets.dart';
import '../widgets/contest_widgets.dart';
import 'contest_screen.dart';
import 'pass_view_screen.dart';
import 'poll_screen.dart';
import 'register_screen.dart';

/// Public event page: details, tickets, live voting and the Register button.
class EventDetailScreen extends ConsumerWidget {
  final String slug;

  /// List data shown while the full event loads.
  final PublicEvent? preview;
  const EventDetailScreen({super.key, required this.slug, this.preview});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(eventDetailProvider(slug));
    final detail = async.valueOrNull;
    final event = detail?.event ?? preview;
    // Every saved pass for this event, the buyer's own first.
    final passes = ref.watch(passesForEventProvider(slug));
    final pass = passes.firstOrNull;

    Future<void> refresh() async {
      ref.invalidate(eventDetailProvider(slug));
      ref.invalidate(eventPollsProvider(slug));
      try {
        await ref.read(eventDetailProvider(slug).future);
      } catch (_) {
        // Shown by the page's error state.
      }
    }

    if (event == null) {
      return Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(
          leading: const BackButton(color: AppColors.brand),
        ),
        body: async.hasError
            ? AsyncErrorView(
                title: _notFound(async.error!) ? 'Event not found' : "Couldn't load this event",
                error: async.error!,
                onRetry: () => ref.invalidate(eventDetailProvider(slug)),
              )
            : const Center(child: CircularProgressIndicator()),
      );
    }

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        backgroundColor: AppColors.background,
        bottomNavigationBar: _RegisterBar(event: event, detail: detail, passes: passes, loading: async.isLoading),
        body: LayoutBuilder(builder: (context, constraints) {
          final gutter = AppScaffold.gutterFor(constraints.maxWidth);
          return RefreshIndicator(
            color: AppColors.brand,
            edgeOffset: MediaQuery.paddingOf(context).top,
            onRefresh: refresh,
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
              slivers: [
                _BannerHeader(event: event),
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(gutter, 20, gutter, 24),
                  sliver: SliverList.list(children: [
                    _TitleBlock(event: event),
                    const SizedBox(height: 20),
                    if (pass != null) ...[
                      _YourPassCard(passes: passes),
                      const SizedBox(height: 16),
                    ],
                    if (async.hasError && detail == null) ...[
                      const _InlineNotice(
                        icon: Icons.cloud_off_rounded,
                        text: "Couldn't load all details. Pull down to try again.",
                      ),
                      const SizedBox(height: 16),
                    ],
                    _VotingCard(slug: slug, pass: pass),
                    _InfoSection(event: event),
                    if (event.parent != null)
                      GroupedSection(children: [
                        ListRow(
                          leading: const RowIcon(Icons.account_tree_rounded),
                          title: event.parent!.$1,
                          subtitle: 'Part of this event',
                          chevron: true,
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => EventDetailScreen(slug: event.parent!.$2)),
                          ),
                        ),
                      ]),
                    if (event.subEvents.isNotEmpty)
                      GroupedSection(
                        header: 'Sub-events',
                        footer: 'Each has its own registration.',
                        children: [
                          for (final s in event.subEvents)
                            ListRow(
                              title: s.title,
                              subtitle: [
                                if (s.startDate != null) Fmt.date(s.startDate),
                                if (s.location.isNotEmpty) s.location,
                                s.registrationOpen ? 'Bookings open' : 'Bookings closed',
                              ].join(' · '),
                              chevron: true,
                              onTap: () => Navigator.of(context).push(
                                MaterialPageRoute(builder: (_) => EventDetailScreen(slug: s.slug)),
                              ),
                            ),
                        ],
                      ),
                    if ((event.description ?? '').trim().isNotEmpty)
                      GroupedSection(
                        header: 'About',
                        children: [
                          Padding(
                            padding: const EdgeInsets.all(16),
                            child: Text(event.description!.trim(), style: AppType.body(15, height: 1.55)),
                          ),
                        ],
                      ),
                    if (event.highlights.isNotEmpty)
                      GroupedSection(
                        header: 'Highlights',
                        children: [
                          for (final h in event.highlights)
                            ListRow(
                              leading: const Icon(Icons.check_rounded, color: AppColors.brand, size: 20),
                              title: h,
                            ),
                        ],
                      ),
                    if (event.ticketTypes.isNotEmpty) _TicketsSection(event: event),
                    if (event.agenda.isNotEmpty) _AgendaSection(items: event.agenda),
                    if (event.speakers.isNotEmpty)
                      GroupedSection(
                        header: 'Speakers',
                        separatorInset: 68,
                        children: [
                          for (final s in event.speakers)
                            ListRow(
                              leading: ClipOval(
                                child: SizedBox(
                                  width: 40,
                                  height: 40,
                                  child: s.photoUrl == null
                                      ? InitialsAvatar(name: s.name)
                                      : NetImage(url: s.photoUrl, icon: Icons.person_rounded),
                                ),
                              ),
                              title: s.name,
                              subtitle: [s.role, s.organization].where((x) => x.isNotEmpty).join(' · '),
                            ),
                        ],
                      ),
                    if (event.faqs.isNotEmpty)
                      GroupedSection(
                        header: 'Questions',
                        children: [
                          for (final f in event.faqs)
                            Theme(
                              data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                              child: ExpansionTile(
                                title: Text(f.question, style: AppType.rowTitle),
                                iconColor: AppColors.brand,
                                collapsedIconColor: AppColors.ink400,
                                childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
                                expandedCrossAxisAlignment: CrossAxisAlignment.start,
                                children: [Text(f.answer, style: AppType.body(14, color: AppColors.textSecondary))],
                              ),
                            ),
                        ],
                      ),
                    if (event.terms != null)
                      GroupedSection(
                        header: 'Terms & conditions',
                        children: [
                          Padding(
                            padding: const EdgeInsets.all(16),
                            child: Text(event.terms!, style: AppType.body(14, height: 1.55, color: AppColors.textSecondary)),
                          ),
                        ],
                      ),
                    if (event.phase == EventPhase.live || event.phase == EventPhase.ended)
                      ReviewsSection(target: ReviewTarget.event(event.slug, event.title), hideWhenEmpty: true),
                    if (event.contactEmail != null || event.contactPhone != null)
                      GroupedSection(
                        header: 'Contact the organizer',
                        footer: 'Tap to copy.',
                        separatorInset: 58,
                        children: [
                          if (event.contactPhone != null)
                            _CopyRow(icon: Icons.call_rounded, label: 'Phone', value: event.contactPhone!),
                          if (event.contactEmail != null)
                            _CopyRow(icon: Icons.mail_rounded, label: 'Email', value: event.contactEmail!),
                        ],
                      ),
                  ]),
                ),
              ],
            ),
          );
        }),
      ),
    );
  }

  static bool _notFound(Object e) => e is DioException && e.response?.statusCode == 404;
}

class _BannerHeader extends StatelessWidget {
  final PublicEvent event;
  const _BannerHeader({required this.event});

  @override
  Widget build(BuildContext context) {
    final topPad = MediaQuery.paddingOf(context).top;
    return SliverAppBar(
      pinned: true,
      stretch: true,
      expandedHeight: 240 + topPad * 0.3,
      backgroundColor: AppColors.brandDark,
      foregroundColor: Colors.white,
      systemOverlayStyle: SystemUiOverlayStyle.light,
      leading: Padding(
        padding: const EdgeInsets.all(6),
        child: _GlassCircle(
          child: IconButton(
            tooltip: 'Back',
            icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18, color: Colors.white),
            onPressed: () => Navigator.of(context).maybePop(),
          ),
        ),
      ),
      flexibleSpace: FlexibleSpaceBar(
        stretchModes: const [StretchMode.zoomBackground],
        background: Stack(
          fit: StackFit.expand,
          children: [
            NetImage(url: event.bannerUrl, icon: categoryIcon(event.category)),
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Color(0x66110D17), Color(0x00110D17), Color(0x88110D17)],
                  stops: [0, 0.4, 1],
                ),
              ),
            ),
            Positioned(left: 16, bottom: 16, child: EventPhaseChip(event.base)),
            if (event.category != null && event.category != 'other')
              Positioned(right: 16, bottom: 16, child: GlassChip(event.categoryLabel)),
          ],
        ),
      ),
    );
  }
}

class _GlassCircle extends StatelessWidget {
  final Widget child;
  const _GlassCircle({required this.child});

  @override
  Widget build(BuildContext context) {
    return ClipOval(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
        child: ColoredBox(color: AppColors.ink950.withValues(alpha: 0.3), child: child),
      ),
    );
  }
}

class _TitleBlock extends StatelessWidget {
  final PublicEvent event;
  const _TitleBlock({required this.event});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(eventWhen(event.base).toUpperCase(),
              style: AppType.body(12.5, weight: FontWeight.w600, color: AppColors.brand)),
          const SizedBox(height: 6),
          Text(event.title, style: AppType.heading(28, weight: FontWeight.w800)),
          if (event.tagline != null) ...[
            const SizedBox(height: 6),
            Text(event.tagline!, style: AppType.body(15, color: AppColors.textSecondary)),
          ],
          if (event.organizerName.isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(children: [
              Flexible(child: Text('by ${event.organizerName}', style: AppType.body(13, weight: FontWeight.w500, color: AppColors.ink600))),
              if (event.organizerVerified) ...[
                const SizedBox(width: 4),
                const Icon(Icons.verified_rounded, size: 16, color: AppColors.verified, semanticLabel: 'Verified by Eventlaya'),
              ],
            ]),
          ],
        ],
      ),
    );
  }
}

class _InfoSection extends StatelessWidget {
  final PublicEvent event;
  const _InfoSection({required this.event});

  @override
  Widget build(BuildContext context) {
    final e = event;
    final notice = PhaseCopy.startsIn(e.base, DateTime.now());
    return GroupedSection(
      separatorInset: 58,
      children: [
        ListRow(
          leading: const RowIcon(Icons.calendar_month_rounded),
          title: eventWhen(e.base),
          subtitle: switch (e.phase) {
            EventPhase.live => 'Happening now',
            EventPhase.upcoming => notice,
            EventPhase.ended => 'This event has ended',
            EventPhase.cancelled => 'Cancelled by the organizer',
            EventPhase.draft => null,
          },
        ),
        ListRow(
          leading: const RowIcon(Icons.place_rounded, background: AppColors.success),
          title: e.venue,
        ),
        if (e.fullyBooked || e.spotsLeftLabel != null)
          ListRow(
            leading: const RowIcon(Icons.groups_rounded, background: AppColors.marigold),
            title: e.fullyBooked ? 'Fully booked' : e.spotsLeftLabel!,
          ),
        ListRow(
          leading: const RowIcon(Icons.payments_outlined, background: AppColors.ink600),
          title: e.priceSummary,
          subtitle: e.priceSummary == 'Free' ? null : e.paymentOptions.note,
        ),
      ],
    );
  }
}

class _TicketsSection extends StatelessWidget {
  final PublicEvent event;
  const _TicketsSection({required this.event});

  @override
  Widget build(BuildContext context) {
    return GroupedSection(
      header: 'Tickets',
      children: [
        for (final t in event.ticketTypes)
          ListRow(
            title: t.name,
            subtitle: [if (t.description.isNotEmpty) t.description, if (t.availabilityLabel != null) t.availabilityLabel!]
                .join(' · '),
            trailing: Text(
              t.priceLabel,
              style: AppType.heading(16, color: t.onSale ? AppColors.textPrimary : AppColors.ink400),
            ),
          ),
      ],
    );
  }
}

class _AgendaSection extends StatelessWidget {
  final List<AgendaItem> items;
  const _AgendaSection({required this.items});

  String _hm(String? t) => t == null || t.length < 5 ? (t ?? '') : t.substring(0, 5);

  @override
  Widget build(BuildContext context) {
    return GroupedSection(
      header: 'Agenda',
      separatorInset: 76,
      children: [
        for (final a in items)
          ListRow(
            leading: SizedBox(
              width: 52,
              child: Text(_hm(a.startTime), style: AppType.mono(13, weight: FontWeight.w600, color: AppColors.brand)),
            ),
            title: a.title,
            subtitle: [if (a.location.isNotEmpty) a.location, if (a.description.isNotEmpty) a.description].join(' · '),
          ),
      ],
    );
  }
}

class _CopyRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _CopyRow({required this.icon, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return ListRow(
      leading: RowIcon(icon, background: AppColors.ink500),
      title: value,
      subtitle: label,
      trailing: const Icon(Icons.copy_rounded, size: 18, color: AppColors.ink400),
      onTap: () {
        Clipboard.setData(ClipboardData(text: value));
        AppToast.success(context, '$label copied');
      },
    );
  }
}

class _InlineNotice extends StatelessWidget {
  final IconData icon;
  final String text;
  const _InlineNotice({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Tone.warning.tint,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.marigold.withValues(alpha: 0.35), width: 0.5),
      ),
      child: Row(children: [
        Icon(icon, size: 18, color: AppColors.marigoldDark),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: AppType.body(13, weight: FontWeight.w500, color: AppColors.ink800))),
      ]),
    );
  }
}

/// "You're going" card linking to the saved pass(es): the buyer's first,
/// swipe to the guests'.
class _YourPassCard extends StatelessWidget {
  final List<StoredPass> passes;
  const _YourPassCard({required this.passes});

  @override
  Widget build(BuildContext context) {
    final pass = passes.first;
    final types = <String>{for (final p in passes) if (p.ticketTypeName.isNotEmpty) p.ticketTypeName};
    final subtitle = passes.length == 1
        ? [if (pass.ticketTypeName.isNotEmpty) pass.ticketTypeName, pass.ticketNumber].join(' · ')
        : ['${passes.length} passes', if (types.isNotEmpty) types.join(', ')].join(' · ');
    return Material(
      color: AppColors.successTint,
      borderRadius: BorderRadius.circular(AppRadius.lg + 2),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.lg + 2),
        onTap: () => openPasses(context, passes),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(color: AppColors.success, borderRadius: BorderRadius.circular(12)),
              child: const Icon(Icons.qr_code_2_rounded, color: Colors.white),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text("You're going", style: AppType.heading(17)),
                Text(subtitle, style: AppType.rowSubtitle),
              ]),
            ),
            const Icon(Icons.chevron_right_rounded, color: AppColors.success),
          ]),
        ),
      ),
    );
  }
}

/// Voting card: contests (pageants, awards) and quick polls, when the voting module is on.
/// Contests show their status and countdown; closed contests stay listed for their results.
class _VotingCard extends ConsumerWidget {
  final String slug;
  final StoredPass? pass;
  const _VotingCard({required this.slug, required this.pass});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(moduleEnabledProvider(AppModule.voting))) return const SizedBox.shrink();
    final contestsOn = ref.watch(moduleEnabledProvider(AppModule.contests));
    final voting = ref.watch(eventPollsProvider(slug));
    ref.listen(eventPollsProvider(slug), (_, next) {
      if (next.hasError) noteModuleDisabled(ref, next.error!);
    });
    final data = voting.valueOrNull;
    final polls = (data?.polls ?? const <Poll>[]).where((p) => !p.isClosed).toList();
    final contests = contestsOn ? (data?.contests ?? const <Contest>[]) : const <Contest>[];
    if (polls.isEmpty && contests.isEmpty) return const SizedBox.shrink();
    final anyOpen = polls.any((p) => p.isOpen) || contests.any((c) => c.isOpen && c.acceptingVotes);
    final title = contests.isNotEmpty && polls.isEmpty
        ? (contests.length == 1 ? 'Contest' : 'Contests')
        : 'Live voting';

    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Container(
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF3D3547), AppColors.ink900],
          ),
          borderRadius: BorderRadius.circular(AppRadius.xl),
        ),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(contests.isNotEmpty ? Icons.emoji_events_rounded : Icons.how_to_vote_rounded, color: Colors.white, size: 22),
              const SizedBox(width: 8),
              Expanded(child: Text(title, style: AppType.heading(18, color: Colors.white))),
              if (anyOpen) const StatusBadge('Open', tone: Tone.success, onDark: true),
            ]),
            const SizedBox(height: 4),
            Text(
              anyOpen
                  ? (contests.isNotEmpty ? 'Cast your vote — pick your favourite and share them.' : 'Cast your vote now — results update live.')
                  : (contests.any((c) => c.isScheduled) || polls.any((p) => p.isScheduled) ? 'Voting opens soon.' : 'See the results.'),
              style: AppType.body(13, color: AppColors.ink300),
            ),
            const SizedBox(height: 6),
            for (final c in contests)
              ContestTeaser(
                contest: c,
                onTap: () => openContest(context, eventSlug: slug, ref: c.ref, preview: c),
              ),
            for (final p in polls)
              InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => PollScreen(slug: slug, pollId: p.id, initial: p)),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(p.title, style: AppType.body(15, weight: FontWeight.w600, color: Colors.white)),
                        Text(
                          '${p.candidates.length} options · ${p.isOpen ? 'Open' : 'Opens soon'}',
                          style: AppType.body(12, color: AppColors.ink300),
                        ),
                      ]),
                    ),
                    const Icon(Icons.chevron_right_rounded, color: Colors.white),
                  ]),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Frosted bottom bar: Register / View my pass / why registration is closed.
class _RegisterBar extends StatelessWidget {
  final PublicEvent event;
  final EventDetail? detail;
  final List<StoredPass> passes;
  final bool loading;
  const _RegisterBar({required this.event, required this.detail, required this.passes, required this.loading});

  @override
  Widget build(BuildContext context) {
    Widget content;
    if (passes.isNotEmpty) {
      // Already going: open the passes, and (ticketed events still selling)
      // get more tickets as a new order.
      final canGetMore = detail != null &&
          event.registrationOpen &&
          !event.fullyBooked &&
          detail!.event.ticketTypes.any((t) => t.onSale);
      content = Row(children: [
        Expanded(
          child: PrimaryButton(
            label: passes.length == 1 ? 'View my pass' : 'My passes (${passes.length})',
            icon: Icons.qr_code_2_rounded,
            onPressed: () => openPasses(context, passes),
          ),
        ),
        if (canGetMore) ...[
          const SizedBox(width: 8),
          PrimaryButton(
            label: 'Get more',
            icon: Icons.add_rounded,
            expand: false,
            tonal: true,
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => RegisterScreen(event: detail!.event, form: detail!.form, additional: true),
            )),
          ),
        ],
      ]);
    } else if (!event.registrationOpen) {
      content = Row(children: [
        const Icon(Icons.info_outline_rounded, color: AppColors.ink500, size: 20),
        const SizedBox(width: 8),
        Expanded(
          child: Text(event.registrationClosedReason ?? 'Bookings are closed.',
              style: AppType.body(14, weight: FontWeight.w500, color: AppColors.ink700)),
        ),
      ]);
    } else {
      final soldOut = detail != null && event.fullyBooked;
      content = Row(children: [
        Expanded(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(event.priceSummary, style: AppType.heading(19)),
            Text(soldOut ? 'Fully booked' : (event.priceSummary == 'Free' ? 'Free' : event.paymentOptions.shortNote),
                style: AppType.caption, maxLines: 1, overflow: TextOverflow.ellipsis),
          ]),
        ),
        PrimaryButton(
          label: soldOut ? 'Full' : (event.registrationOnly ? 'Register' : event.priceSummary == 'Free' ? 'Book a spot' : 'Get tickets'),
          expand: false,
          loading: detail == null && loading,
          onPressed: detail == null || soldOut
              ? null
              : () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => RegisterScreen(event: detail!.event, form: detail!.form),
                  )),
        ),
      ]);
    }

    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.ink50.withValues(alpha: 0.9),
            border: const Border(top: BorderSide(color: AppColors.separator, width: 0.5)),
          ),
          child: SafeArea(
            top: false,
            child: LayoutBuilder(builder: (context, c) {
              final gutter = AppScaffold.gutterFor(c.maxWidth);
              return Padding(padding: EdgeInsets.fromLTRB(gutter, 12, gutter, 12), child: content);
            }),
          ),
        ),
      ),
    );
  }
}
