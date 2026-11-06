"""Paid vote packs through apps.payments (purpose 'vote_pack'). See docs/voting.md §7 and docs/payments.md §5.

Flow: a verified voter picks a pack (or N votes at the per-vote price) → VotePurchase(pending) + PaymentIntent
(reference = purchase id) → Khalti / eSewa / test checkout → on_paid grants the credits to that voter (once, under the
intent's row lock) and, when the contest has "buy and vote" on and the purchase was made for a contestant, casts them.
"""
import logging
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import status

from apps.payments import services as pay
from apps.payments.registry import register_purpose
from . import captcha
from .credits import credit_balance, grant_credits, remove_unspent, spend_credits
from .models import Poll, Vote, VoteCredit, VotePurchase, audit, hash_voter, nepal_date

logger = logging.getLogger(__name__)

PURPOSE = 'vote_pack'
# Paid votes need an identity the buyer can't share by typing someone else's number
VERIFIED_MODES = (Poll.VoteMode.SMS_OTP, Poll.VoteMode.EMAIL_OTP, Poll.VoteMode.ACCOUNT, Poll.VoteMode.TICKET)
MAX_CUSTOM_VOTES = 1000
PURCHASE_BURST_PER_HOUR = 10  # flag: this many purchases from one IP within an hour


def payments_status(poll, user=None):
    """(available, reason or None, providers).

    reason: off (contest doesn't sell votes) | payments_off / paid_votes_off (superadmin modules; packs are hidden) |
    unverified_mode | no_provider | closed (packs shown as unavailable)."""
    from apps.accounts.modules import module_enabled
    from apps.payments.providers import available_providers
    if not poll.paid_votes_enabled:
        return False, 'off', []
    organizer = poll.event.organizer
    if not module_enabled('payments', user) or not module_enabled('payments', organizer):
        return False, 'payments_off', []
    if not module_enabled('paid_votes', user) or not module_enabled('paid_votes', organizer):
        return False, 'paid_votes_off', []
    if poll.vote_mode not in VERIFIED_MODES:
        return False, 'unverified_mode', []
    providers = available_providers()
    if not providers:
        return False, 'no_provider', []
    if poll.status != Poll.Status.OPEN:
        return False, 'closed', providers
    return True, None, providers


UNAVAILABLE_TEXT = {
    'off': 'This contest doesn’t sell votes.',
    'unverified_mode': 'Paid votes need verified voters (SMS code, email code, account or ticket).',
    'payments_off': 'Online payments are switched off right now.',
    'paid_votes_off': 'Paid votes are switched off right now.',
    'no_provider': 'No online payment method is available right now.',
    'closed': 'Voting isn’t open, so votes can’t be bought right now.',
}


# Superadmin switched paid votes (or payments) off: packs are hidden, not shown as "unavailable"
HIDDEN_REASONS = ('off', 'payments_off', 'paid_votes_off')


class PurchaseError(Exception):
    def __init__(self, message, code=status.HTTP_400_BAD_REQUEST, error_code=None, **extra):
        super().__init__(message)
        self.message, self.code, self.error_code, self.extra = message, code, error_code, extra

    def payload(self):
        data = {'error': self.message}
        if self.error_code:
            data['code'] = self.error_code
        data.update(self.extra)
        return data


def _offer(poll, data):
    """(pack or None, votes, bonus, amount, label) for {pack: id} or {votes: n} (at price_per_vote)."""
    pack_id = data.get('pack')
    if pack_id:
        pack = poll.vote_packs.filter(pk=pack_id, is_active=True).first() if len(str(pack_id)) >= 32 else None
        if pack is None:
            raise PurchaseError('That vote pack isn’t on sale anymore. Refresh and pick another.', 404, 'pack_not_found')
        total = pack.votes + pack.bonus_votes
        return pack, pack.votes, pack.bonus_votes, pay.money(pack.price), pack.label or f'{total} votes'
    if data.get('votes') is not None and poll.price_per_vote:
        try:
            n = int(data.get('votes'))
        except (TypeError, ValueError):
            n = 0
        if not 1 <= n <= MAX_CUSTOM_VOTES:
            raise PurchaseError(f'Buy between 1 and {MAX_CUSTOM_VOTES} votes.')
        return None, n, 0, pay.money(Decimal(poll.price_per_vote) * n), f'{n} {"vote" if n == 1 else "votes"}'
    raise PurchaseError('Pick a vote pack.')


