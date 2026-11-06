from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import OptionalJWTAuthentication
from apps.events.models import Event
from apps.marketplace.models import ListingStatus, VendorProfile, VenueListing

from .models import Review
from .rules import public_reviews, review_block, summary
from .serializers import HideSerializer, ReplySerializer, ReviewSerializer, ReviewWriteSerializer

PUBLIC_EVENT_STATUSES = [Event.Status.PUBLISHED, Event.Status.ONGOING, Event.Status.COMPLETED]


class ReviewPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 50


def _is_admin(user):
    return bool(user and user.is_authenticated and user.is_superadmin)


def _paginate(view, request, qs, extra=None, moderation=False):
    paginator = ReviewPagination()
    page = paginator.paginate_queryset(qs, request, view=view)
    results = ReviewSerializer(page, many=True, context={'request': request, 'moderation': moderation}).data
    data = {
        'count': paginator.page.paginator.count,
        'next': paginator.get_next_link(),
        'previous': paginator.get_previous_link(),
        **(extra or {}),
        'results': results,
    }
    return Response(data)


def _with_related(qs):
    return qs.select_related('author', 'event', 'vendor', 'venue')


class _TargetReviewsView(APIView):
    """GET: public reviews of one event/vendor/venue (newest first) + summary. POST: write your review."""
    authentication_classes = [OptionalJWTAuthentication]
    permission_classes = [permissions.AllowAny]
    kind = None

    def get_target(self, request, key):
        raise NotImplementedError

    def get(self, request, key):
        target = self.get_target(request, key)
        qs = _with_related(public_reviews().filter(**{self.kind: target}))
        viewer = None
        if request.user.is_authenticated:
            mine = Review.objects.filter(author=request.user, **{self.kind: target}).first()
            reason = None if mine else review_block(request.user, self.kind, target)
            viewer = {
                'can_review': mine is None and reason is None,
                'reason': reason,
                'my_review': ReviewSerializer(mine, context={'request': request, 'moderation': True}).data if mine else None,
            }
        return _paginate(self, request, qs.order_by('-created_at'), {'summary': summary(qs), 'viewer': viewer})

    def post(self, request, key):
        if not request.user.is_authenticated:
            return Response({'error': 'Sign in to write a review.', 'code': 'not_authenticated'},
                            status=status.HTTP_401_UNAUTHORIZED)
        target = self.get_target(request, key)
        if Review.objects.filter(author=request.user, **{self.kind: target}).exists():
            return Response({'error': 'You’ve already reviewed this. Edit your review instead.', 'code': 'already_reviewed'},
                            status=status.HTTP_409_CONFLICT)
        reason = review_block(request.user, self.kind, target)
        if reason:
            return Response({'error': reason, 'code': 'not_eligible'}, status=status.HTTP_403_FORBIDDEN)
        serializer = ReviewWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                review = Review.objects.create(
                    kind=self.kind, author=request.user, **{self.kind: target}, **serializer.validated_data,
                )
        except IntegrityError:
            return Response({'error': 'You’ve already reviewed this. Edit your review instead.', 'code': 'already_reviewed'},
                            status=status.HTTP_409_CONFLICT)
        return Response(ReviewSerializer(review, context={'request': request, 'moderation': True}).data,
                        status=status.HTTP_201_CREATED)


def _visible_listing(model, owner_field, user, pk):
    qs = model.objects.all()
    if not _is_admin(user):
        visible = Q(listing_status=ListingStatus.APPROVED)
        if user.is_authenticated:
            visible |= Q(**{owner_field: user})
        qs = qs.filter(visible)
    return get_object_or_404(qs, pk=pk)


class EventReviewsView(_TargetReviewsView):
    kind = Review.Kind.EVENT

    def get_target(self, request, key):
        return get_object_or_404(Event, slug=key, status__in=PUBLIC_EVENT_STATUSES)


class VendorReviewsView(_TargetReviewsView):
    kind = Review.Kind.VENDOR

    def get_target(self, request, key):
        return _visible_listing(VendorProfile, 'user', request.user, key)


class VenueReviewsView(_TargetReviewsView):
    kind = Review.Kind.VENUE

    def get_target(self, request, key):
        return _visible_listing(VenueListing, 'owner', request.user, key)


def _can_moderate_view(user, review):
    """Author, the owner of what was reviewed, and admins see hidden reviews and moderation fields."""
    return user.is_authenticated and (
        review.author_id == user.id or review.target_owner_id() == user.id or _is_admin(user)
    )


