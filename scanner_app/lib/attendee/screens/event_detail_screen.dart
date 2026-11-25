import 'dart:ui';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/bs_date.dart';
import '../../core/legal.dart';
import '../../models/event_model.dart';
import '../../providers/modules_provider.dart';
import '../../reviews/review_models.dart';
import '../../reviews/review_widgets.dart';
import '../../screens/common/event_phase.dart';
import '../../screens/common/format.dart';
import '../../ui/ui.dart';
import '../data/favourites.dart';
import '../models/contest.dart';
import '../models/poll.dart';
import '../models/public_event.dart';
import '../models/stored_pass.dart';
import '../providers/explore_providers.dart';
import '../providers/pass_providers.dart';
import '../widgets/attendee_widgets.dart';
import '../widgets/contest_widgets.dart';
import '../widgets/listing_widgets.dart';
import 'apply_screen.dart';
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
            : const DetailSkeleton(),
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
                    _TitleCard(event: event),
                    const SizedBox(height: 14),
                    _EventActions(event: event),
                    const SizedBox(height: 16),
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
                    // While applying is the only way in, the Apply bar says it all: no step timeline
                    if (event.stages.length > 1 && !event.applyFirst)
                      GroupedSection(
                        header: 'Stages',
                        children: [
                          for (final st in event.stages)
                            ListRow(
                              leading: Icon(
                                st.kind == 'applications'
                                    ? Icons.assignment_outlined
                                    : st.kind == 'voting'
                                        ? Icons.how_to_vote_outlined
                                        : Icons.event_outlined,
                                color: st.isOpen ? AppColors.brand : AppColors.ink400,
                              ),
                              title: st.title,
                              subtitle: switch (st.state) {
                                'open' => st.closesAt != null ? 'Open until ${BsDate.format('d MMM', st.closesAt!)}' : 'Open now',
                                'closed' => 'Closed',
                                _ => st.kind == 'tickets'
                                    ? (st.date != null ? BsDate.format('d MMM y', st.date!) : 'Date to be announced')
                                    : (st.opensAt != null ? 'Opens ${BsDate.format('d MMM', st.opensAt!)}' : 'Coming up'),
                              },
                            ),
                        ],
                      ),
                    if ((event.description ?? '').trim().isNotEmpty)
                      ListingSection(
                        title: 'About',
                        child: Text(event.description!.trim(), style: AppType.body(15, height: 1.6, color: AppColors.ink700)),
                      ),
                    if (event.highlights.isNotEmpty)
                      ListingSection(
                        title: 'Highlights',
                        child: Column(children: [
                          for (final h in event.highlights)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 5),
                              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Container(
                                  width: 22,
                                  height: 22,
                                  decoration: const BoxDecoration(color: AppColors.brandTint, shape: BoxShape.circle),
                                  child: const Icon(Icons.check_rounded, color: AppColors.brand, size: 15),
                                ),
                                const SizedBox(width: 10),
                                Expanded(child: Text(h, style: AppType.body(14.5))),
                              ]),
                            ),
                        ]),
                      ),
                    if (event.ticketTypes.isNotEmpty && !event.registrationOnly && event.externalRegisterUrl == null)
                      _TicketsSection(event: event, detail: detail),
                    const SizedBox(height: 8),
                    if (event.agenda.isNotEmpty) _AgendaSection(items: event.agenda),
                    if (event.speakers.isNotEmpty)
                      GroupedSection(
                        header: event.speakersLabel ?? 'Speakers',
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
                      ListingSection(
                        title: 'Terms & conditions',
                        child: Text(event.terms!, style: AppType.body(14, height: 1.55, color: AppColors.textSecondary)),
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
      actions: [
        Padding(
          padding: const EdgeInsets.all(6),
          child: _GlassCircle(
            child: IconButton(
              tooltip: 'Share',
              icon: const Icon(Icons.ios_share_rounded, size: 20, color: Colors.white),
              onPressed: () => shareEvent(context, event),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(6),
          child: _GlassCircle(child: FavouriteButton(eventId: event.base.id, eventSlug: event.slug)),
        ),
      ],
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

/// Public web link of an event.
String eventWebUrl(PublicEvent e) => '${Legal.baseUrl}/e/${e.slug}';

Future<void> shareEvent(BuildContext context, PublicEvent e) async {
  HapticFeedback.selectionClick();
  final box = context.findRenderObject() as RenderBox?;
  await SharePlus.instance.share(ShareParams(
    text: '${e.title} · ${eventWhen(e.base)} · ${e.venue}\n${eventWebUrl(e)}',
    subject: e.title,
    sharePositionOrigin: box == null ? null : box.localToGlobal(Offset.zero) & box.size,
  ));
}

/// Google Calendar "add event" link (opens the Calendar app or the browser).
Uri calendarUrl(PublicEvent e) {
  final start = e.base.startsAt!;
  String stamp(DateTime d) => '${d.toUtc().toIso8601String().replaceAll(RegExp(r'[-:]'), '').split('.').first}Z';
  String day(DateTime d) => '${d.year}${d.month.toString().padLeft(2, '0')}${d.day.toString().padLeft(2, '0')}';
  final String dates;
  if (e.base.startTime == null) {
    final last = e.base.lastDay ?? start;
    dates = '${day(start)}/${day(last.add(const Duration(days: 1)))}';
  } else {
    final end = e.base.endsAt != null && e.base.endsAt!.isAfter(start) ? e.base.endsAt! : start.add(const Duration(hours: 2));
    dates = '${stamp(start)}/${stamp(end)}';
  }
  return Uri.https('calendar.google.com', '/calendar/render', {
    'action': 'TEMPLATE',
    'text': e.title,
    'dates': dates,
    'location': e.venue,
    'details': eventWebUrl(e),
  });
}

/// Title, organizer and the key facts (when · price · spots).
class _TitleCard extends StatelessWidget {
  final PublicEvent event;
  const _TitleCard({required this.event});

  @override
  Widget build(BuildContext context) {
    final e = event;
    final when = switch (e.phase) {
      EventPhase.live => 'Happening now',
      EventPhase.upcoming => PhaseCopy.startsIn(e.base, DateTime.now()),
      EventPhase.ended => 'Ended',
      EventPhase.cancelled => 'Cancelled',
      EventPhase.draft => null,
    };
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(AppRadius.xl), boxShadow: softShadow),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(e.title, style: AppType.heading(25, weight: FontWeight.w800)),
        if (e.tagline != null) ...[
          const SizedBox(height: 6),
          Text(e.tagline!, style: AppType.body(14.5, color: AppColors.textSecondary)),
        ],
        if (e.organizerName.isNotEmpty && !e.hideOrganizer) ...[
          const SizedBox(height: 10),
          Row(children: [
            InitialsAvatar(name: e.organizerName, size: 26),
            const SizedBox(width: 8),
            Flexible(
              child: Text('by ${e.organizerName}',
                  maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.body(13, weight: FontWeight.w500, color: AppColors.ink600)),
            ),
            if (e.organizerVerified) ...[
              const SizedBox(width: 4),
              const Icon(Icons.verified_rounded, size: 16, color: AppColors.verified, semanticLabel: 'Verified by Eventlaya'),
            ],
          ]),
        ],
        if (e.partnerName != null) ...[
          const SizedBox(height: 4),
          Text('${e.partnerLabel} ${e.partnerName}', style: AppType.body(13, color: AppColors.ink600)),
        ],
        const SizedBox(height: 14),
        IconLine(icon: Icons.calendar_month_outlined, text: [eventWhen(e.base), if (when != null) when].join('  ·  ')),
        const SizedBox(height: 6),
        IconLine(icon: Icons.place_outlined, text: e.venue, maxLines: 2),
        const SizedBox(height: 14),
        Row(children: [
          Expanded(
            child: FactBox(
              icon: Icons.payments_outlined,
              value: e.priceLabel,
              label: e.priceSummary == 'Free' ? 'Entry' : e.paymentOptions.shortNote,
            ),
          ),
          if (e.fullyBooked || e.spotsLeftLabel != null) ...[
            const SizedBox(width: 8),
            Expanded(
              child: FactBox(
                icon: Icons.groups_rounded,
                value: e.fullyBooked ? 'Full' : e.spotsLeftLabel!,
                label: 'Availability',
              ),
            ),
          ],
          if (e.category != null && e.category != 'other') ...[
            const SizedBox(width: 8),
            Expanded(child: FactBox(icon: categoryIcon(e.category), value: e.categoryLabel, label: 'Type')),
          ],
        ]),
      ]),
    );
  }
}