def _payer(poll, data, request, voter_hash, ticket):
    """Contact details for refunds — kept only when they belong to the verified voter."""
    from .sms import normalize_nepal_mobile
    user = getattr(request, 'user', None)
    name, email, phone = (data.get('payer_name') or '').strip()[:100], '', ''
    if ticket is not None:
        return name or ticket.attendee_name, ticket.attendee_email, ticket.attendee_phone or ''
    if user is not None and user.is_authenticated and poll.vote_mode == Poll.VoteMode.ACCOUNT:
        return name or user.get_full_name(), user.email, user.phone or ''
    raw_phone = (data.get('payer_phone') or '').strip()
    if raw_phone:
        try:
            p = normalize_nepal_mobile(raw_phone)
            if hash_voter(f'contact:{p}') == voter_hash:
                phone = p
        except ValueError:
            pass
    raw_email = (data.get('payer_email') or '').strip().lower()
    if raw_email and hash_voter(f'contact:{raw_email}') == voter_hash:
        email = raw_email
    return name, email, phone


def _flags(poll, voter_hash, ip_hash, device_hash, now):
    flags = []
    if ip_hash and VotePurchase.objects.filter(poll=poll, ip_hash=ip_hash, created_at__gte=now - timedelta(hours=1)).count() + 1 >= PURCHASE_BURST_PER_HOUR:
        flags.append('purchase_burst')
    if poll.flag_device_voters and device_hash:
        buyers = set(VotePurchase.objects.filter(poll=poll, device_hash=device_hash).values_list('voter_identifier', flat=True))
        buyers.add(voter_hash)
        if len(buyers) >= poll.flag_device_voters:
            flags.append('shared_device_purchases')
    return flags


def default_return_url(poll, contestant=None):
    from apps.core.email import site_url
    path = f'/e/{poll.event.slug}/vote/{poll.slug or poll.id}'
    if contestant is not None:
        path += f'/c/{contestant.number if contestant.number is not None else contestant.slug}'
    return f'{site_url(poll.event)}{path}'


