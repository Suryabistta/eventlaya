import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api_client.dart';
import '../providers/auth_provider.dart';
import 'review_models.dart';

/// Reviews & ratings (`/api/reviews/…`, module `reviews`).
class ReviewsApi {
  ReviewsApi([ApiClient? client]) : _api = client ?? ApiClient();
  final ApiClient _api;

  Map<String, dynamic> _m(dynamic d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{};

  Future<ReviewsPage> list(ReviewTarget t, {int page = 1}) async {
    final resp = await _api.get('/api/reviews/${t.path}/${t.key}/', queryParameters: {'page': page});
    return ReviewsPage.fromJson(_m(resp.data));
  }

  /// 201; 403 `not_eligible`, 409 `already_reviewed`.
  Future<Review> create(ReviewTarget t, {required int rating, String text = ''}) async {
    final resp = await _api.post('/api/reviews/${t.path}/${t.key}/', data: {'rating': rating, 'text': text});
    return Review.fromJson(_m(resp.data));
  }

  Future<Review> update(String id, {required int rating, String text = ''}) async {
    final resp = await _api.patch('/api/reviews/$id/', data: {'rating': rating, 'text': text});
    return Review.fromJson(_m(resp.data));
  }

  Future<void> delete(String id) => _api.delete('/api/reviews/$id/');

  /// The signed-in user's reviews (`?kind=event|vendor|venue`).
  Future<ReviewsPage> mine({int page = 1}) async {
    final resp = await _api.get('/api/reviews/mine/', queryParameters: {'page': page});
    return ReviewsPage.fromJson(_m(resp.data));
  }

  /// Organizer / listing owner: reviews of what they own (hidden included).
  Future<ReviewsPage> manage({String? kind, bool? hidden, int page = 1}) async {
    final resp = await _api.get('/api/reviews/manage/', queryParameters: {
      'page': page,
      if (kind != null) 'kind': kind,
      if (hidden != null) 'hidden': hidden ? '1' : '0',
    });
    return ReviewsPage.fromJson(_m(resp.data));
  }

  Future<Review> hide(String id, {required bool hidden, String reason = ''}) async {
    final resp = await _api.post('/api/reviews/$id/hide/', data: {'hidden': hidden, 'reason': reason});
    return Review.fromJson(_m(resp.data));
  }

  Future<Review> reply(String id, String text) async {
    final resp = await _api.post('/api/reviews/$id/reply/', data: {'text': text});
    return Review.fromJson(_m(resp.data));
  }

  Future<Review> deleteReply(String id) async {
    final resp = await _api.delete('/api/reviews/$id/reply/');
    return Review.fromJson(_m(resp.data));
  }
}

final reviewsApiProvider = Provider<ReviewsApi>((ref) => ReviewsApi());

/// First page of reviews for a target (with summary + viewer).
final reviewsProvider = FutureProvider.autoDispose.family<ReviewsPage, ReviewTarget>((ref, t) {
  ref.watch(authProvider.select((s) => s.user?.id)); // `viewer` depends on who is signed in
  return ref.watch(reviewsApiProvider).list(t);
});
