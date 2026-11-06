import csv
import re
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Q, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from apps.accounts.authentication import OptionalJWTAuthentication
from apps.events.models import Event, EventTicket
from .access import CONTESTS, on_for_contest, require
from apps.accounts.modules import module_enabled
from .models import Candidate, Poll, Vote, hash_voter, nepal_date
from .rules import (  # noqa: F401  (re-exported: older code imports these from views)
    VoteError, account_ticket, cast_contest_vote, client_ip, network_hashes, normalize_contact, voter_key,
)
from .serializers import (
    PollSerializer,
    StandaloneCandidateSerializer,
    candidates_with_counts,
    polls_with_counts,
    public_poll_data,
)

BUCKET_MINUTES = 5
BUCKETS = 36  # three hours of five-minute buckets
PUBLIC_EVENT_STATUSES = [Event.Status.PUBLISHED, Event.Status.ONGOING, Event.Status.COMPLETED]


def sync_due_polls():
    """Apply schedules: open scheduled polls whose time has come, close polls past their closing time."""
    now = timezone.now()
    Poll.objects.filter(status=Poll.Status.SCHEDULED, opens_at__lte=now).exclude(closes_at__lte=now).update(
        status=Poll.Status.OPEN, updated_at=now
    )
    Poll.objects.filter(status__in=[Poll.Status.SCHEDULED, Poll.Status.OPEN], closes_at__lte=now).update(
        status=Poll.Status.CLOSED, updated_at=now
    )


def can_manage(user, event):
    return bool(user and user.is_authenticated and (getattr(user, 'is_superadmin', False) or event.organizer_id == user.id))


class VoteThrottle(SimpleRateThrottle):
    """Per-IP limit on ballot submissions."""

    scope = 'vote'
    rate = '20/min'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}

    def allow_request(self, request, view):
        # Contests have their own per-contest IP/device limits (Poll.ip_votes_per_minute…), so a busy venue on one
        # Wi-Fi isn't capped at 20/min here.
        pid = getattr(view, 'kwargs', {}).get('poll_id')
        if pid and Poll.objects.filter(pk=pid, kind=Poll.Kind.CONTEST).exists():
            return True
        return super().allow_request(request, view)


class IsOrganizer(permissions.BasePermission):
    message = 'Only event organizers can manage polls.'

    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and (getattr(u, 'is_superadmin', False) or u.role == 'organizer'))