/// Directions · Add to calendar · Share · Contact.
class _EventActions extends StatelessWidget {
  final PublicEvent event;
  const _EventActions({required this.event});

  @override
  Widget build(BuildContext context) {
    final e = event;
    final upcoming = e.phase == EventPhase.upcoming || e.phase == EventPhase.live;
    final phone = e.contactPhone ?? '';
    final email = e.contactEmail ?? '';
    return ActionCircles(items: [
      if (e.venue.trim().isNotEmpty)
        ActionItem(
          Icons.directions_rounded,
          'Directions',
          () => openOrCopy(context, Uri.https('www.google.com', '/maps/search/', {'api': '1', 'query': e.venue}), e.venue, 'Address'),
          primary: true,
        ),
      if (upcoming && e.base.startsAt != null)
        ActionItem(Icons.event_available_rounded, 'Calendar', () => openOrCopy(context, calendarUrl(e), eventWebUrl(e), 'Link')),
      ActionItem(Icons.ios_share_rounded, 'Share', () => shareEvent(context, e)),
      if (phone.isNotEmpty)
        ActionItem(Icons.call_rounded, 'Call', () => openOrCopy(context, Uri(scheme: 'tel', path: phoneDigits(phone)), phone, 'Phone number'))
      else if (email.isNotEmpty)
        ActionItem(Icons.mail_rounded, 'Email', () => openOrCopy(context, Uri(scheme: 'mailto', path: email), email, 'Email')),
    ]);
  }
}

