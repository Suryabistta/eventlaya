import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../attendee/data/attendee_api.dart' show friendlyError;
import '../providers/auth_provider.dart';
import '../providers/modules_provider.dart';
import '../ui/ui.dart';
import 'review_models.dart';
import 'reviews_api.dart';
import '../core/bs_date.dart';

/// Five stars, filled to [rating].
class StarRow extends StatelessWidget {
  final double rating;
  final double size;
  const StarRow(this.rating, {super.key, this.size = 16});

  @override
  Widget build(BuildContext context) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      for (var i = 1; i <= 5; i++)
        Icon(
          rating >= i ? Icons.star_rounded : (rating >= i - 0.5 ? Icons.star_half_rounded : Icons.star_outline_rounded),
          size: size,
          color: AppColors.marigold,
        ),
    ]);
  }
}

/// One review: author, stars, date, text and the owner's reply.
class ReviewTile extends StatelessWidget {
  final Review review;
  final bool showTarget;
  final Widget? trailing;
  final VoidCallback? onTap;
  const ReviewTile({super.key, required this.review, this.showTarget = false, this.trailing, this.onTap});

  @override
  Widget build(BuildContext context) {
    final r = review;
    final date = r.createdAt == null ? '' : BsDate.format('d MMM y', r.createdAt!);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            InitialsAvatar(name: r.authorName, size: 32),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(showTarget ? r.targetName : (r.isMine ? '${r.authorName} (you)' : r.authorName),
                    maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.body(14, weight: FontWeight.w600)),
                Row(children: [
                  StarRow(r.rating.toDouble(), size: 14),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text([date, if (r.edited) 'edited'].join(' · '),
                        maxLines: 1, overflow: TextOverflow.ellipsis, style: AppType.caption),
                  ),
                ]),
              ]),
            ),
            if (r.isHidden) const StatusBadge('Hidden', tone: Tone.warning, dot: false),
            if (trailing != null) trailing!,
          ]),
          if (r.text.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(r.text, style: AppType.body(14, height: 1.5)),
          ],
          if (r.isHidden && r.hiddenReason != null) ...[
            const SizedBox(height: 4),
            Text('Hidden: ${r.hiddenReason}', style: AppType.caption.copyWith(color: AppColors.marigoldDark)),
          ],
          if (r.replyText != null) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: AppColors.ink50, borderRadius: BorderRadius.circular(10)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(r.kind == 'event' ? 'Reply from the organizer' : 'Reply from the owner', style: AppType.body(12, weight: FontWeight.w600, color: AppColors.ink600)),
                const SizedBox(height: 2),
                Text(r.replyText!, style: AppType.body(13.5, color: AppColors.ink700)),
              ]),
            ),
          ],
        ]),
      ),
    );
  }
}

/// Write or edit a review. Returns true when saved or deleted.
Future<bool> showWriteReviewSheet(BuildContext context, WidgetRef ref, ReviewTarget target, {Review? existing}) async {
  var rating = existing?.rating ?? 0;
  final text = TextEditingController(text: existing?.text ?? '');
  var busy = false;
  final saved = await showAppSheet<bool>(
    context,
    builder: (ctx) => StatefulBuilder(builder: (ctx, setSheet) {
      Future<void> save() async {
        if (rating < 1) {
          AppToast.error(ctx, 'Tap the stars to rate');
          return;
        }
        setSheet(() => busy = true);
        try {
          final api = ref.read(reviewsApiProvider);
          if (existing != null) {
            await api.update(existing.id, rating: rating, text: text.text.trim());
          } else {
            await api.create(target, rating: rating, text: text.text.trim());
          }
          if (ctx.mounted) Navigator.pop(ctx, true);
        } catch (e) {
          noteModuleDisabled(ref, e);
          if (ctx.mounted) AppToast.error(ctx, friendlyError(e));
          setSheet(() => busy = false);
        }
      }

      Future<void> remove() async {
        final ok = await confirmSheet(ctx,
            title: 'Delete your review?', message: 'This can\'t be undone.', confirmLabel: 'Delete');
        if (!ok) return;
        try {
          await ref.read(reviewsApiProvider).delete(existing!.id);
          if (ctx.mounted) Navigator.pop(ctx, true);
        } catch (e) {
          if (ctx.mounted) AppToast.error(ctx, friendlyError(e));
        }
      }

      return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SheetHeader(title: existing == null ? 'Write a review' : 'Edit your review', message: target.title),
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          for (var i = 1; i <= 5; i++)
            IconButton(
              tooltip: '$i star${i == 1 ? '' : 's'}',
              iconSize: 40,
              onPressed: () {
                HapticFeedback.selectionClick();
                setSheet(() => rating = i);
              },
              icon: Icon(i <= rating ? Icons.star_rounded : Icons.star_outline_rounded, color: AppColors.marigold),
            ),
        ]),
        const SizedBox(height: 12),
        TextField(
          controller: text,
          maxLines: 5,
          minLines: 3,
          maxLength: 1000,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(hintText: 'What stood out? (optional)'),
        ),
        const SizedBox(height: 12),
        PrimaryButton(label: existing == null ? 'Post review' : 'Save', loading: busy, onPressed: save),
        if (existing != null) ...[
          const SizedBox(height: 8),
          PrimaryButton(label: 'Delete review', tone: ButtonTone.danger, tonal: true, onPressed: remove),
        ],
      ]);
    }),
  );
  text.dispose();
  if (saved == true) ref.invalidate(reviewsProvider(target));
  return saved == true;
}

