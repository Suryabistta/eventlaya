"""Who may vote, how many times, and casting a contest vote (allowances, credits, rate limits, fraud flags)."""
import re
from datetime import timedelta

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework import status

from apps.events.models import EventTicket
from . import captcha
from .credits import credit_balance, spend_credits
from .models import Candidate, ContestCategory, ContestRound, Poll, Vote, hash_voter, keyed_hash, nepal_date
from .otp import read_voter_token

FLAG_WINDOW = timedelta(minutes=10)
UUID_RE = re.compile(r'^[0-9a-fA-F-]{32,36}$')


class VoteError(Exception):
    def __init__(self, message, code=status.HTTP_400_BAD_REQUEST, error_code=None, **extra):
        super().__init__(message)
        self.message, self.code, self.error_code, self.extra = message, code, error_code, extra

    def payload(self):
        data = {'error': self.message}
        if self.error_code:
            data['code'] = self.error_code
        data.update(self.extra)
        return data


# ---------------------------------------------------------------------------
# Request facts


def client_ip(request):
    return request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip() or request.META.get('REMOTE_ADDR', '')


def network_hashes(request, data):
    """(ip_hash, subnet_hash, device_hash) — keyed hashes, never the raw values."""
    ip = client_ip(request)
    if ':' in ip:  # IPv6: group by /48
        subnet = ':'.join(ip.split(':')[:3])
    else:
        subnet = '.'.join(ip.split('.')[:3])
    device = str(data.get('device_id') or '').strip()[:64]
    return (
        keyed_hash(f'ip:{ip}') if ip else '',
        keyed_hash(f'net:{subnet}') if subnet else '',
        keyed_hash(f'device:{device}') if device else '',
    )


# ---------------------------------------------------------------------------
# Voter identity (shared by quick polls and contests)


def normalize_contact(value):
    value = (value or '').strip().lower()
    if '@' in value:
        if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', value):
            raise VoteError('That email address doesn’t look right. Check it and try again.')
        return value
    digits = re.sub(r'\D', '', value)
    if len(digits) < 7:
        raise VoteError('Enter your phone number or email address to vote.')
    return digits[-10:]


def account_ticket(poll, user):
    """The user's usable ticket for the poll's event (checked-in ones first), or None."""
    tickets = EventTicket.objects.filter(event=poll.event, user=user).exclude(status=EventTicket.Status.CANCELLED)
    checked_in = tickets.filter(Q(first_check_in__isnull=False) | Q(status__in=['checked_in', 'checked_out'])).first()
    return checked_in or tickets.first()


def voter_key(poll, data, request):
    """Return (raw voter key, ticket or None) for ticket / contact / open / account modes."""
    user = getattr(request, 'user', None)
    signed_in = user is not None and user.is_authenticated
    if poll.vote_mode == Poll.VoteMode.TICKET:
        code = str(data.get('ticket_code') or data.get('ticket_token') or '').strip()
        if not code and signed_in:
            # Signed-in attendee: use the ticket linked to their account. The voter key is still the ticket,
            # so voting by account and by pasting the code count as the same ballot.
            ticket = account_ticket(poll, user)
            if not ticket:
                raise VoteError('There’s no ticket for this event on your account. Enter the code from your pass, '
                                'or verify your email so tickets you registered get linked.', status.HTTP_403_FORBIDDEN)
        elif not code:
            raise VoteError('Enter the ticket code from your pass to vote.')
        else:
            ticket = EventTicket.objects.filter(event=poll.event).filter(Q(ticket_number__iexact=code) | Q(qr_token=code)).first()
        if not ticket:
            raise VoteError('We couldn’t find that ticket for this event. Check the code printed under the QR on your pass.')
        if ticket.status == EventTicket.Status.CANCELLED:
            raise VoteError('This ticket has been cancelled, so it can’t vote.', status.HTTP_403_FORBIDDEN)
        if poll.require_checked_in and not (ticket.first_check_in or ticket.status in ('checked_in', 'checked_out')):
            raise VoteError('Your ticket hasn’t been scanned at the gate yet. Check in at the entrance, then vote.', status.HTTP_403_FORBIDDEN)
        return f'ticket:{ticket.id}', ticket
    if poll.vote_mode == Poll.VoteMode.CONTACT:
        raw = data.get('contact') or data.get('voter_identifier') or ''
        if not raw and signed_in and user.email_verified:
            raw = user.email  # signed in with a verified email: same key as typing that email
        return f'contact:{normalize_contact(raw)}', None
    if poll.vote_mode == Poll.VoteMode.ACCOUNT:
        if not signed_in:
            raise VoteError('Sign in to vote.', status.HTTP_401_UNAUTHORIZED, 'sign_in_required')
        return f'user:{user.id}', None
    if poll.vote_mode in (Poll.VoteMode.SMS_OTP, Poll.VoteMode.EMAIL_OTP):
        raise VoteError('Verify with a one-time code first.', status.HTTP_401_UNAUTHORIZED, 'verification_required')
    device = str(data.get('device_id') or '').strip()[:64]
    if device:
        return f'device:{device}', None
    return f'ip:{client_ip(request)}', None


