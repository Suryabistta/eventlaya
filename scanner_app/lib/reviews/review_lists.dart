import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../attendee/data/attendee_api.dart' show friendlyError;
import '../providers/auth_provider.dart';
import '../ui/ui.dart';
import 'review_models.dart';
import 'review_widgets.dart';
import 'reviews_api.dart';

/// Shared paged list of reviews from a loader (mine / manage).
class _PagedReviews extends ConsumerStatefulWidget {
  final String title;
  final Future<ReviewsPage> Function(WidgetRef ref, int page) load;
  final Widget Function(BuildContext context, Review r, void Function(Review) replace) itemBuilder;
  final Widget? header;
  final String emptyTitle;
  final String emptyMessage;
  const _PagedReviews({
    super.key,
    required this.title,
    required this.load,
    required this.itemBuilder,
    this.header,
    required this.emptyTitle,
    required this.emptyMessage,
  });

  @override
  ConsumerState<_PagedReviews> createState() => _PagedReviewsState();
}

class _PagedReviewsState extends ConsumerState<_PagedReviews> {
  final List<Review> _items = [];
  int _page = 0;
  bool _more = true;
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  @override
  void didUpdateWidget(covariant _PagedReviews old) {
    super.didUpdateWidget(old);
    if (old.load != widget.load) _load(reset: true);
  }

  Future<void> _load({bool reset = false}) async {
    if (_loading && !reset) return;
    if (reset) {
      _page = 0;
      _more = true;
    }
    if (!_more) return;
    setState(() => _loading = true);
    try {
      final p = await widget.load(ref, _page + 1);
      if (!mounted) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll(p.results);
        _page++;
        _more = p.next != null;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _replace(Review r) {
    final i = _items.indexWhere((x) => x.id == r.id);
    setState(() => i < 0 ? null : _items[i] = r);
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: widget.title,
      onRefresh: () => _load(reset: true),
      slivers: [
        if (widget.header != null) SliverToBoxAdapter(child: widget.header!),
        if (_items.isEmpty && _error != null)
          SliverFillRemaining(
            hasScrollBody: false,
            child: ErrorState(message: friendlyError(_error!), onRetry: () => _load(reset: true)),
          )
        else if (_items.isEmpty && _loading)
          const SliverToBoxAdapter(child: LoadingList(rows: 4))
        else if (_items.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(icon: Icons.star_outline_rounded, title: widget.emptyTitle, message: widget.emptyMessage),
          )
        else
          SliverToBoxAdapter(
            child: GroupedSection(children: [
              for (final r in _items) widget.itemBuilder(context, r, _replace),
              if (_more)
                ListRow(title: _loading ? 'Loading…' : 'Load more', centered: true, onTap: _loading ? null : _load),
            ]),
          ),
      ],
    );
  }
}

ReviewTarget targetOf(Review r) => switch (r.kind) {
      'vendor' => ReviewTarget.vendor(r.targetId, r.targetName),
      'venue' => ReviewTarget.venue(r.targetId, r.targetName),
      _ => ReviewTarget.event(r.targetSlug ?? r.targetId, r.targetName),
    };

/// Profile → My reviews: everything the user wrote; tap to edit or delete.
class MyReviewsScreen extends ConsumerStatefulWidget {
  const MyReviewsScreen({super.key});

  @override
  ConsumerState<MyReviewsScreen> createState() => _MyReviewsScreenState();
}

class _MyReviewsScreenState extends ConsumerState<MyReviewsScreen> {
  int _version = 0;

  @override
  Widget build(BuildContext context) {
    return _PagedReviews(
      key: ValueKey(_version),
      title: 'My reviews',
      emptyTitle: 'No reviews yet',
      emptyMessage: 'Review events after your ticket is scanned, and venues or vendors you sent an inquiry to.',
      load: (ref, page) => ref.read(reviewsApiProvider).mine(page: page),
      itemBuilder: (context, r, _) => ReviewTile(
        review: r,
        showTarget: true,
        trailing: const Icon(Icons.chevron_right_rounded, color: AppColors.ink300),
        onTap: () async {
          if (await showWriteReviewSheet(context, ref, targetOf(r), existing: r)) setState(() => _version++);
        },
      ),
    );
  }
}

/// Organizer → More → Reviews: reviews of their events / listings; reply,
/// hide or unhide. Hiding is only offered for event reviews (venue and vendor
/// owners can reply but not hide). With [listingsOnly] (vendor app) the filter
/// is by listing kind instead of visibility.
class ManageReviewsScreen extends ConsumerStatefulWidget {
  final bool listingsOnly;
  const ManageReviewsScreen({super.key, this.listingsOnly = false});