def start_purchase(poll, data, request):
    """Create a purchase + payment intent and start the checkout. Returns the API response dict."""
    from .rules import client_ip, eligible_ids, current_round, find_contestant, network_hashes, resolve_voter, VoteError
    available, reason, _ = payments_status(poll, getattr(request, 'user', None))
    if not available:
        if reason in HIDDEN_REASONS:
            from .access import PAID_VOTES
            raise PurchaseError('This feature is turned off for your account.', 403, 'module_disabled', module=PAID_VOTES, reason=reason)
        raise PurchaseError(UNAVAILABLE_TEXT[reason], 409 if reason == 'closed' else 403, 'payments_unavailable', reason=reason)
    pack, votes, bonus, amount, label = _offer(poll, data)
    provider = str(data.get('provider') or '')
    try:
        pay.check_provider(provider, amount)
    except pay.PaymentError as e:
        raise PurchaseError(e.message, e.code, 'provider_unavailable')
    if captcha.captcha_active(poll) and not captcha.verify(data.get('captcha_token'), client_ip(request)):
        raise PurchaseError('Complete the “I’m not a robot” check first.', 400, 'captcha_required')
    try:
        voter_hash, ticket = resolve_voter(poll, data, request)
    except VoteError as e:
        raise PurchaseError(e.message, e.code, e.error_code or 'verification_required')

    contestant = None
    if data.get('contestant'):
        contestant = find_contestant(poll, data.get('contestant'))
        if contestant is None:
            raise PurchaseError('That contestant isn’t in this contest.', 404)
    auto_vote = bool(poll.buy_and_vote and contestant is not None)
    if auto_vote and contestant.id not in eligible_ids(poll, None, current_round(poll) if poll.rounds.exists() else None):
        raise PurchaseError(f'{contestant.name} can’t receive votes right now, so votes can’t be bought for them.', 409, 'not_eligible')

    now = timezone.now()
    today = nepal_date(now)
    if poll.max_packs_per_day:
        bought = VotePurchase.objects.filter(poll=poll, voter_identifier=voter_hash, nepal_date=today,
                                             status__in=[VotePurchase.Status.PENDING, VotePurchase.Status.PAID]).count()
        if bought >= poll.max_packs_per_day:
            raise PurchaseError(f'You can buy {poll.max_packs_per_day} vote {"pack" if poll.max_packs_per_day == 1 else "packs"} a day. '
                                'Unfinished checkouts count until they time out. Try again tomorrow (Nepal time).', 429, 'pack_limit')
    ip_hash, _, device_hash = network_hashes(request, data)
    name, email, phone = _payer(poll, data, request, voter_hash, ticket)
    name = name or 'Voter'  # Khalti refuses customer_info (phone/email) without a name
    return_url = pay.safe_return_url(data.get('return_url')) or default_return_url(poll, contestant)

    with transaction.atomic():
        purchase = VotePurchase.objects.create(
            poll=poll, pack=pack, voter_identifier=voter_hash, method=poll.vote_mode, label=label[:120], votes=votes,
            bonus_votes=bonus, amount=amount, contestant=contestant, auto_vote=auto_vote, nepal_date=today, ip_hash=ip_hash,
            device_hash=device_hash, flags=_flags(poll, voter_hash, ip_hash, device_hash, now), created_at=now,
        )
        user = getattr(request, 'user', None)
        intent = pay.create_intent(
            purpose=PURPOSE, amount=amount, reference=str(purchase.id),
            description=f'{votes + bonus} votes · {poll.title}'[:200],
            payer_name=name, payer_email=email, payer_phone=phone, user=user,
            organizer=poll.event.organizer, event=poll.event,
            metadata={'contest': str(poll.id), 'pack': str(pack.id) if pack else None, 'voter': voter_hash,
                      'contestant': str(contestant.id) if contestant else None, 'purchase': str(purchase.id)},
            return_url=return_url,
        )
        purchase.intent = intent
        purchase.save(update_fields=['intent'])
    try:
        checkout = pay.start_checkout(intent, provider, request)
    except pay.PaymentError as e:
        pay.close(intent, intent.Status.FAILED, e.message)
        raise PurchaseError(e.message, e.code, 'checkout_failed')
    intent.refresh_from_db()
    return {
        'purchase': purchase_public(purchase),
        'payment': pay.public_intent(intent),
        'checkout': checkout,
    }


def purchase_public(p):
    return {
        'id': str(p.id), 'status': p.status, 'label': p.label, 'pack_id': str(p.pack_id) if p.pack_id else None,
        'votes': p.votes, 'bonus_votes': p.bonus_votes,
        'total_votes': p.total_votes, 'amount': str(p.amount), 'currency': 'NPR',
        'contestant': {'id': str(p.contestant_id), 'name': p.contestant.name, 'number': p.contestant.number,
                       'display_number': p.poll.format_number(p.contestant.number), 'slug': p.contestant.slug} if p.contestant_id else None,
        'auto_vote': p.auto_vote, 'auto_voted': p.auto_voted, 'auto_vote_note': p.auto_vote_note,
    }


# ---------------------------------------------------------------------------
# Payment purpose handlers


def _cast_paid(poll, purchase, payment_ref):
    """Buy and vote: cast the purchased votes for the chosen contestant if they can still receive votes.
    Returns (votes cast, note). Leaves the credits in the balance otherwise."""
    from .rules import current_round, eligible_ids
    poll = Poll.objects.select_for_update().select_related('event').get(pk=poll.pk)
    c = purchase.contestant
    if c is None:
        return 0, ''
    if poll.sync_status() != Poll.Status.OPEN:
        return 0, 'Voting had closed when the payment arrived; the votes are in your balance.'
    has_rounds = poll.rounds.exists()
    rnd = current_round(poll) if has_rounds else None
    if has_rounds and (rnd is None or not rnd.public_vote_enabled):
        return 0, 'No round was open for voting when the payment arrived; the votes are in your balance.'
    if not poll.main_vote_enabled or c.id not in eligible_ids(poll, None, rnd):
        return 0, f'{c.name} can’t receive votes right now; the votes are in your balance.'
    if not poll.allow_split and Vote.objects.filter(poll=poll, voter_identifier=purchase.voter_identifier, category__isnull=True,
                                                    round=rnd, is_void=False).exclude(candidate=c).exists():
        return 0, 'Your votes in this round already went to someone else; the votes are in your balance.'
    n = min(purchase.total_votes, credit_balance(poll, purchase.voter_identifier))
    if n <= 0:
        return 0, ''
    now = timezone.now()
    vote = Vote.objects.create(poll=poll, candidate=c, voter_identifier=purchase.voter_identifier, voted_at=now, round=rnd,
                               quantity=n, source=Vote.Source.PAID, method=purchase.method, nepal_date=nepal_date(now),
                               ip_hash=purchase.ip_hash, device_hash=purchase.device_hash, flags=list(purchase.flags))
    spend_credits(poll, purchase.voter_identifier, n, vote)
    return n, ''


