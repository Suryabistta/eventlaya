import '../../core/media_url.dart';

String? _s(Object? v) {
  final t = v?.toString().trim();
  return (t == null || t.isEmpty) ? null : t;
}

class PollCandidate {
  final String id;
  final String name;
  final String subtitle;
  final String description;
  final String? photoUrl;

  /// Only when the organizer shows results publicly.
  final int? votes;
  final double? percentage;

  const PollCandidate({
    required this.id,
    required this.name,
    this.subtitle = '',
    this.description = '',
    this.photoUrl,
    this.votes,
    this.percentage,
  });

  factory PollCandidate.fromJson(Map<String, dynamic> j) => PollCandidate(
        id: j['id']?.toString() ?? '',
        name: _s(j['name']) ?? 'Candidate',
        subtitle: _s(j['subtitle']) ?? '',
        description: _s(j['description']) ?? '',
        photoUrl: mediaUrl(j['photo_url']),
        votes: j['votes'] == null ? null : int.tryParse(j['votes'].toString()),
        percentage: j['percentage'] == null ? null : double.tryParse(j['percentage'].toString()),
      );
}

/// What the signed-in viewer can do (`viewer` on public poll data; null
/// for signed-out visitors).
class PollViewer {
  /// Null when the server can't tell (open polls are one vote per device).
  final bool? hasVoted;
  final List<String> candidateIds;

  /// The account has a ticket (ticket polls) or a verified email (contact
  /// polls): vote with just the picks, no code.
  final bool canVoteWithAccount;
  const PollViewer({this.hasVoted, this.candidateIds = const [], this.canVoteWithAccount = false});

  factory PollViewer.fromJson(Map<String, dynamic> j) => PollViewer(
        hasVoted: j['has_voted'] is bool ? j['has_voted'] as bool : null,
        candidateIds: [if (j['candidate_ids'] is List) for (final c in j['candidate_ids'] as List) c.toString()],
        canVoteWithAccount: j['can_vote_with_account'] == true,
      );
}

/// A public poll (`public_poll_data` on the server).
class Poll {
  final String id;
  final String title;
  final String description;

  /// 'scheduled', 'open' or 'closed'.
  final String status;
  final DateTime? opensAt;
  final DateTime? closesAt;

  /// 'ticket' (one vote per ticket), 'contact' (per phone/email) or 'open' (per device).
  final String voteMode;
  final bool requireCheckedIn;
  final int maxChoices;
  final bool resultsVisible;
  final int? totalVotes;
  final List<PollCandidate> candidates;
  final PollViewer? viewer;

  const Poll({
    required this.id,
    required this.title,
    this.description = '',
    this.status = 'open',
    this.opensAt,
    this.closesAt,
    this.voteMode = 'ticket',
    this.requireCheckedIn = false,
    this.maxChoices = 1,
    this.resultsVisible = false,
    this.totalVotes,
    this.candidates = const [],
    this.viewer,
  });

  factory Poll.fromJson(Map<String, dynamic> j) => Poll(
        id: j['id']?.toString() ?? '',
        title: _s(j['title']) ?? 'Poll',
        description: _s(j['description']) ?? '',
        status: _s(j['status']) ?? 'open',
        opensAt: DateTime.tryParse(j['opens_at']?.toString() ?? '')?.toLocal(),
        closesAt: DateTime.tryParse(j['closes_at']?.toString() ?? '')?.toLocal(),
        voteMode: _s(j['vote_mode']) ?? 'ticket',
        requireCheckedIn: j['require_checked_in'] == true,
        maxChoices: int.tryParse(j['max_choices']?.toString() ?? '') ?? 1,
        resultsVisible: j['results_visible'] == true,
        totalVotes: j['total_votes'] == null ? null : int.tryParse(j['total_votes'].toString()),
        candidates: [
          if (j['candidates'] is List)
            for (final c in j['candidates'] as List)
              if (c is Map) PollCandidate.fromJson(Map<String, dynamic>.from(c)),
        ],
        viewer: j['viewer'] is Map ? PollViewer.fromJson(Map<String, dynamic>.from(j['viewer'] as Map)) : null,
      );

  bool get isOpen => status == 'open';
  bool get isScheduled => status == 'scheduled';
  bool get isClosed => status == 'closed';
}