/// Reviews block for event / vendor / venue pages: rating summary, latest
/// reviews, "See all", and "Write a review" when the viewer is eligible.
/// Hidden when the `reviews` module is off.
class ReviewsSection extends ConsumerWidget {
  final ReviewTarget target;

  /// Hide entirely when there are no reviews and the viewer can't write one.
  final bool hideWhenEmpty;
  const ReviewsSection({super.key, required this.target, this.hideWhenEmpty = false});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(moduleEnabledProvider(AppModule.reviews))) return const SizedBox.shrink();
    final async = ref.watch(reviewsProvider(target));
    ref.listen(reviewsProvider(target), (_, next) {
      if (next.hasError) noteModuleDisabled(ref, next.error!);
    });
    final page = async.valueOrNull;
    if (page == null) {
      return async.isLoading ? const Padding(padding: EdgeInsets.only(bottom: 24), child: LoadingList(rows: 1)) : const SizedBox.shrink();
    }
    final signedIn = ref.watch(authProvider).user != null;
    final viewer = page.viewer;
    final mine = viewer?.myReview;
    final summary = page.summary;
    if (hideWhenEmpty && page.count == 0 && mine == null && viewer?.canReview != true) return const SizedBox.shrink();

    return GroupedSection(
      header: 'Reviews',
      children: [
        if (summary != null && summary.count > 0)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
            child: Row(children: [
              Text((summary.average ?? 0).toStringAsFixed(1), style: AppType.heading(36, weight: FontWeight.w800)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  StarRow(summary.average ?? 0, size: 18),
                  Text('${summary.count} review${summary.count == 1 ? '' : 's'}', style: AppType.caption),
                ]),
              ),
              SizedBox(width: 120, child: _Distribution(summary)),
            ]),
          )
        else
          const ListRow(
            leading: RowIcon(Icons.star_outline_rounded, background: AppColors.marigold),
            title: 'No reviews yet',
          ),
        if (mine != null)
          ReviewTile(
            review: mine,
            trailing: NavTextButton(label: 'Edit', onPressed: () => showWriteReviewSheet(context, ref, target, existing: mine)),
          ),
        for (final r in page.results.where((r) => r.id != mine?.id).take(3)) ReviewTile(review: r),
        if (page.count > 3)
          ListRow(
            title: 'See all ${page.count} reviews',
            chevron: true,
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => AllReviewsScreen(target: target))),
          ),
        if (mine == null && viewer != null && viewer.canReview)
          ListRow(
            leading: const RowIcon(Icons.rate_review_rounded),
            title: 'Write a review',
            chevron: true,
            onTap: () async {
              if (await showWriteReviewSheet(context, ref, target) && context.mounted) {
                AppToast.success(context, 'Thanks for your review');
              }
            },
          )
        else if (mine == null && signedIn && viewer?.reason != null)
          ListRow(title: viewer!.reason!, subtitle: null),
      ],
    );
  }
}

class _Distribution extends StatelessWidget {
  final ReviewSummary summary;
  const _Distribution(this.summary);

  @override
  Widget build(BuildContext context) {
    final max = summary.distribution.values.fold<int>(0, (a, b) => b > a ? b : a);
    return Column(mainAxisSize: MainAxisSize.min, children: [
      for (var i = 5; i >= 1; i--)
        Row(children: [
          SizedBox(width: 10, child: Text('$i', style: AppType.body(10, color: AppColors.ink500, height: 1.3))),
          const SizedBox(width: 4),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(99),
              child: LinearProgressIndicator(
                value: max == 0 ? 0 : (summary.distribution[i] ?? 0) / max,
                minHeight: 4,
                color: AppColors.marigold,
                backgroundColor: AppColors.ink100,
              ),
            ),
          ),
        ]),
    ]);
  }
}

/// Every review of one target, paged.
class AllReviewsScreen extends ConsumerStatefulWidget {
  final ReviewTarget target;
  const AllReviewsScreen({super.key, required this.target});

  @override
  ConsumerState<AllReviewsScreen> createState() => _AllReviewsScreenState();
}

class _AllReviewsScreenState extends ConsumerState<AllReviewsScreen> {
  final List<Review> _items = [];
  int _page = 0;
  bool _more = true;
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool reset = false}) async {
    if (_loading) return;
    if (reset) {
      _page = 0;
      _more = true;
    }
    if (!_more) return;
    setState(() => _loading = true);
    try {
      final p = await ref.read(reviewsApiProvider).list(widget.target, page: _page + 1);
      setState(() {
        if (reset) _items.clear();
        _items.addAll(p.results);
        _page++;
        _more = p.next != null;
        _error = null;
      });
    } catch (e) {
      setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Reviews',
      onRefresh: () => _load(reset: true),
      slivers: [
        if (_items.isEmpty && _error != null)
          SliverFillRemaining(
            hasScrollBody: false,
            child: ErrorState(message: friendlyError(_error!), onRetry: () => _load(reset: true)),
          )
        else if (_items.isEmpty && _loading)
          const SliverToBoxAdapter(child: LoadingList(rows: 4))
        else
          SliverToBoxAdapter(
            child: GroupedSection(
              header: widget.target.title,
              children: [
                for (final r in _items) ReviewTile(review: r),
                if (_more)
                  ListRow(title: _loading ? 'Loading…' : 'Load more', centered: true, onTap: _loading ? null : _load),
              ],
            ),
          ),
      ],
    );
  }
}