def resolve_voter(poll, data, request):
    """(voter_hash, ticket) for any vote mode. OTP modes need the signed voter_token from /otp/verify/."""
    if poll.vote_mode in (Poll.VoteMode.SMS_OTP, Poll.VoteMode.EMAIL_OTP):
        found = read_voter_token(poll, data.get('voter_token'))
        if not found or not found[0]:
            what = 'phone number' if poll.vote_mode == Poll.VoteMode.SMS_OTP else 'email'
            raise VoteError(f'Verify your {what} with a one-time code to vote.', status.HTTP_401_UNAUTHORIZED, 'verification_required')
        return found[0], None
    raw, ticket = voter_key(poll, data, request)
    return hash_voter(raw), ticket


# ---------------------------------------------------------------------------
# Rounds and eligibility


def sync_rounds(poll, now=None):
    for r in poll.rounds.all():
        r.sync_status(now)


def current_round(poll, now=None):
    """The open round taking public votes (latest by order), or None."""
    now = now or timezone.now()
    open_rounds = [r for r in poll.rounds.all() if r.computed_status(now) == ContestRound.Status.OPEN]
    voting = [r for r in open_rounds if r.public_vote_enabled]
    return (voting or open_rounds or [None])[-1]


def display_round(poll, now=None):
    """Round to show on public pages: the open one, else the latest that has started, else the first."""
    now = now or timezone.now()
    rounds = list(poll.rounds.all())
    if not rounds:
        return None
    cur = current_round(poll, now)
    if cur:
        return cur
    started = [r for r in rounds if r.computed_status(now) != ContestRound.Status.UPCOMING]
    return started[-1] if started else rounds[0]


def round_contestant_ids(round):
    return set(round.entries.exclude(contestant__status=Candidate.Status.WITHDRAWN).values_list('contestant_id', flat=True))


def eligible_ids(poll, category, round):
    """Contestant ids a public vote may go to right now."""
    active = poll.candidates.exclude(status=Candidate.Status.WITHDRAWN)
    if category is not None:
        nominees = set(category.nominees.values_list('id', flat=True))
        ids = set(active.values_list('id', flat=True))
        return (ids & nominees) if nominees else set(active.filter(status=Candidate.Status.ACTIVE).values_list('id', flat=True))
    if round is not None:
        competing = round.entries.filter(status__in=['competing']).values_list('contestant_id', flat=True)
        return set(active.filter(id__in=competing).values_list('id', flat=True))
    return set(active.filter(status__in=[Candidate.Status.ACTIVE, Candidate.Status.WINNER]).values_list('id', flat=True))


def find_contestant(poll, ref):
    """By id, slug or number ("7", "07", "#07")."""
    ref = str(ref or '').strip()
    if not ref:
        return None
    qs = poll.candidates.all()
    if UUID_RE.match(ref):
        c = qs.filter(pk=ref).first()
        if c:
            return c
    digits = ref.lstrip('#').lstrip(poll.number_prefix or '#')
    if digits.isdigit():
        c = qs.filter(number=int(digits)).first()
        if c:
            return c
    return qs.filter(slug=ref.lower()).first()