class ReviewDetailView(APIView):
    """GET one review; PATCH {rating?, text?} (author); DELETE (author or superadmin)."""
    authentication_classes = [OptionalJWTAuthentication]
    permission_classes = [permissions.AllowAny]

    def _review(self, request, review_id):
        review = get_object_or_404(_with_related(Review.objects.all()), pk=review_id)
        if review.is_hidden and not _can_moderate_view(request.user, review):
            raise Http404
        return review

    def get(self, request, review_id):
        review = self._review(request, review_id)
        ctx = {'request': request, 'moderation': _can_moderate_view(request.user, review)}
        return Response(ReviewSerializer(review, context=ctx).data)

    def patch(self, request, review_id):
        review = self._review(request, review_id)
        if not request.user.is_authenticated or review.author_id != request.user.id:
            return Response({'error': 'Only the author can edit this review.'}, status=status.HTTP_403_FORBIDDEN)
        serializer = ReviewWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        fields = ['edited_at', 'updated_at']
        for key in ('rating', 'text'):
            if key in request.data:
                setattr(review, key, serializer.validated_data[key])
                fields.append(key)
        review.edited_at = timezone.now()
        review.save(update_fields=fields)
        return Response(ReviewSerializer(review, context={'request': request, 'moderation': True}).data)

    def delete(self, request, review_id):
        review = self._review(request, review_id)
        if not request.user.is_authenticated or not (review.author_id == request.user.id or _is_admin(request.user)):
            return Response({'error': 'Only the author can delete this review.'}, status=status.HTTP_403_FORBIDDEN)
        review.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ReviewHideView(APIView):
    """POST {hidden: true|false, reason?}. Event organizers (their events) and superadmins only;
    vendor and venue owners can reply but not hide."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, review_id):
        review = get_object_or_404(_with_related(Review.objects.all()), pk=review_id)
        user = request.user
        allowed = _is_admin(user) or (review.kind == Review.Kind.EVENT and review.event.organizer_id == user.id)
        if not allowed:
            return Response({'error': 'Only the event organizer or a platform admin can hide reviews.'},
                            status=status.HTTP_403_FORBIDDEN)
        serializer = HideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        hidden = serializer.validated_data['hidden']
        review.is_hidden = hidden
        review.hidden_reason = serializer.validated_data['reason'] if hidden else ''
        review.hidden_by = user if hidden else None
        review.hidden_at = timezone.now() if hidden else None
        review.save(update_fields=['is_hidden', 'hidden_reason', 'hidden_by', 'hidden_at', 'updated_at'])
        return Response(ReviewSerializer(review, context={'request': request, 'moderation': True}).data)


class ReviewReplyView(APIView):
    """POST/PUT {text}: set the single public reply (replaces an earlier one). DELETE removes it.
    The owner of what was reviewed (organizer, vendor, venue owner) or a superadmin."""
    permission_classes = [permissions.IsAuthenticated]

    def _review(self, request, review_id):
        review = get_object_or_404(_with_related(Review.objects.all()), pk=review_id)
        if not (review.target_owner_id() == request.user.id or _is_admin(request.user)):
            return review, Response({'error': 'Only the owner of this listing can reply.'}, status=status.HTTP_403_FORBIDDEN)
        return review, None

    def post(self, request, review_id):
        review, error = self._review(request, review_id)
        if error:
            return error
        serializer = ReplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        review.reply_text = serializer.validated_data['text']
        review.reply_by = request.user
        review.replied_at = timezone.now()
        review.save(update_fields=['reply_text', 'reply_by', 'replied_at', 'updated_at'])
        return Response(ReviewSerializer(review, context={'request': request, 'moderation': True}).data)

    put = post

    def delete(self, request, review_id):
        review, error = self._review(request, review_id)
        if error:
            return error
        review.reply_text, review.reply_by, review.replied_at = '', None, None
        review.save(update_fields=['reply_text', 'reply_by', 'replied_at', 'updated_at'])
        return Response(ReviewSerializer(review, context={'request': request, 'moderation': True}).data)


class MyReviewsView(APIView):
    """The signed-in user's own reviews (including hidden ones), newest first. ?kind=event|vendor|venue"""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        qs = _with_related(Review.objects.filter(author=request.user))
        kind = request.query_params.get('kind')
        if kind in Review.Kind.values:
            qs = qs.filter(kind=kind)
        return _paginate(self, request, qs.order_by('-created_at'), moderation=True)


class ManageReviewsView(APIView):
    """Reviews of things the user owns (their events, vendor profiles, venues), hidden ones included.
    Superadmins see every review. Filters: ?kind=, ?event=<id>, ?vendor=<id>, ?venue=<id>, ?hidden=1|0"""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        qs = Review.objects.all()
        if not _is_admin(user):
            qs = qs.filter(Q(event__organizer=user) | Q(vendor__user=user) | Q(venue__owner=user))
        params = request.query_params
        if params.get('kind') in Review.Kind.values:
            qs = qs.filter(kind=params['kind'])
        try:
            for key in ('event', 'vendor', 'venue'):
                if params.get(key):
                    qs = qs.filter(**{f'{key}_id': params[key]})
        except (DjangoValidationError, ValueError):
            return Response({'error': 'Invalid id filter.'}, status=status.HTTP_400_BAD_REQUEST)
        if params.get('hidden') in ('1', 'true'):
            qs = qs.filter(is_hidden=True)
        elif params.get('hidden') in ('0', 'false'):
            qs = qs.filter(is_hidden=False)
        return _paginate(self, request, _with_related(qs).order_by('-created_at'), moderation=True)