class PollViewSet(viewsets.ModelViewSet):
    serializer_class = PollSerializer
    permission_classes = [permissions.IsAuthenticated, IsOrganizer]

    def get_queryset(self):
        sync_due_polls()
        user = self.request.user
        qs = Poll.objects.all()
        if not getattr(user, 'is_superadmin', False):
            qs = qs.filter(event__organizer=user)
        if not module_enabled(CONTESTS, user):
            qs = qs.exclude(kind=Poll.Kind.CONTEST)
        event_id = self.request.query_params.get('event')
        if event_id:
            qs = qs.filter(event_id=event_id)
        return polls_with_counts(qs).order_by('order', 'created_at')

    def perform_create(self, serializer):
        event = serializer.validated_data['event']
        if not can_manage(self.request.user, event):
            raise PermissionDenied('You can only add polls to your own events.')
        if 'order' not in serializer.validated_data:
            serializer.validated_data['order'] = Poll.objects.filter(event=event).count()
        serializer.save()

    def _respond(self, poll, code=status.HTTP_200_OK):
        fresh = polls_with_counts(Poll.objects.filter(pk=poll.pk)).get()
        return Response(PollSerializer(fresh).data, status=code)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return self._respond(serializer.instance, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        serializer = self.get_serializer(self.get_object(), data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return self._respond(serializer.instance)

    @action(detail=True, methods=['post'])
    def open(self, request, pk=None):
        poll = self.get_object()
        if poll.candidates.count() < 2:
            return Response({'error': 'Add at least 2 candidates before opening voting.'}, status=status.HTTP_400_BAD_REQUEST)
        now = timezone.now()
        poll.status = Poll.Status.OPEN
        if poll.opens_at and poll.opens_at > now:
            poll.opens_at = now
        if poll.closes_at and poll.closes_at <= now:
            poll.closes_at = None
        poll.save()
        return self._respond(poll)

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        poll = self.get_object()
        now = timezone.now()
        poll.status = Poll.Status.CLOSED
        if not poll.closes_at or poll.closes_at > now:
            poll.closes_at = now
        poll.save()
        return self._respond(poll)

    @action(detail=True, methods=['post'])
    def reset(self, request, pk=None):
        poll = self.get_object()
        if request.data.get('confirm') is not True:
            return Response({'error': 'Send {"confirm": true} to delete every vote in this poll.'}, status=status.HTTP_400_BAD_REQUEST)
        deleted, _ = poll.votes.all().delete()
        return Response({'message': f'Deleted {deleted} votes.', 'deleted': deleted})

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def duplicate(self, request, pk=None):
        src = self.get_object()
        copy = Poll.objects.create(
            event=src.event,
            title=f'{src.title} (copy)'[:255],
            description=src.description,
            status=Poll.Status.DRAFT,
            vote_mode=src.vote_mode,
            require_checked_in=src.require_checked_in,
            allow_multiple=src.allow_multiple,
            max_choices=src.max_choices,
            results_visibility=src.results_visibility,
            show_on_public_page=src.show_on_public_page,
            order=Poll.objects.filter(event=src.event).count(),
        )
        Candidate.objects.bulk_create([
            Candidate(poll=copy, name=c.name, subtitle=c.subtitle, description=c.description, photo_url=c.photo_url, order=c.order)
            for c in src.candidates.all()
        ])
        return self._respond(copy, status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def results(self, request, pk=None):
        poll = self.get_object()
        return Response(build_results(poll))

    @action(detail=True, methods=['get'])
    def export(self, request, pk=None):
        poll = self.get_object()
        kind = request.query_params.get('kind', 'results')
        response = HttpResponse(content_type='text/csv; charset=utf-8')
        name = slugify(poll.title) or 'poll'
        writer = csv.writer(response)
        if kind == 'votes':
            response['Content-Disposition'] = f'attachment; filename="{name}-votes.csv"'
            writer.writerow(['Voted at', 'Candidate', 'Voter reference'])
            for v in poll.votes.filter(is_void=False).select_related('candidate').order_by('voted_at'):
                # Short hash prefix lets you spot multi-choice ballots without revealing who voted
                writer.writerow([timezone.localtime(v.voted_at).isoformat(timespec='seconds'), v.candidate.name, v.voter_identifier[:10]])
        else:
            response['Content-Disposition'] = f'attachment; filename="{name}-results.csv"'
            data = build_results(poll, timeline=False)
            writer.writerow(['Rank', 'Candidate', 'Team or subtitle', 'Votes', 'Percent of votes'])
            for c in data['candidates']:
                writer.writerow([c['rank'], c['name'], c['subtitle'], c['votes'], c['percentage']])
            writer.writerow([])
            writer.writerow(['Total votes', data['total_votes']])
            writer.writerow(['Voters', data['voters']])
            writer.writerow(['Registered attendees', data['turnout']['registered']])
        return response


def build_results(poll, timeline=True):
    poll.sync_status()
    cands = list(candidates_with_counts().filter(poll=poll))
    total = sum(c.vote_total for c in cands)
    voters = poll.votes.filter(is_void=False).values('voter_identifier').distinct().count()
    registered = poll.event.tickets.exclude(status=EventTicket.Status.CANCELLED).count()
    checked_in = poll.event.tickets.filter(Q(first_check_in__isnull=False) | Q(status__in=['checked_in', 'checked_out'])).count()
    ranked = sorted(cands, key=lambda c: -c.vote_total)
    top = ranked[0].vote_total if ranked else 0
    rank_of, prev, rank = {}, None, 0
    for i, c in enumerate(ranked):
        if c.vote_total != prev:
            rank, prev = i + 1, c.vote_total
        rank_of[c.id] = rank
    data = {
        'poll': {'id': str(poll.id), 'title': poll.title, 'status': poll.status, 'opens_at': poll.opens_at, 'closes_at': poll.closes_at},
        'total_votes': total,
        'voters': voters,
        'turnout': {
            'voters': voters,
            'registered': registered,
            'checked_in': checked_in,
            'pct_of_registered': round(voters * 100 / registered, 1) if registered else 0,
        },
        'leader_ids': [str(c.id) for c in cands if top and c.vote_total == top],
        'candidates': [
            {
                'id': str(c.id),
                'name': c.name,
                'subtitle': c.subtitle,
                'photo_url': c.photo_url,
                'votes': c.vote_total,
                'percentage': round(c.vote_total * 100 / total, 1) if total else 0,
                'rank': rank_of[c.id],
            }
            for c in cands
        ],
        'updated_at': timezone.now(),
    }
    if timeline:
        data['timeline'] = build_timeline(poll)
    return data


def build_timeline(poll):
    now = timezone.now()
    end = now
    if poll.status == Poll.Status.CLOSED:
        last = poll.votes.filter(is_void=False).order_by('-voted_at').values_list('voted_at', flat=True).first()
        end = min(now, poll.closes_at or last or now)
    step = timedelta(minutes=BUCKET_MINUTES)
    # Align buckets to the clock so labels read 10:05, 10:10…
    end = end.replace(second=0, microsecond=0) - timedelta(minutes=end.minute % BUCKET_MINUTES) + step
    start = end - step * BUCKETS
    counted = poll.votes.filter(is_void=False)
    before = counted.filter(voted_at__lt=start).aggregate(n=Sum('quantity'))['n'] or 0
    counts = [0] * BUCKETS
    for t, q in counted.filter(voted_at__gte=start, voted_at__lt=end).values_list('voted_at', 'quantity'):
        counts[int((t - start) / step)] += q
    out, running = [], before
    for i, n in enumerate(counts):
        running += n
        out.append({'t': start + step * i, 'count': n, 'cumulative': running})
    return {'bucket_minutes': BUCKET_MINUTES, 'before': before, 'points': out}


class CandidateViewSet(viewsets.ModelViewSet):
    serializer_class = StandaloneCandidateSerializer
    permission_classes = [permissions.IsAuthenticated, IsOrganizer]

    def get_queryset(self):
        user = self.request.user
        qs = candidates_with_counts()
        if not getattr(user, 'is_superadmin', False):
            qs = qs.filter(poll__event__organizer=user)
        poll_id = self.request.query_params.get('poll')
        return qs.filter(poll_id=poll_id) if poll_id else qs

    def perform_create(self, serializer):
        poll = get_object_or_404(Poll, pk=self.request.data.get('poll'))
        if not can_manage(self.request.user, poll.event):
            raise PermissionDenied('You can only add candidates to your own polls.')
        serializer.save(poll=poll, order=serializer.validated_data.get('order', poll.candidates.count()))


# ---------------------------------------------------------------------------
# Public (attendee) endpoints


def public_polls_qs(event):
    return polls_with_counts(Poll.objects.filter(event=event).exclude(status=Poll.Status.DRAFT)).order_by('order', 'created_at')


def with_viewer(data, poll, request):
    """Adds `viewer` (see viewer_vote_state) to public poll data."""
    data['viewer'] = viewer_vote_state(poll, getattr(request, 'user', None))
    return data


def get_public_event(slug, request=None):
    from apps.accounts.tenancy import scope_events
    events = scope_events(Event.objects.all(), request) if request is not None else Event.objects.all()
    return get_object_or_404(events, slug=slug, status__in=PUBLIC_EVENT_STATUSES)


class PublicEventPollsView(APIView):
    """Polls an attendee can see on the event page."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = [OptionalJWTAuthentication]  # adds viewer.has_voted for signed-in users

    def get(self, request, slug):
        sync_due_polls()
        event = get_public_event(slug, request)
        from .public_contest_views import contest_public_data
        polls = [
            contest_public_data(p, request, with_contestants=False) if p.is_contest else with_viewer(public_poll_data(p), p, request)
            for p in public_polls_qs(event).filter(show_on_public_page=True)
            if not p.is_contest or on_for_contest(CONTESTS, p, request.user if request.user.is_authenticated else None)
        ]
        return Response({'event': {'title': event.title, 'slug': event.slug}, 'polls': polls})


class PublicPollView(APIView):
    """One poll by id, including polls hidden from the event page (reachable by direct link/QR)."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = [OptionalJWTAuthentication]  # adds viewer.has_voted for signed-in users

    def get(self, request, slug, poll_id):
        sync_due_polls()
        event = get_public_event(slug, request)
        poll = get_object_or_404(public_polls_qs(event), pk=poll_id)
        if poll.is_contest:
            from .public_contest_views import contest_public_data
            from .rules import sync_rounds
            require(CONTESTS, request, poll)
            sync_rounds(poll)
            return Response(contest_public_data(poll, request))
        return Response(with_viewer(public_poll_data(poll), poll, request))


def viewer_vote_state(poll, user):
    """For a signed-in user: {has_voted, candidate_ids, can_vote_with_account}; None for anonymous visitors.

    has_voted is null when the server can't tell (open polls are one vote per device, not per account)."""
    if user is None or not user.is_authenticated:
        return None
    keys = []
    can_vote = False
    if poll.vote_mode == Poll.VoteMode.TICKET:
        tickets = EventTicket.objects.filter(event=poll.event, user=user).exclude(status=EventTicket.Status.CANCELLED)
        keys = [hash_voter(f'ticket:{t.id}') for t in tickets]
        can_vote = bool(keys)
    elif poll.vote_mode == Poll.VoteMode.ACCOUNT:
        keys = [hash_voter(f'user:{user.id}')]
        can_vote = True
    elif poll.vote_mode == Poll.VoteMode.CONTACT and user.email_verified:
        keys = [hash_voter(f'contact:{normalize_contact(user.email)}')]
        can_vote = True
    if not keys:
        return {'has_voted': None if poll.vote_mode in (Poll.VoteMode.OPEN, Poll.VoteMode.SMS_OTP, Poll.VoteMode.EMAIL_OTP) else False, 'candidate_ids': [],
                'can_vote_with_account': False}
    ids = [str(i) for i in Vote.objects.filter(poll=poll, voter_identifier__in=keys).values_list('candidate_id', flat=True)]
    return {'has_voted': bool(ids), 'candidate_ids': ids, 'can_vote_with_account': can_vote}


def cast_ballot(poll_id, data, request, event=None):
    sync_due_polls()
    with transaction.atomic():
        # Lock the poll row so concurrent ballots from the same voter can't both pass the "already voted" check
        qs = Poll.objects.select_for_update().select_related('event')
        if event is not None:
            qs = qs.filter(event=event)
        poll = qs.filter(pk=poll_id).exclude(status=Poll.Status.DRAFT).first()
        if not poll:
            raise VoteError('This poll doesn’t exist or isn’t public yet.', status.HTTP_404_NOT_FOUND)
        if poll.is_contest:
            raise VoteError('This is a contest. Vote on its page.', status.HTTP_409_CONFLICT, 'is_contest')
        state = poll.sync_status()
        if state == Poll.Status.SCHEDULED:
            raise VoteError('Voting hasn’t opened yet. Come back when it starts.', status.HTTP_409_CONFLICT)
        if state == Poll.Status.CLOSED:
            raise VoteError('Voting has closed for this poll.', status.HTTP_409_CONFLICT)

        ids = data.get('candidate_ids')
        if ids is None and data.get('candidate_id'):
            ids = [data.get('candidate_id')]
        if not isinstance(ids, list) or not ids:
            raise VoteError('Pick who you’re voting for.')
        ids = list(dict.fromkeys(str(i) for i in ids))
        limit = poll.choices_allowed
        if len(ids) > limit:
            raise VoteError(f'You can pick up to {limit} {"candidate" if limit == 1 else "candidates"}.')
        cands = list(poll.candidates.filter(id__in=ids)) if all(re.fullmatch(r'[0-9a-fA-F-]{32,36}', i) for i in ids) else []
        if len(cands) != len(ids):
            raise VoteError('One of your picks isn’t on this ballot anymore. Refresh and try again.')

        if poll.vote_mode in (Poll.VoteMode.SMS_OTP, Poll.VoteMode.EMAIL_OTP):
            from .otp import read_voter_token
            found = read_voter_token(poll, data.get('voter_token'))
            if not found:
                raise VoteError('Verify with a one-time code to vote.', status.HTTP_401_UNAUTHORIZED, 'verification_required')
            voter_hash = found[0]
        else:
            raw, ticket = voter_key(poll, data, request)
            voter_hash = hash_voter(raw)
        if poll.vote_mode in (Poll.VoteMode.SMS_OTP, Poll.VoteMode.EMAIL_OTP):
            ticket = None
        if Vote.objects.filter(poll=poll, voter_identifier=voter_hash).exists():
            raise VoteError('You’ve already voted in this poll. Each person gets one ballot.', status.HTTP_409_CONFLICT)
        try:
            ip_hash, subnet_hash, device_hash = network_hashes(request, data)
            now = timezone.now()
            Vote.objects.bulk_create([
                Vote(poll=poll, candidate=c, ticket=ticket, voter_identifier=voter_hash, voted_at=now, nepal_date=nepal_date(now),
                     method=poll.vote_mode, ip_hash=ip_hash, subnet_hash=subnet_hash, device_hash=device_hash,
                     unique_key=f'{voter_hash}:{c.id}')
                for c in cands
            ])
        except IntegrityError:
            raise VoteError('You’ve already voted in this poll. Each person gets one ballot.', status.HTTP_409_CONFLICT)
    names = ', '.join(c.name for c in cands)
    fresh = polls_with_counts(Poll.objects.filter(pk=poll.pk)).get()
    return poll, cands, names, public_poll_data(fresh)


class PublicVoteView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = [OptionalJWTAuthentication]  # signed-in attendees vote without a ticket code
    throttle_classes = [VoteThrottle]

    def post(self, request, slug, poll_id):
        event = get_public_event(slug, request)
        contest = Poll.objects.filter(event=event, pk=poll_id, kind=Poll.Kind.CONTEST).exclude(status=Poll.Status.DRAFT).first()
        if contest is not None:
            require(CONTESTS, request, contest)
            try:
                return Response(cast_contest_vote(contest, request.data, request), status=status.HTTP_201_CREATED)
            except VoteError as e:
                return Response(e.payload(), status=e.code)
        try:
            poll, cands, names, poll_data = cast_ballot(poll_id, request.data, request, event=event)
        except VoteError as e:
            return Response(e.payload(), status=e.code)
        with_viewer(poll_data, poll, request)
        return Response(
            {'message': f'Your vote for {names} is in.', 'candidate_ids': [str(c.id) for c in cands], 'poll': poll_data},
            status=status.HTTP_201_CREATED,
        )


class CastVoteView(APIView):
    """Legacy endpoint: POST /api/voting/polls/<id>/vote/ {candidate_id, voter_identifier | ticket_token}."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = [OptionalJWTAuthentication]
    throttle_classes = [VoteThrottle]

    def post(self, request, poll_id):
        try:
            _, cands, names, poll_data = cast_ballot(poll_id, request.data, request)
        except VoteError as e:
            return Response(e.payload(), status=e.code)
        return Response(
            {
                'message': f'Vote recorded for {names}.',
                'candidate_id': str(cands[0].id),
                'new_vote_count': next((c['votes'] for c in poll_data['candidates'] if c['id'] == str(cands[0].id)), None),
            },
            status=status.HTTP_201_CREATED,
        )