# ---------------------------------------------------------------------------
# Allowance


def limits_for(poll, category):
    per_voter = category.votes_per_voter if category is not None and category.votes_per_voter is not None else poll.votes_per_voter
    per_day = category.votes_per_day if category is not None and category.votes_per_day is not None else poll.votes_per_day
    return {
        'per_voter': per_voter,
        'per_day': per_day,
        'per_round': poll.votes_per_round if category is None else None,
        'per_contestant': poll.votes_per_contestant,
    }


def _used(qs):
    return qs.aggregate(n=Sum('quantity'))['n'] or 0


def free_remaining(poll, voter_hash, category, round, contestant=None, now=None):
    """Free votes this voter can still cast (None = no limit). Voided votes still count (no re-voting after a void)."""
    if not poll.free_votes_enabled:
        return 0
    today = nepal_date(now)
    lim = limits_for(poll, category)
    base = Vote.objects.filter(poll=poll, voter_identifier=voter_hash, category=category, source=Vote.Source.FREE)
    left = []
    if lim['per_voter'] is not None:
        left.append(lim['per_voter'] - _used(base))
    if lim['per_day'] is not None:
        left.append(lim['per_day'] - _used(base.filter(nepal_date=today)))
    if lim['per_round'] is not None and round is not None:
        left.append(lim['per_round'] - _used(base.filter(round=round)))
    if contestant is not None and lim['per_contestant'] is not None:
        cq = base.filter(candidate=contestant)
        if poll.contestant_cap_period == Poll.CapPeriod.DAY:
            cq = cq.filter(nepal_date=today)
        elif poll.contestant_cap_period == Poll.CapPeriod.ROUND and round is not None:
            cq = cq.filter(round=round)
        left.append(lim['per_contestant'] - _used(cq))
    if not left:
        return None
    return max(0, min(left))


def contestant_used(poll, voter_hash, category, round, contestant, now=None):
    """Free votes this voter already gave `contestant` in the per-contestant cap period (same count as free_remaining)."""
    cq = Vote.objects.filter(poll=poll, voter_identifier=voter_hash, category=category, source=Vote.Source.FREE, candidate=contestant)
    if poll.contestant_cap_period == Poll.CapPeriod.DAY:
        cq = cq.filter(nepal_date=nepal_date(now))
    elif poll.contestant_cap_period == Poll.CapPeriod.ROUND and round is not None:
        cq = cq.filter(round=round)
    return _used(cq)


def allowance_summary(poll, voter_hash, category=None, round=None, now=None, contestant=None):
    """Remaining votes. With `contestant`, also what this voter may still give them for free:
    contestant_free_remaining = the free votes a vote for them would accept right now (all limits, including the
    per-contestant cap; null when the contest has no per-contestant cap — then free_remaining applies), and
    contestant_used = free votes already given to them in the cap period. Credits are usable beyond the free cap,
    so the most one vote can give them is min(max_votes_per_submit, contestant_free_remaining + credits)."""
    lim = limits_for(poll, category)
    out = {
        'free_remaining': free_remaining(poll, voter_hash, category, round, now=now),
        'resets_daily': lim['per_day'] is not None,
        'credits': credit_balance(poll, voter_hash),
        'voted_for': list({str(i) for i in Vote.objects.filter(poll=poll, voter_identifier=voter_hash, category=category,
                                                               is_void=False).values_list('candidate_id', flat=True)}),
    }
    if contestant is not None:
        capped = lim['per_contestant'] is not None and poll.free_votes_enabled
        out.update({
            'contestant_id': str(contestant.id),
            'contestant_cap': lim['per_contestant'],
            'contestant_cap_period': poll.contestant_cap_period,
            'contestant_free_remaining': free_remaining(poll, voter_hash, category, round, contestant, now) if capped else None,
            'contestant_used': contestant_used(poll, voter_hash, category, round, contestant, now) if capped else None,
        })
    return out


# ---------------------------------------------------------------------------
# Fraud: rate limits (refuse) and flags (count, but show to the organizer)


