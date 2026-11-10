import 'package:clock/clock.dart';
import 'package:intl/intl.dart';
import '../../core/media_url.dart';
import '../../models/ticket_type_model.dart';
import '../../payments/payment_models.dart';
import '../../core/bs_date.dart';

/// Contests / pageants from the public voting API
/// (`/api/voting/public/<event>/contests/<contest>/…`, see docs/voting.md).
/// Mirrors the web types in frontend/src/pages/voting/contest/api.ts.

String? _s(Object? v) {
  final t = v?.toString().trim();
  return (t == null || t.isEmpty) ? null : t;
}

int? _i(Object? v) => v == null ? null : int.tryParse(v.toString());
double? _d(Object? v) => v == null ? null : double.tryParse(v.toString());
DateTime? _t(Object? v) => DateTime.tryParse(v?.toString() ?? '')?.toLocal();
Map<String, dynamic> _m(Object? v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
List<Map<String, dynamic>> _ms(Object? v) => v is List ? [for (final x in v) if (x is Map) Map<String, dynamic>.from(x)] : const [];
List<String> _strs(Object? v) => v is List ? [for (final x in v) if (x != null) x.toString()] : const [];

/// Public site the share links and "vote on the website" point to.
const webBase = 'https://eventlaya.com';

/// Nepal Standard Time is UTC+5:45 all year (no daylight saving).
const nepalOffset = Duration(hours: 5, minutes: 45);

/// "Sat 1 Nov, 6:00 PM" in Nepal time, whatever the phone's time zone.
String nepalTime(DateTime t, {bool withZone = true}) {
  final npt = t.toUtc().add(nepalOffset);
  final s = BsDate.format('EEE d MMM, h:mm a', npt);
  return withZone ? '$s Nepal time' : s;
}

/// "2d 4h", "3h 12m", "4m 05s".
String countdownText(Duration d) {
  if (d.isNegative) return '0s';
  final days = d.inDays, h = d.inHours % 24, m = d.inMinutes % 60, s = d.inSeconds % 60;
  if (days > 0) return '${days}d ${h}h';
  if (d.inHours > 0) return '${d.inHours}h ${m}m';
  return '${m}m ${s.toString().padLeft(2, '0')}s';
}

class ContestRules {
  final bool freeVotesEnabled;
  final int? votesPerVoter;
  final int? votesPerDay;
  final int? votesPerRound;
  final int? votesPerContestant;

  /// 'contest', 'day' or 'round'.
  final String contestantCapPeriod;
  final bool allowSplit;
  final int maxVotesPerSubmit;
  final bool mainVoteEnabled;

  const ContestRules({
    this.freeVotesEnabled = true,
    this.votesPerVoter,
    this.votesPerDay,
    this.votesPerRound,
    this.votesPerContestant,
    this.contestantCapPeriod = 'contest',
    this.allowSplit = true,
    this.maxVotesPerSubmit = 1,
    this.mainVoteEnabled = true,
  });

  factory ContestRules.fromJson(Map<String, dynamic> j) => ContestRules(
        freeVotesEnabled: j['free_votes_enabled'] != false,
        votesPerVoter: _i(j['votes_per_voter']),
        votesPerDay: _i(j['votes_per_day']),
        votesPerRound: _i(j['votes_per_round']),
        votesPerContestant: _i(j['votes_per_contestant']),
        contestantCapPeriod: _s(j['contestant_cap_period']) ?? 'contest',
        allowSplit: j['allow_split'] != false,
        maxVotesPerSubmit: (_i(j['max_votes_per_submit']) ?? 1).clamp(1, 1000),
        mainVoteEnabled: j['main_vote_enabled'] != false,
      );

  /// "5 free votes a day, up to 20 in total" (same wording as the web).
  String get allowanceText {
    if (!freeVotesEnabled) return 'Votes come from vote packs';
    String v(int n) => '$n free ${n == 1 ? 'vote' : 'votes'}';
    final parts = <String>[
      if (votesPerDay != null && votesPerDay! > 0) '${v(votesPerDay!)} a day',
      if (votesPerRound != null && votesPerRound! > 0) '${v(votesPerRound!)} per round',
      if (votesPerVoter != null && votesPerVoter! > 0)
        (votesPerDay != null || votesPerRound != null) ? 'up to $votesPerVoter in total' : v(votesPerVoter!),
    ];
    return parts.isEmpty ? 'Unlimited free votes' : parts.join(', ');
  }

  /// "At most 3 free votes per contestant per day." or null.
  String? get contestantCapText {
    final n = votesPerContestant;
    if (n == null) return null;
    final period = switch (contestantCapPeriod) { 'day' => ' per day', 'round' => ' per round', _ => '' };
    return 'At most $n free ${n == 1 ? 'vote' : 'votes'} per contestant$period.';
  }
}

class VotePackOffer {
  final String id;
  final String label;
  final int votes;
  final int bonusVotes;
  final int totalVotes;
  final double price;
  final String currency;

  const VotePackOffer({
    required this.id,
    this.label = '',
    required this.votes,
    this.bonusVotes = 0,
    required this.totalVotes,
    required this.price,
    this.currency = 'NPR',
  });

  factory VotePackOffer.fromJson(Map<String, dynamic> j) {
    final votes = _i(j['votes']) ?? 0, bonus = _i(j['bonus_votes']) ?? 0;
    return VotePackOffer(
      id: j['id']?.toString() ?? '',
      label: _s(j['label']) ?? '',
      votes: votes,
      bonusVotes: bonus,
      totalVotes: _i(j['total_votes']) ?? votes + bonus,
      price: parseMoney(j['price']),
      currency: _s(j['currency']) ?? 'NPR',
    );
  }

  String get priceLabel => currency == 'NPR' ? formatRupees(price) : '$currency ${price.toStringAsFixed(0)}';
}

/// Paid votes (`paid` on the contest). Packs are bought only when
/// [paymentsAvailable]; otherwise they're listed as "coming soon" (or hidden).
class ContestPaid {
  final bool enabled;
  final bool paymentsAvailable;

  /// Why packs can't be bought right now ('unverified_mode', 'no_provider', 'closed'…).
  final String? reason;

  /// The server's sentence for [reason].
  final String? unavailableMessage;
  final double? pricePerVote;
  final String currency;
  final List<VotePackOffer> packs;

  /// Khalti / eSewa (/ test) offered for packs, when [paymentsAvailable].
  final List<PaymentProviderInfo> providers;

  /// Purchased votes are cast for the contestant they were bought from.
  final bool buyAndVote;

  /// "Buy any number" at [pricePerVote], 1..[maxCustomVotes].
  final bool customVotes;
  final int maxCustomVotes;

  const ContestPaid({
    this.enabled = false,
    this.paymentsAvailable = false,
    this.reason,
    this.unavailableMessage,
    this.pricePerVote,
    this.currency = 'NPR',
    this.packs = const [],
    this.providers = const [],
    this.buyAndVote = false,
    this.customVotes = false,
    this.maxCustomVotes = 1000,
  });

  factory ContestPaid.fromJson(Map<String, dynamic> j) => ContestPaid(
        enabled: j['enabled'] == true,
        paymentsAvailable: j['payments_available'] == true,
        reason: _s(j['unavailable_reason'] ?? j['reason']),
        unavailableMessage: _s(j['unavailable_message']),
        pricePerVote: _d(j['price_per_vote']),
        currency: _s(j['currency']) ?? 'NPR',
        packs: [for (final p in _ms(j['packs'])) VotePackOffer.fromJson(p)],
        providers: [for (final p in _ms(j['providers'])) PaymentProviderInfo.fromJson(p)],
        buyAndVote: j['buy_and_vote'] == true,
        customVotes: j['custom_votes'] == true && _d(j['price_per_vote']) != null,
        maxCustomVotes: (_i(j['max_custom_votes']) ?? 1000).clamp(1, 100000),
      );

  /// Packs (or any number of votes) can be bought right now.
  bool get canBuy => enabled && paymentsAvailable && (packs.isNotEmpty || customVotes);

  /// Show the packs section (disabled with [unavailableMessage] when they can't be bought).
  bool get showPacks => enabled && (packs.isNotEmpty || customVotes);

  /// Price of [votes] votes bought one by one.
  double priceFor(int votes) => (pricePerVote ?? 0) * votes;
}

class RoundBrief {
  final String id;
  final String name;
  final int order;

  /// 'upcoming', 'open' or 'closed'.
  final String status;
  final DateTime? opensAt;
  final DateTime? closesAt;
  final bool publicVoteEnabled;
  final bool judgingEnabled;
  final int? advanceCount;
  final DateTime? finalizedAt;

  const RoundBrief({
    required this.id,
    required this.name,
    this.order = 0,
    this.status = 'upcoming',
    this.opensAt,
    this.closesAt,
    this.publicVoteEnabled = true,
    this.judgingEnabled = false,
    this.advanceCount,
    this.finalizedAt,
  });

  factory RoundBrief.fromJson(Map<String, dynamic> j) => RoundBrief(
        id: j['id']?.toString() ?? '',
        name: _s(j['name']) ?? 'Round',
        order: _i(j['order']) ?? 0,
        status: _s(j['status']) ?? 'upcoming',
        opensAt: _t(j['opens_at']),
        closesAt: _t(j['closes_at']),
        publicVoteEnabled: j['public_vote_enabled'] != false,
        judgingEnabled: j['judging_enabled'] == true,
        advanceCount: _i(j['advance_count']),
        finalizedAt: _t(j['finalized_at']),
      );
}

class StandingRow {
  final String contestantId;
  final String name;
  final String displayNumber;
  final int? number;
  final String slug;
  final String? photoUrl;
  final int? rank;
  final bool tied;
  final String status;

  /// Only on level "full".
  final int? votes;
  final double? percentage;
  final double? publicScore;
  final double? judgeScore;
  final double? finalScore;

  const StandingRow({
    required this.contestantId,
    required this.name,
    this.displayNumber = '',
    this.number,
    this.slug = '',
    this.photoUrl,
    this.rank,
    this.tied = false,
    this.status = 'active',
    this.votes,
    this.percentage,
    this.publicScore,
    this.judgeScore,
    this.finalScore,
  });

  factory StandingRow.fromJson(Map<String, dynamic> j) => StandingRow(
        contestantId: j['contestant_id']?.toString() ?? '',
        name: _s(j['name']) ?? 'Contestant',
        displayNumber: _s(j['display_number']) ?? '',
        number: _i(j['number']),
        slug: _s(j['slug']) ?? '',
        photoUrl: mediaUrl(j['photo_url']),
        rank: _i(j['rank']),
        tied: j['tied'] == true,
        status: _s(j['status']) ?? 'active',
        votes: _i(j['votes']),
        percentage: _d(j['percentage']),
        publicScore: _d(j['public_score']),
        judgeScore: _d(j['judge_score']),
        finalScore: _d(j['final']),
      );

  /// Number, else slug: what contestant links use.
  String get ref => number?.toString() ?? slug;
}

/// Standings trimmed by the server to what the organizer lets the public see.
class Standings {
  /// 'full' (counts), 'ranks' (ranks only) or 'top' (top N ranks).
  final String level;
  final int? topN;
  final int? totalVotes;
  final double? judgesWeight;
  final double? publicWeight;
  final List<StandingRow> rows;

  const Standings({required this.level, this.topN, this.totalVotes, this.judgesWeight, this.publicWeight, this.rows = const []});

  factory Standings.fromJson(Map<String, dynamic> j) {
    final w = j['weights'] is Map ? _m(j['weights']) : null;
    return Standings(
      level: _s(j['level']) ?? 'full',
      topN: _i(j['top_n']),
      totalVotes: _i(j['total_votes']),
      judgesWeight: _d(w?['judges']),
      publicWeight: _d(w?['public']),
      rows: [for (final r in _ms(j['rows'])) StandingRow.fromJson(r)],
    );
  }

  static Standings? maybe(Object? v) => v is Map ? Standings.fromJson(_m(v)) : null;

  bool get full => level == 'full';

  String get summary => switch (level) {
        'full' => totalVotes == null ? 'Live results' : '${NumberFormat.decimalPattern().format(totalVotes)} votes',
        'top' => 'Top ${topN ?? 3}',
        _ => 'Ranks only',
      };
}

class ContestCategory {
  final String id;
  final String slug;
  final String name;
  final String description;

  /// 'public_vote', 'judges' or 'manual'.
  final String selection;

  /// Empty = every active contestant.
  final List<String> nominees;
  final bool votingOpen;
  final int? votesPerVoter;
  final int? votesPerDay;
  final Standings? standings;
  final String? winner;

  const ContestCategory({
    required this.id,
    this.slug = '',
    required this.name,
    this.description = '',
    this.selection = 'public_vote',
    this.nominees = const [],
    this.votingOpen = false,
    this.votesPerVoter,
    this.votesPerDay,
    this.standings,
    this.winner,
  });

  factory ContestCategory.fromJson(Map<String, dynamic> j) => ContestCategory(
        id: j['id']?.toString() ?? '',
        slug: _s(j['slug']) ?? '',
        name: _s(j['name']) ?? 'Award',
        description: _s(j['description']) ?? '',
        selection: _s(j['selection']) ?? 'public_vote',
        nominees: _strs(j['nominees']),
        votingOpen: j['voting_open'] == true,
        votesPerVoter: _i(j['votes_per_voter']),
        votesPerDay: _i(j['votes_per_day']),
        standings: Standings.maybe(j['standings']),
        winner: _s(j['winner']),
      );

  String get selectionLabel => switch (selection) {
        'judges' => 'Decided by the judges',
        'manual' => 'Chosen by the organizers',
        _ => 'Public vote',
      };

  /// "1 free vote a day" / "3 votes each" / ''.
  String get voteText {
    if (votesPerDay != null) return '$votesPerDay free ${votesPerDay == 1 ? 'vote' : 'votes'} a day';
    if (votesPerVoter != null) return '$votesPerVoter ${votesPerVoter == 1 ? 'vote' : 'votes'} each';
    return '';
  }
}

class ProfileEntry {
  final String key;
  final String label;
  final String value;
  const ProfileEntry(this.key, this.label, this.value);
}

/// Previous / next contestant on a profile.
class ContestantLink {
  final String id;
  final String name;
  final String displayNumber;
  final String slug;
  final int? number;
  const ContestantLink({required this.id, required this.name, this.displayNumber = '', this.slug = '', this.number});

  factory ContestantLink.fromJson(Map<String, dynamic> j) => ContestantLink(
        id: j['id']?.toString() ?? '',
        name: _s(j['name']) ?? '',
        displayNumber: _s(j['display_number']) ?? '',
        slug: _s(j['slug']) ?? '',
        number: _i(j['number']),
      );

  String get ref => number?.toString() ?? slug;
}

class Contestant {
  final String id;
  final int? number;
  final String displayNumber;
  final String slug;
  final String name;
  final String subtitle;
  final String? photoUrl;

  /// 'active', 'eliminated', 'withdrawn' or 'winner'.
  final String status;
  final List<String> categories;

  /// Null when the contest has no open round.
  final bool? inCurrentRound;
  final List<ProfileEntry> profile;

  // Profile page only
  final String description;
  final List<String> gallery;
  final Map<String, String> socialLinks;
  final StandingRow? standing;

  /// 'full', 'ranks', 'top' or 'none'.
  final String standingLevel;
  final ContestantLink? previous;
  final ContestantLink? next;

  const Contestant({
    required this.id,
    this.number,
    this.displayNumber = '',
    this.slug = '',
    required this.name,
    this.subtitle = '',
    this.photoUrl,
    this.status = 'active',
    this.categories = const [],
    this.inCurrentRound,
    this.profile = const [],
    this.description = '',
    this.gallery = const [],
    this.socialLinks = const {},
    this.standing,
    this.standingLevel = 'none',
    this.previous,
    this.next,
  });

  factory Contestant.fromJson(Map<String, dynamic> j) {
    final social = _m(j['social_links']);
    return Contestant(
      id: j['id']?.toString() ?? '',
      number: _i(j['number']),
      displayNumber: _s(j['display_number']) ?? '',
      slug: _s(j['slug']) ?? '',
      name: _s(j['name']) ?? 'Contestant',
      subtitle: _s(j['subtitle']) ?? '',
      photoUrl: mediaUrl(j['photo_url']),
      status: _s(j['status']) ?? 'active',
      categories: _strs(j['categories']),
      inCurrentRound: j['in_current_round'] is bool ? j['in_current_round'] as bool : null,
      profile: [
        for (final p in _ms(j['profile']))
          if (_s(p['value']) != null) ProfileEntry(p['key']?.toString() ?? '', _s(p['label']) ?? '', _s(p['value'])!),
      ],
      description: _s(j['description']) ?? '',
      gallery: [for (final g in _strs(j['gallery'])) if (mediaUrl(g) != null) mediaUrl(g)!],
      socialLinks: {
        for (final e in social.entries)
          if (_s(e.value) != null) e.key: _s(e.value)!,
      },
      standing: j['standing'] is Map ? StandingRow.fromJson(_m(j['standing'])) : null,
      standingLevel: _s(j['standing_level']) ?? 'none',
      previous: j['previous'] is Map ? ContestantLink.fromJson(_m(j['previous'])) : null,
      next: j['next'] is Map ? ContestantLink.fromJson(_m(j['next'])) : null,
    );
  }

  /// Number, else slug: what links use (`…/c/7`).
  String get ref => number?.toString() ?? slug;

  /// "#07 Asha Rai".
  String get label => '$displayNumber $name'.trim();

  bool get isOut => status == 'eliminated' || status == 'withdrawn' || inCurrentRound == false;

  /// Every photo: the main one first, then the gallery.
  List<String> get photos => [if (photoUrl != null) photoUrl!, for (final g in gallery) if (g != photoUrl) g];
}

/// A contest as the public sees it (`contest_public_data` on the server).
class Contest {
  final String id;
  final String slug;
  final String title;
  final String description;
  final String? coverUrl;

  /// 'scheduled', 'open' or 'closed'.
  final String status;
  final DateTime? opensAt;
  final DateTime? closesAt;
  final String eventTitle;
  final String eventSlug;

  /// 'sms_otp', 'email_otp', 'account', 'ticket', 'contact' or 'open'.
  final String voteMode;
  final bool requireCheckedIn;

  /// Cloudflare Turnstile site key when the contest asks for a robot check.
  final String? captchaSiteKey;
  final ContestRules rules;
  final ContestPaid paid;
  final List<RoundBrief> rounds;
  final RoundBrief? currentRound;
  final RoundBrief? displayRound;

  /// The main vote takes votes right now.
  final bool votingOpen;
  final List<ContestCategory> categories;
  final Standings? standings;
  final List<String> placementTitles;
  final String transparencyNote;

  /// Not sent on the event's voting list.
  final List<Contestant> contestants;
  final int? contestantCount;

  const Contest({
    required this.id,
    this.slug = '',
    required this.title,
    this.description = '',
    this.coverUrl,
    this.status = 'open',
    this.opensAt,
    this.closesAt,
    this.eventTitle = '',
    this.eventSlug = '',
    this.voteMode = 'open',
    this.requireCheckedIn = false,
    this.captchaSiteKey,
    this.rules = const ContestRules(),
    this.paid = const ContestPaid(),
    this.rounds = const [],
    this.currentRound,
    this.displayRound,
    this.votingOpen = false,
    this.categories = const [],
    this.standings,
    this.placementTitles = const [],
    this.transparencyNote = '',
    this.contestants = const [],
    this.contestantCount,
  });

  factory Contest.fromJson(Map<String, dynamic> j) {
    final event = _m(j['event']);
    final verification = _m(j['verification']);
    return Contest(
      id: j['id']?.toString() ?? '',
      slug: _s(j['slug']) ?? '',
      title: _s(j['title']) ?? 'Contest',
      description: _s(j['description']) ?? '',
      coverUrl: mediaUrl(j['cover_url']),
      status: _s(j['status']) ?? 'open',
      opensAt: _t(j['opens_at']),
      closesAt: _t(j['closes_at']),
      eventTitle: _s(event['title']) ?? '',
      eventSlug: _s(event['slug']) ?? '',
      voteMode: _s(verification['method'] ?? j['vote_mode']) ?? 'open',
      requireCheckedIn: j['require_checked_in'] == true,
      captchaSiteKey: _s(verification['captcha_site_key']),
      rules: ContestRules.fromJson(_m(j['rules'])),
      paid: ContestPaid.fromJson(_m(j['paid'])),
      rounds: [for (final r in _ms(j['rounds'])) RoundBrief.fromJson(r)],
      currentRound: j['current_round'] is Map ? RoundBrief.fromJson(_m(j['current_round'])) : null,
      displayRound: j['display_round'] is Map ? RoundBrief.fromJson(_m(j['display_round'])) : null,
      votingOpen: j['voting_open'] == true,
      categories: [for (final c in _ms(j['categories'])) ContestCategory.fromJson(c)],
      standings: Standings.maybe(j['standings']),
      placementTitles: _strs(j['placement_titles']),
      transparencyNote: _s(j['transparency_note']) ?? '',
      contestants: [for (final c in _ms(j['contestants'])) Contestant.fromJson(c)],
      contestantCount: _i(j['contestant_count']),
    );
  }

  /// What URLs use: the slug, else the id.
  String get ref => slug.isNotEmpty ? slug : id;

  bool get isOpen => status == 'open';
  bool get isScheduled => status == 'scheduled';
  bool get isClosed => status == 'closed';

  bool get usesOtp => voteMode == 'sms_otp' || voteMode == 'email_otp';
  bool get anyCategoryOpen => categories.any((c) => c.votingOpen);

  /// Someone can vote somewhere in this contest right now.
  bool get acceptingVotes => (votingOpen && rules.mainVoteEnabled) || anyCategoryOpen;

  String get webUrl => '$webBase/e/$eventSlug/vote/$ref';
  String contestantUrl(String contestantRef) => '$webUrl/c/$contestantRef';

  /// The moment the header counts down to: opening, or the round / contest closing.
  DateTime? get countdownTarget {
    if (isScheduled) return opensAt;
    if (isOpen) return currentRound?.closesAt ?? closesAt;
    return null;
  }

  String countdownLabel(Duration left) {
    if (isScheduled) return 'Opens in ${countdownText(left)}';
    if (currentRound?.closesAt != null) return '${currentRound!.name} closes in ${countdownText(left)}';
    return 'Closes in ${countdownText(left)}';
  }

  bool canReceiveVotes(Contestant c) =>
      votingOpen && rules.mainVoteEnabled && c.inCurrentRound != false && (c.status == 'active' || c.status == 'winner');

  /// Contestants a category's vote can go to (empty nominee list = every active contestant).
  List<Contestant> nomineesOf(ContestCategory cat) {
    if (cat.nominees.isNotEmpty) {
      return contestants.where((c) => cat.nominees.contains(c.id) && c.status != 'withdrawn').toList();
    }
    return contestants.where((c) => c.status == 'active' || c.status == 'winner').toList();
  }

  /// Open award categories [c] can get votes in.
  List<ContestCategory> openCategoriesFor(Contestant c) => categories
      .where((cat) =>
          cat.votingOpen &&
          (cat.nominees.isNotEmpty ? cat.nominees.contains(c.id) : (c.status == 'active' || c.status == 'winner')))
      .toList();

  /// Why [c] can't get a main vote right now, or null when they can.
  String? closedReason(Contestant c) {
    if (isScheduled) return "Voting hasn't opened yet";
    if (isClosed) return 'Voting has closed';
    if (c.status == 'withdrawn') return '${c.name} has withdrawn';
    if (c.status == 'eliminated' || c.inCurrentRound == false) return '${c.name} is no longer in the running';
    if (!rules.mainVoteEnabled) return 'Vote in an award category below';
    if (!votingOpen) {
      return currentRound != null ? '${currentRound!.name} is decided by the judges' : 'No round is open for voting';
    }
    return null;
  }

  /// One line under the header: whether and how people can vote now.
  ({String title, String body}) get statusLine {
    if (isScheduled) {
      return (
        title: "Voting hasn't opened yet",
        body: opensAt != null ? 'It opens ${nepalTime(opensAt!)}.' : 'Check back soon.',
      );
    }
    if (isClosed) {
      return (
        title: 'Voting has closed',
        body: standings != null ? 'Thanks to everyone who voted. See the results.' : 'Results will be announced by the organizers.',
      );
    }
    if (!acceptingVotes) {
      final next = rounds.where((r) => r.status == 'upcoming').firstOrNull;
      return (
        title: currentRound != null ? '${currentRound!.name} is decided by the judges' : 'No round is open for voting right now',
        body: next?.opensAt != null ? 'Public voting for ${next!.name} opens ${nepalTime(next.opensAt!)}.' : 'Check back for the next round.',
      );
    }
    final daily = rules.votesPerDay != null ? ' (resets at midnight, Nepal time)' : '';
    final split = rules.allowSplit ? '' : ' All your votes go to one contestant.';
    return (title: 'Voting is open', body: '${rules.allowanceText}$daily.$split');
  }

  /// The overall winner once the organizer has decided the final round.
  Contestant? get winner => contestants.where((c) => c.status == 'winner').firstOrNull;

  /// Results have been revealed: a winner is set, or the last round is decided.
  bool get resultsRevealed =>
      winner != null || (rounds.isNotEmpty && rounds.last.finalizedAt != null && standings != null);

  /// "Winner", "1st runner-up"… for a final rank, from the organizer's titles.
  String? placementTitle(int? rank) {
    if (rank == null || rank < 1 || rank > placementTitles.length) return null;
    final t = placementTitles[rank - 1].trim();
    return t.isEmpty ? null : t;
  }

  Contestant? contestantById(String id) => contestants.where((c) => c.id == id).firstOrNull;

  /// How voters prove who they are, in one sentence.
  String get methodText => switch (voteMode) {
        'sms_otp' =>
          "We send a one-time code to your mobile number to check it's really you. Your number is never shown to anyone.",
        'email_otp' => "We email you a one-time code to check it's really you. Your email is never shown to anyone.",
        'account' => 'Sign in with your Eventlaya account. Each account counts as one voter.',
        'ticket' =>
          'Use your event pass (saved on this phone) or the ticket code printed on it. Each ticket counts as one voter.',
        'contact' => 'Enter your phone number or email. It is only used to count each person\'s votes.',
        _ => 'Anyone can vote from this phone.',
      };

  /// Is it still worth refreshing (live data)?
  bool get isLive => !isClosed || !resultsRevealed;

  static DateTime now() => clock.now();
}

/// Remaining votes for one voter (`allowance` on vote / allowance responses).
class Allowance {
  /// Null = no limit.
  final int? freeRemaining;
  final bool resetsDaily;
  final int credits;
  final List<String> votedFor;

  /// Asked about one contestant (allowance body `contestant`, or a vote response): the free votes a vote
  /// for them would still accept (all limits incl. the per-contestant cap); null when there's no such cap.
  final String? contestantId;
  final int? contestantFreeRemaining;
  final int? contestantUsed;
  final int? contestantCap;

  /// 'contest', 'day' or 'round'.
  final String? contestantCapPeriod;

  const Allowance({
    this.freeRemaining,
    this.resetsDaily = false,
    this.credits = 0,
    this.votedFor = const [],
    this.contestantId,
    this.contestantFreeRemaining,
    this.contestantUsed,
    this.contestantCap,
    this.contestantCapPeriod,
  });

  factory Allowance.fromJson(Map<String, dynamic> j) => Allowance(
        freeRemaining: _i(j['free_remaining']),
        resetsDaily: j['resets_daily'] == true,
        credits: _i(j['credits']) ?? 0,
        votedFor: _strs(j['voted_for']),
        contestantId: _s(j['contestant_id']),
        contestantFreeRemaining: _i(j['contestant_free_remaining']),
        contestantUsed: _i(j['contestant_used']),
        contestantCap: _i(j['contestant_cap']),
        contestantCapPeriod: _s(j['contestant_cap_period']),
      );

  /// Free + bought votes left; null = unlimited.
  int? get available => freeRemaining == null ? null : freeRemaining! + credits;

  bool get outOfVotes => available != null && available! <= 0;

  /// Free votes a vote for the asked-about contestant would accept (their cap included).
  int? get freeHere => contestantFreeRemaining ?? freeRemaining;

  /// What one vote for that contestant can use: free votes for them + credits (credits go beyond the free cap).
  int? get availableHere => freeHere == null ? null : freeHere! + credits;

  bool get outHere => availableHere != null && availableHere! <= 0;

  /// This contestant's free cap is used up, but the voter still has free votes for others.
  bool get contestantCapReached =>
      contestantFreeRemaining == 0 && credits == 0 && (freeRemaining == null || freeRemaining! > 0);

  /// [line], about one contestant when the server said how many they can still get.
  String lineFor(String name) {
    if (contestantCapReached) {
      final when = switch (contestantCapPeriod) {
        'day' => ' today (it resets at midnight, Nepal time)',
        'round' => ' in this round',
        _ => '',
      };
      return "You've given $name the most free votes allowed$when. You can still vote for others.";
    }
    final here = contestantFreeRemaining;
    if (here != null && !outOfVotes && (freeRemaining == null || here < freeRemaining!)) {
      return '$line · up to $here free for $name';
    }
    return line;
  }

  /// "You have 3 votes left today · resets at midnight Nepal time".
  String get line {
    if (outOfVotes) {
      return resetsDaily
          ? "You've used today's free votes. They reset at midnight, Nepal time."
          : "You've used all your votes in this contest.";
    }
    if (freeRemaining == null) {
      return credits > 0
          ? 'You can vote as often as you like while voting is open (plus $credits from vote packs).'
          : 'You can vote as often as you like while voting is open.';
    }
    final n = freeRemaining!;
    final base = n == 0
        ? 'No free votes left${resetsDaily ? ' today' : ''}'
        : 'You have $n free ${n == 1 ? 'vote' : 'votes'} left${resetsDaily ? ' today' : ''}';
    final packs = credits > 0 ? ', plus $credits from vote packs' : '';
    final reset = resetsDaily ? ' · resets at midnight Nepal time' : '';
    return '$base$packs$reset';
  }
}

/// Most votes one submission may give, mirroring the server: free votes for this contestant (the server's
/// `contestant_free_remaining`, else `free_remaining`) plus credits, within the per-submit cap.
/// [contestantCap] is only a fallback for servers that don't send the contestant fields.
int maxVotesFor(ContestRules rules, Allowance? allowance, {int? contestantCap}) {
  final cap = rules.maxVotesPerSubmit < 1 ? 1 : rules.maxVotesPerSubmit;
  if (allowance == null) return cap;
  int? free = allowance.freeHere;
  if (allowance.contestantId == null && contestantCap != null && (free == null || contestantCap < free)) free = contestantCap;
  if (free == null) return cap;
  final left = free + allowance.credits;
  return left < 1 ? 1 : (left < cap ? left : cap);
}

/// Result of `POST …/vote/`.
class VoteReceipt {
  final String message;
  final String contestantId;
  final String? categoryId;
  final int quantity;
  final Allowance allowance;
  const VoteReceipt({
    required this.message,
    required this.contestantId,
    this.categoryId,
    this.quantity = 1,
    this.allowance = const Allowance(),
  });

  factory VoteReceipt.fromJson(Map<String, dynamic> j) => VoteReceipt(
        message: _s(j['message']) ?? 'Your vote is in.',
        contestantId: j['contestant_id']?.toString() ?? '',
        categoryId: _s(j['category_id']),
        quantity: _i(j['quantity']) ?? 1,
        allowance: Allowance.fromJson(_m(j['allowance'])),
      );
}

/// `POST …/otp/send/` answer.
class OtpSent {
  final int expiresIn;
  final int resendIn;
  final String channel;

  /// Masked: "981*****23" / "as***@gmail.com".
  final String destination;
  const OtpSent({this.expiresIn = 300, this.resendIn = 60, this.channel = 'sms', this.destination = ''});

  factory OtpSent.fromJson(Map<String, dynamic> j) => OtpSent(
        expiresIn: _i(j['expires_in']) ?? 300,
        resendIn: _i(j['resend_in']) ?? 60,
        channel: _s(j['channel']) ?? 'sms',
        destination: _s(j['destination']) ?? '',
      );
}

/// A verified voter (from `POST …/otp/verify/`), kept for its 12 hours.
class VoterToken {
  final String token;
  final String destination;
  final DateTime expires;
  const VoterToken({required this.token, required this.destination, required this.expires});

  factory VoterToken.fromJson(Map<String, dynamic> j) => VoterToken(
        token: j['token']?.toString() ?? '',
        destination: j['destination']?.toString() ?? '',
        expires: DateTime.tryParse(j['expires']?.toString() ?? '') ?? DateTime(2000),
      );

  Map<String, dynamic> toJson() => {'token': token, 'destination': destination, 'expires': expires.toIso8601String()};

  /// Still good for at least a minute.
  bool get valid => token.isNotEmpty && expires.isAfter(clock.now().add(const Duration(minutes: 1)));
}