class _TicketsSection extends StatelessWidget {
  final PublicEvent event;
  final EventDetail? detail;
  const _TicketsSection({required this.event, required this.detail});

  @override
  Widget build(BuildContext context) {
    final canBook = detail != null && event.registrationOpen && !event.fullyBooked && !event.applyFirst;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(4, 18, 4, 10),
        child: Text('Tickets', style: AppType.heading(19)),
      ),
      for (final t in event.ticketTypes)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Container(
            padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppRadius.lg + 2),
              boxShadow: softShadow,
            ),
            child: Row(children: [
              Container(
                width: 42,
                height: 42,
                margin: const EdgeInsets.only(right: 12),
                decoration: BoxDecoration(
                  color: t.onSale ? AppColors.brandTint : AppColors.ink100,
                  borderRadius: BorderRadius.circular(AppRadius.md),
                ),
                child: Icon(Icons.confirmation_number_outlined, color: t.onSale ? AppColors.brand : AppColors.ink400),
              ),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(t.name, style: AppType.heading(16.5)),
                  if (t.description.isNotEmpty || t.availabilityLabel != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        [if (t.description.isNotEmpty) t.description, if (t.availabilityLabel != null) t.availabilityLabel!].join(' · '),
                        style: AppType.caption,
                      ),
                    ),
                  const SizedBox(height: 6),
                  Text(t.priceLabel,
                      style: AppType.body(15, weight: FontWeight.w700, color: t.onSale ? AppColors.brand : AppColors.ink400)),
                ]),
              ),
              if (t.onSale && canBook)
                PillButton(
                  label: 'Select',
                  dense: true,
                  filled: true,
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => RegisterScreen(event: detail!.event, form: detail!.form, preselectTicketId: t.id),
                  )),
                ),
            ]),
          ),
        ),
    ]);
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
    } else if (event.externalRegisterUrl != null && event.phase != EventPhase.ended && event.phase != EventPhase.cancelled) {
      // Superadmin set an external registration link: Register opens it in the browser
      content = Row(children: [
        Expanded(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(event.title, style: AppType.heading(17), maxLines: 1, overflow: TextOverflow.ellipsis),
            Text('Opens in your browser', style: AppType.caption, maxLines: 1),
          ]),
        ),
        PrimaryButton(
          label: event.ctaLabel ?? 'Register',
          icon: Icons.open_in_new_rounded,
          expand: false,
          onPressed: () => launchUrl(Uri.parse(event.externalRegisterUrl!), mode: LaunchMode.externalApplication),
        ),
      ]);
    } else if (event.applyFirst) {
      // Applications stage: the form (with photo and file uploads) is on the website for now
      content = Row(children: [
        Expanded(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(event.isOpenCall ? 'Free to apply' : 'Applications are open', style: AppType.body(14, weight: FontWeight.w600)),
            if (event.applicationsClose != null)
              Text('Until ${BsDate.format('d MMM y', event.applicationsClose!)}', style: AppType.caption, maxLines: 1),
          ]),
        ),
        PrimaryButton(
          label: event.applyLabel,
          expand: false,
          onPressed: () {
            final full = detail?.event ?? event;
            if (full.applicationForm == null || ApplyScreen.needsWebsite(full)) {
              openLegal(context, '/e/${event.slug}/apply'); // PDF questions need the website
            } else {
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => ApplyScreen(event: full)));
            }
          },
        ),
      ]);
    } else if (!event.registrationOpen) {
      content = Row(children: [
        const Icon(Icons.info_outline_rounded, color: AppColors.ink500, size: 20),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
              event.registrationOpensLater
                  ? 'Registration opens ${BsDate.format('d MMM y', event.registrationOpens!)}'
                  : event.registrationClosedReason ?? 'Bookings are closed.',
              style: AppType.body(14, weight: FontWeight.w500, color: AppColors.ink700)),
        ),
      ]);
    } else {
      final soldOut = detail != null && event.fullyBooked;
      content = Row(children: [
        Expanded(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(event.priceLabel, style: AppType.heading(19, color: AppColors.brand)),
            Text(soldOut ? 'Fully booked' : (event.priceSummary == 'Free' ? 'Free' : event.paymentOptions.shortNote),
                style: AppType.caption, maxLines: 1, overflow: TextOverflow.ellipsis),
          ]),
        ),
        PrimaryButton(
          label: soldOut ? 'Full' : event.ctaLabel ?? (event.isOpenCall ? 'Apply' : event.registrationOnly ? 'Register' : event.priceSummary == 'Free' ? 'Book a spot' : 'Get tickets'),
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
            color: Colors.white.withValues(alpha: 0.92),
            boxShadow: [BoxShadow(color: AppColors.ink900.withValues(alpha: 0.08), blurRadius: 20, offset: const Offset(0, -4))],
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