def check_rate_limits(poll, ip_hash, device_hash, now):
    minute = now - timedelta(minutes=1)
    if poll.ip_votes_per_minute and ip_hash:
        n = Vote.objects.filter(poll=poll, ip_hash=ip_hash, voted_at__gte=minute).count()
        if n >= poll.ip_votes_per_minute:
            raise VoteError('Too many votes from this network right now. Wait a minute and try again.', 429, 'rate_limited')
    if poll.device_votes_per_minute and device_hash:
        n = Vote.objects.filter(poll=poll, device_hash=device_hash, voted_at__gte=minute).count()
        if n >= poll.device_votes_per_minute:
            raise VoteError('You’re voting too fast. Wait a minute and try again.', 429, 'rate_limited')


def fraud_flags(poll, voter_hash, ip_hash, subnet_hash, device_hash, now):
    flags = []
    since = now - FLAG_WINDOW
    recent = Vote.objects.filter(poll=poll, voted_at__gte=since)
    if poll.flag_ip_burst and ip_hash and _used(recent.filter(ip_hash=ip_hash)) + 1 >= poll.flag_ip_burst:
        flags.append('ip_burst')
    if poll.flag_subnet_burst and subnet_hash and _used(recent.filter(subnet_hash=subnet_hash)) + 1 >= poll.flag_subnet_burst:
        flags.append('subnet_burst')
    if poll.flag_device_voters and device_hash:
        voters = set(Vote.objects.filter(poll=poll, device_hash=device_hash).values_list('voter_identifier', flat=True).distinct())
        voters.add(voter_hash)
        if len(voters) >= poll.flag_device_voters:
            flags.append('shared_device')
    return flags


FLAG_LABELS = {
    'ip_burst': 'Many votes from one IP address in 10 minutes',
    'subnet_burst': 'Many votes from one network range in 10 minutes',
    'shared_device': 'One device used by several voters',
}


# ---------------------------------------------------------------------------
# Casting a contest vote


def _quantity(poll, data):
    try:
        q = int(data.get('quantity') or 1)
    except (TypeError, ValueError):
        raise VoteError('Choose how many votes to give.')
    if q < 1:
        raise VoteError('Choose how many votes to give.')
    cap = max(1, poll.max_votes_per_submit)
    if q > cap:
        raise VoteError(f'You can give up to {cap} {"vote" if cap == 1 else "votes"} at a time.')
    return q


