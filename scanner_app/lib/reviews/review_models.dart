import '../core/media_url.dart';

String? _s(Object? v) {
  final t = v?.toString().trim();
  return (t == null || t.isEmpty) ? null : t;
}

/// What is being reviewed: `/api/reviews/<path>/<key>/`.
class ReviewTarget {
  /// 'events' (key = slug), 'vendors' or 'venues' (key = uuid).
  final String path;
  final String key;
  final String title;
  const ReviewTarget(this.path, this.key, this.title);

  const ReviewTarget.event(String slug, String title) : this('events', slug, title);
  const ReviewTarget.vendor(String id, String title) : this('vendors', id, title);
  const ReviewTarget.venue(String id, String title) : this('venues', id, title);

  @override
  bool operator ==(Object other) => other is ReviewTarget && other.path == path && other.key == key;

  @override
  int get hashCode => Object.hash(path, key);
}

class Review {
  final String id;

  /// 'event', 'vendor' or 'venue'.
  final String kind;
  final String targetId;
  final String targetName;
  final String? targetSlug;
  final String? targetImage;
  final int rating;
  final String text;
  final String authorName;
  final String? authorAvatar;
  final String? replyText;
  final DateTime? repliedAt;
  final bool isMine;
  final bool edited;
  final bool isHidden;
  final String? hiddenReason;
  final DateTime? createdAt;

  const Review({
    required this.id,
    this.kind = 'event',
    this.targetId = '',
    this.targetName = '',
    this.targetSlug,
    this.targetImage,
    required this.rating,
    this.text = '',
    this.authorName = 'Eventlaya user',
    this.authorAvatar,
    this.replyText,
    this.repliedAt,
    this.isMine = false,
    this.edited = false,
    this.isHidden = false,
    this.hiddenReason,
    this.createdAt,
  });

  factory Review.fromJson(Map<String, dynamic> j) {
    final target = j['target'] is Map ? j['target'] as Map : const {};
    final author = j['author'] is Map ? j['author'] as Map : const {};
    final reply = j['reply'] is Map ? j['reply'] as Map : null;
    return Review(
      id: j['id']?.toString() ?? '',
      kind: _s(j['kind']) ?? 'event',
      targetId: _s(target['id']) ?? '',
      targetName: _s(target['name']) ?? '',
      targetSlug: _s(target['slug']),
      targetImage: mediaUrl(target['image']),
      rating: int.tryParse(j['rating']?.toString() ?? '') ?? 0,
      text: _s(j['text']) ?? '',
      authorName: _s(author['name']) ?? 'Eventlaya user',
      authorAvatar: mediaUrl(author['avatar']),
      replyText: _s(reply?['text']),
      repliedAt: DateTime.tryParse(reply?['replied_at']?.toString() ?? '')?.toLocal(),
      isMine: j['is_mine'] == true,
      edited: j['edited_at'] != null,
      isHidden: j['is_hidden'] == true,
      hiddenReason: _s(j['hidden_reason']),
      createdAt: DateTime.tryParse(j['created_at']?.toString() ?? '')?.toLocal(),
    );
  }
}

class ReviewSummary {
  final double? average;
  final int count;

  /// Stars (1–5) → number of reviews.
  final Map<int, int> distribution;
  const ReviewSummary({this.average, this.count = 0, this.distribution = const {}});

  factory ReviewSummary.fromJson(Map<String, dynamic> j) => ReviewSummary(
        average: j['average'] == null ? null : double.tryParse(j['average'].toString()),
        count: int.tryParse(j['count']?.toString() ?? '') ?? 0,
        distribution: {
          if (j['distribution'] is Map)
            for (final e in (j['distribution'] as Map).entries)
              int.tryParse(e.key.toString()) ?? 0: int.tryParse(e.value.toString()) ?? 0,
        },
      );
}

/// The signed-in viewer's position (null when signed out).
class ReviewViewer {
  final bool canReview;
  final String? reason;
  final Review? myReview;
  const ReviewViewer({this.canReview = false, this.reason, this.myReview});

  factory ReviewViewer.fromJson(Map<String, dynamic> j) => ReviewViewer(
        canReview: j['can_review'] == true,
        reason: _s(j['reason']),
        myReview: j['my_review'] is Map ? Review.fromJson(Map<String, dynamic>.from(j['my_review'] as Map)) : null,
      );
}

/// One page of `GET /api/reviews/...`.
class ReviewsPage {
  final int count;
  final String? next;
  final ReviewSummary? summary;
  final ReviewViewer? viewer;
  final List<Review> results;
  const ReviewsPage({this.count = 0, this.next, this.summary, this.viewer, this.results = const []});

  factory ReviewsPage.fromJson(Map<String, dynamic> j) => ReviewsPage(
        count: int.tryParse(j['count']?.toString() ?? '') ?? 0,
        next: _s(j['next']),
        summary: j['summary'] is Map ? ReviewSummary.fromJson(Map<String, dynamic>.from(j['summary'] as Map)) : null,
        viewer: j['viewer'] is Map ? ReviewViewer.fromJson(Map<String, dynamic>.from(j['viewer'] as Map)) : null,
        results: [
          if (j['results'] is List)
            for (final r in j['results'] as List)
              if (r is Map) Review.fromJson(Map<String, dynamic>.from(r)),
        ],
      );
}