  @override
  ConsumerState<ManageReviewsScreen> createState() => _ManageReviewsScreenState();
}

class _ManageReviewsScreenState extends ConsumerState<ManageReviewsScreen> {
  String _filter = 'all';

  Future<ReviewsPage> _load(WidgetRef ref, int page) => ref.read(reviewsApiProvider).manage(
        page: page,
        kind: widget.listingsOnly && _filter != 'all' ? _filter : null,
        hidden: widget.listingsOnly ? null : switch (_filter) { 'hidden' => true, 'visible' => false, _ => null },
      );

  bool _canHide(Review r) => r.kind == 'event' || (ref.read(authProvider).user?.isSuperAdmin ?? false);

  Future<void> _actions(Review r, void Function(Review) replace) async {
    final api = ref.read(reviewsApiProvider);
    final action = await showAppSheet<String>(
      context,
      builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, children: [
        SheetHeader(title: r.targetName, message: '${r.authorName} · ${r.rating}★'),
        SheetAction(
          icon: Icons.reply_rounded,
          label: r.replyText == null ? 'Reply' : 'Edit reply',
          onTap: () => Navigator.pop(ctx, 'reply'),
        ),
        if (r.replyText != null)
          SheetAction(icon: Icons.delete_outline_rounded, label: 'Delete reply', onTap: () => Navigator.pop(ctx, 'unreply')),
        if (_canHide(r))
          SheetAction(
          icon: r.isHidden ? Icons.visibility_rounded : Icons.visibility_off_rounded,
          label: r.isHidden ? 'Show review again' : 'Hide review',
          destructive: !r.isHidden,
          onTap: () => Navigator.pop(ctx, r.isHidden ? 'unhide' : 'hide'),
        ),
      ]),
    );
    if (action == null || !mounted) return;
    try {
      Review? updated;
      switch (action) {
        case 'reply':
          final text = await _askText(r.replyText == null ? 'Reply' : 'Edit reply', r.replyText ?? '', 'Your reply is shown under the review.');
          if (text == null || text.isEmpty) return;
          updated = await api.reply(r.id, text);
        case 'unreply':
          updated = await api.deleteReply(r.id);
        case 'hide':
          final reason = await _askText('Hide review', '', 'Why? Only you and the author see this.');
          if (reason == null) return;
          updated = await api.hide(r.id, hidden: true, reason: reason);
        case 'unhide':
          updated = await api.hide(r.id, hidden: false);
      }
      if (updated != null) replace(updated);
      if (mounted) AppToast.success(context, 'Saved');
    } catch (e) {
      if (mounted) AppToast.error(context, friendlyError(e));
    }
  }

  Future<String?> _askText(String title, String initial, String message) async {
    final ctrl = TextEditingController(text: initial);
    final result = await showAppSheet<String>(
      context,
      builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SheetHeader(title: title, message: message),
        TextField(controller: ctrl, autofocus: true, maxLines: 4, minLines: 2, maxLength: 1000),
        const SizedBox(height: 12),
        PrimaryButton(label: 'Save', onPressed: () => Navigator.pop(ctx, ctrl.text.trim())),
      ]),
    );
    ctrl.dispose();
    return result;
  }

  @override
  Widget build(BuildContext context) {
    return _PagedReviews(
      key: ValueKey(_filter),
      title: 'Reviews',
      emptyTitle: 'No reviews yet',
      emptyMessage: widget.listingsOnly
          ? 'Reviews of your venues and services show up here. You can reply to each one.'
          : 'Reviews of your events and listings show up here.',
      header: Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: SegmentedControl<String>(
          segments: widget.listingsOnly
              ? const [Segment('all', 'All'), Segment('venue', 'Venues'), Segment('vendor', 'Services')]
              : const [Segment('all', 'All'), Segment('visible', 'Visible'), Segment('hidden', 'Hidden')],
          selected: _filter,
          onChanged: (v) => setState(() => _filter = v),
        ),
      ),
      load: _load,
      itemBuilder: (context, r, replace) => ReviewTile(
        review: r,
        showTarget: true,
        trailing: const Icon(Icons.more_horiz_rounded, color: AppColors.ink400),
        onTap: () => _actions(r, replace),
      ),
    );
  }
}