def cast_contest_vote(poll, data, request):
    """Record a contest vote. Returns a dict for the API. Raises VoteError."""
    if captcha.captcha_active(poll) and not captcha.verify(data.get('captcha_token'), client_ip(request)):
        raise VoteError('Complete the “I’m not a robot” check, then vote again.', 400, 'captcha_required')

    now = timezone.now()
    with transaction.atomic():
        # Serialize votes on this contest so allowance checks can't be raced
        poll = Poll.objects.select_for_update().select_related('event').get(pk=poll.pk)
        state = poll.sync_status(now)
        if state in (Poll.Status.DRAFT,):
            raise VoteError('This contest isn’t public yet.', 404)
        if state == Poll.Status.SCHEDULED:
            raise VoteError('Voting hasn’t opened yet. Come back when it starts.', 409, 'not_open')
        if state == Poll.Status.CLOSED:
            raise VoteError('Voting has closed for this contest.', 409, 'closed')

        category = None
        if data.get('category'):
            category = ContestCategory.objects.filter(poll=poll, pk=data.get('category')).first() if UUID_RE.match(str(data.get('category'))) else None
            if category is None:
                category = ContestCategory.objects.filter(poll=poll, slug=str(data.get('category'))).first()
            if category is None:
                raise VoteError('That award category doesn’t exist anymore. Refresh and try again.', 404)
            if category.selection != ContestCategory.Selection.PUBLIC_VOTE:
                raise VoteError(f'“{category.name}” is decided by the {"judges" if category.selection == "judges" else "organizers"}, not by public vote.', 409)
        elif not poll.main_vote_enabled:
            raise VoteError('Pick an award category to vote in.')

        contestant = find_contestant(poll, data.get('contestant') or data.get('contestant_id') or data.get('candidate_id'))
        if contestant is None:
            raise VoteError('Pick who you’re voting for.', 404 if data.get('contestant') else 400)
        quantity = _quantity(poll, data)

        has_rounds = poll.rounds.exists()
        rnd = current_round(poll, now) if has_rounds else None
        if category is None and has_rounds:
            if rnd is None:
                raise VoteError('No round is open for voting right now. Check the schedule.', 409, 'no_open_round')
            if not rnd.public_vote_enabled:
                raise VoteError(f'{rnd.name} is decided by the judges. Public voting is closed in this round.', 409, 'no_public_vote')
        if contestant.id not in eligible_ids(poll, category, rnd if category is None else None):
            if contestant.status == Candidate.Status.WITHDRAWN:
                raise VoteError(f'{contestant.name} has withdrawn from the contest.', 409)
            if contestant.status == Candidate.Status.ELIMINATED:
                raise VoteError(f'{contestant.name} is no longer in the contest.', 409)
            raise VoteError(f'{contestant.name} can’t receive votes {"in this category" if category else "in this round"}.', 409)

        voter_hash, ticket = resolve_voter(poll, data, request)
        ip_hash, subnet_hash, device_hash = network_hashes(request, data)
        check_rate_limits(poll, ip_hash, device_hash, now)

        vote_round = rnd if category is None else None
        if not poll.allow_split:
            other = Vote.objects.filter(poll=poll, voter_identifier=voter_hash, category=category, round=vote_round,
                                        is_void=False).exclude(candidate=contestant).select_related('candidate').first()
            if other:
                raise VoteError(f'You already gave your votes to {other.candidate.name}. In this contest all your votes go to one contestant.',
                                409, 'no_split')

        free_left = free_remaining(poll, voter_hash, category, vote_round, contestant, now)
        free_use = quantity if free_left is None else min(quantity, free_left)
        paid_needed = quantity - free_use
        balance = credit_balance(poll, voter_hash) if paid_needed else 0
        if paid_needed and balance < paid_needed:
            lim = limits_for(poll, category)
            if free_use == 0 and lim['per_day'] is not None and poll.free_votes_enabled:
                msg = 'You’ve used today’s free votes. They reset at midnight, Nepal time.'
            elif free_use == 0:
                msg = 'You’ve used all your votes in this contest.' if poll.free_votes_enabled else 'Free voting is off in this contest.'
            else:
                msg = f'You have {free_use} free {"vote" if free_use == 1 else "votes"} left. Lower the number and try again.'
            if poll.paid_votes_enabled and poll.vote_packs.filter(is_active=True).exists():
                msg += ' You can get more votes with a vote pack.'
            raise VoteError(msg, 409, 'allowance_used', free_remaining=free_left, credits=balance)

        flags = fraud_flags(poll, voter_hash, ip_hash, subnet_hash, device_hash, now)
        common = dict(poll=poll, candidate=contestant, ticket=ticket, voter_identifier=voter_hash, voted_at=now, round=vote_round,
                      category=category, method=poll.vote_mode, nepal_date=nepal_date(now), ip_hash=ip_hash,
                      subnet_hash=subnet_hash, device_hash=device_hash, flags=flags)
        created = []
        if free_use:
            created.append(Vote.objects.create(quantity=free_use, source=Vote.Source.FREE, **common))
        if paid_needed:
            v = Vote.objects.create(quantity=paid_needed, source=Vote.Source.PAID, **common)
            spend_credits(poll, voter_hash, paid_needed, v)
            created.append(v)

    summary = allowance_summary(poll, voter_hash, category, vote_round, now, contestant=contestant)
    label = f'{poll.format_number(contestant.number)} {contestant.name}'.strip()
    return {
        'message': f'Your {quantity} {"vote" if quantity == 1 else "votes"} for {label} {"is" if quantity == 1 else "are"} in.',
        'contestant_id': str(contestant.id),
        'category_id': str(category.id) if category else None,
        'quantity': quantity,
        'allowance': summary,
    }
