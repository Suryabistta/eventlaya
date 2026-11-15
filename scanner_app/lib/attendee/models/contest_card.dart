import '../../core/media_url.dart';

/// One contest on the Voting tab (`GET /api/voting/public-contests/`, same data as the website's /voting page).
class ContestCard {
  final String id;
  final String slug;
  final String title;
  final String status; // open | scheduled | closed
  final String? coverUrl;
  final DateTime? opensAt;
  final DateTime? closesAt;
  final int contestants;
  /// Null when the organizer hides vote counts.
  final int? totalVotes;
  final String organizerName;
  final String eventSlug;
  final String eventTitle;
  final String categoryLabel;

  const ContestCard({
    required this.id, required this.slug, required this.title, required this.status, this.coverUrl, this.opensAt,
    this.closesAt, required this.contestants, this.totalVotes, required this.organizerName, required this.eventSlug,
    required this.eventTitle, required this.categoryLabel,
  });

  bool get isLive => status == 'open';
  bool get isUpcoming => status == 'scheduled';
  String get ref => slug.isNotEmpty ? slug : id;

  static DateTime? _d(Object? v) => v == null ? null : DateTime.tryParse(v.toString())?.toLocal();

  factory ContestCard.fromJson(Map<String, dynamic> j) {
    final e = j['event'] is Map ? Map<String, dynamic>.from(j['event'] as Map) : <String, dynamic>{};
    final cover = '${j['cover_url'] ?? ''}';
    return ContestCard(
      id: '${j['id']}',
      slug: '${j['slug'] ?? ''}',
      title: '${j['title'] ?? ''}',
      status: '${j['status'] ?? ''}',
      coverUrl: mediaUrl(cover.isNotEmpty ? cover : e['banner']),
      opensAt: _d(j['opens_at']),
      closesAt: _d(j['closes_at']),
      contestants: int.tryParse('${j['contestants'] ?? 0}') ?? 0,
      totalVotes: j['total_votes'] == null ? null : int.tryParse('${j['total_votes']}'),
      organizerName: '${j['organizer_name'] ?? ''}',
      eventSlug: '${e['slug'] ?? ''}',
      eventTitle: '${e['title'] ?? ''}',
      categoryLabel: '${e['category_label'] ?? ''}',
    );
  }
}

class ContestList {
  final List<ContestCard> results;
  final Map<String, int> counts;
  final List<String> cities;
  const ContestList(this.results, this.counts, this.cities);
}