def on_paid(intent):
    """Exactly once per intent (inside its row lock). Also runs for late payments after the purchase was marked failed."""
    purchase = VotePurchase.objects.select_for_update().select_related('poll__event', 'contestant').get(pk=intent.reference)
    if purchase.status == VotePurchase.Status.PAID:
        return
    poll = purchase.poll
    ref = str(intent.id)
    grant_credits(poll, purchase.voter_identifier, purchase.votes, VoteCredit.Source.PAID, purchase.pack, ref,
                  note=f'Bought: {purchase.label}')
    if purchase.bonus_votes:
        grant_credits(poll, purchase.voter_identifier, purchase.bonus_votes, VoteCredit.Source.BONUS, purchase.pack, ref,
                      note='Bonus votes')
    late = purchase.status == VotePurchase.Status.FAILED
    purchase.status, purchase.paid_at = VotePurchase.Status.PAID, timezone.now()
    if purchase.auto_vote:
        purchase.auto_voted, purchase.auto_vote_note = _cast_paid(poll, purchase, ref)
    purchase.save(update_fields=['status', 'paid_at', 'auto_voted', 'auto_vote_note'])
    audit(poll, None, 'votes_bought',
          f'{purchase.total_votes} votes bought (Rs {purchase.amount}){" — late payment" if late else ""}'
          f'{f", {purchase.auto_voted} cast for {purchase.contestant.name}" if purchase.auto_voted else ""}',
          purchase=str(purchase.id), payment=ref)


def on_failed(intent):
    VotePurchase.objects.filter(pk=intent.reference, status=VotePurchase.Status.PENDING).update(status=VotePurchase.Status.FAILED)


def on_refunded(intent):
    """Money went back: take back the votes of this payment that weren't used. Votes already cast stay (the organizer
    can void them in Votes & fraud); the audit log says how many."""
    purchase = VotePurchase.objects.select_for_update().select_related('poll').filter(pk=intent.reference).first()
    if purchase is None or purchase.status == VotePurchase.Status.REFUNDED:
        return
    poll = purchase.poll
    ref = str(intent.id)
    removed = remove_unspent(poll, purchase.voter_identifier, ref, f'Refund of payment {ref}: unspent votes removed')
    granted = VoteCredit.objects.filter(poll=poll, payment_ref=ref, amount__gt=0).aggregate(n=Sum('amount'))['n'] or 0
    used = max(0, granted - removed)
    purchase.status, purchase.refunded_at = VotePurchase.Status.REFUNDED, timezone.now()
    purchase.save(update_fields=['status', 'refunded_at'])
    audit(poll, None, 'votes_refunded',
          f'Payment refunded (Rs {purchase.amount}): {removed} unspent votes removed'
          + (f', {used} were already cast — void them in Votes & fraud if they shouldn’t count' if used else ''),
          purchase=str(purchase.id), payment=ref, removed=removed, already_cast=used)


def describe(intent):
    """Shown to whoever holds the payment id (the buyer) on the return page."""
    purchase = VotePurchase.objects.select_related('poll__event', 'contestant').filter(pk=intent.reference).first()
    if purchase is None:
        return None
    poll = purchase.poll
    paid = purchase.status == VotePurchase.Status.PAID
    return {
        'type': 'vote_pack',
        'purchase': purchase_public(purchase),
        'contest': {'id': str(poll.id), 'slug': poll.slug, 'title': poll.title, 'event_slug': poll.event.slug, 'event_title': poll.event.title},
        'credited': paid,
        'credits': credit_balance(poll, purchase.voter_identifier) if paid else None,
    }


def register():
    register_purpose(PURPOSE, on_paid=on_paid, on_failed=on_failed, on_refunded=on_refunded, describe=describe, label='Vote pack')
