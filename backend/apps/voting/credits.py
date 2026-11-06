"""Vote credit ledger — the extension point for paid vote packs.

Free votes are an allowance computed from Vote rows; anything beyond it is spent from this ledger.
apps.payments (Khalti / eSewa) should, once a vote-pack payment is confirmed, call:

    from apps.voting.credits import grant_pack, voter_hash_for
    voter = voter_hash_for(poll, phone='98XXXXXXXX')        # or email=..., user=..., ticket=...
    grant_pack(pack, voter, payment_ref=str(payment.id))    # idempotent per payment_ref

The buyer must be identified exactly like the contest identifies voters (see voter_hash_for); the contest's
vote mode decides which identity is meaningful (SMS OTP → phone, email OTP → email, account → user …).
"""
from django.db import IntegrityError, transaction
from django.db.models import Sum

from .models import Poll, VoteCredit, VotePack, hash_voter


def credit_balance(poll, voter_hash):
    return VoteCredit.objects.filter(poll=poll, voter_identifier=voter_hash).aggregate(n=Sum('amount'))['n'] or 0


def voter_hash_for(poll, *, phone=None, email=None, user=None, ticket=None, device_id=None):
    """The voter_identifier a vote from this person would carry in `poll`."""
    from .sms import normalize_nepal_mobile
    if ticket is not None:
        return hash_voter(f'ticket:{ticket.id}')
    if user is not None and poll.vote_mode == Poll.VoteMode.ACCOUNT:
        return hash_voter(f'user:{user.id}')
    if phone:
        return hash_voter(f'contact:{normalize_nepal_mobile(phone)}')
    if email:
        return hash_voter(f'contact:{email.strip().lower()}')
    if user is not None:
        return hash_voter(f'user:{user.id}')
    if device_id:
        return hash_voter(f'device:{device_id}')
    raise ValueError('Give phone, email, user, ticket or device_id.')


def grant_credits(poll, voter_hash, votes, source=VoteCredit.Source.PAID, pack=None, payment_ref=None, note='', actor=None):
    """Add `votes` credits. With payment_ref the call is idempotent (a repeated callback returns the first row)."""
    if votes <= 0:
        raise ValueError('votes must be positive')
    try:
        with transaction.atomic():
            return VoteCredit.objects.create(
                poll=poll, voter_identifier=voter_hash, source=source, amount=votes, pack=pack,
                payment_ref=payment_ref or None, note=note[:255], created_by=actor if getattr(actor, 'is_authenticated', False) else None,
            )
    except IntegrityError:
        return VoteCredit.objects.get(poll=poll, payment_ref=payment_ref, source=source)


def grant_pack(pack: VotePack, voter_hash, payment_ref, actor=None):
    """Credit a purchased pack: `votes` as paid + `bonus_votes` as bonus. Returns the list of ledger rows."""
    rows = [grant_credits(pack.poll, voter_hash, pack.votes, VoteCredit.Source.PAID, pack, payment_ref,
                          note=pack.label or f'{pack.votes} votes', actor=actor)]
    if pack.bonus_votes:
        rows.append(grant_credits(pack.poll, voter_hash, pack.bonus_votes, VoteCredit.Source.BONUS, pack, payment_ref,
                                  note='Bonus votes', actor=actor))
    return rows


def grants_remaining(poll, voter_hash, payment_ref=None):
    """[(grant row, unspent amount)] oldest first. Debits name their grant; older unlinked debits use up the oldest."""
    rows = list(VoteCredit.objects.filter(poll=poll, voter_identifier=voter_hash).order_by('created_at', 'id'))
    grants = [r for r in rows if r.amount > 0]
    left = {g.id: g.amount for g in grants}
    loose = 0
    for d in rows:
        if d.amount < 0:
            if d.grant_id in left:
                left[d.grant_id] += d.amount
            else:
                loose += -d.amount
    for g in grants:  # unlinked debits (none are created any more) come out of the oldest grants
        take = min(loose, left[g.id])
        left[g.id] -= take
        loose -= take
    out = [(g, left[g.id]) for g in grants if left[g.id] > 0]
    if payment_ref is not None:
        out = [(g, n) for g, n in out if g.payment_ref == payment_ref]
    return out


def spend_credits(poll, voter_hash, amount, vote):
    """Debit credits for a vote, oldest grant first (caller holds the contest lock and checked the balance).
    Records on the vote which payments the votes came from."""
    refs, rows = [], []
    for grant, left in grants_remaining(poll, voter_hash):
        if amount <= 0:
            break
        take = min(amount, left)
        rows.append(VoteCredit(poll=poll, voter_identifier=voter_hash, source=grant.source, amount=-take, vote=vote,
                               grant=grant, note='Spent on a vote'))
        refs.append(grant.payment_ref or grant.source)
        amount -= take
    if amount > 0:  # shouldn't happen (balance was checked); keep the ledger honest anyway
        rows.append(VoteCredit(poll=poll, voter_identifier=voter_hash, source=VoteCredit.Source.PAID, amount=-amount, vote=vote,
                               note='Spent on a vote (over balance)'))
    VoteCredit.objects.bulk_create(rows)
    if vote is not None:
        vote.payment_ref = ','.join(dict.fromkeys(refs))[:255]
        vote.save(update_fields=['payment_ref'])
    return rows


def remove_unspent(poll, voter_hash, payment_ref, note, actor=None):
    """After a refund: take back the credits of that payment that weren't used yet. Returns how many were removed."""
    removed = 0
    for grant, left in grants_remaining(poll, voter_hash, payment_ref=payment_ref):
        VoteCredit.objects.create(poll=poll, voter_identifier=voter_hash, source=grant.source, amount=-left, grant=grant,
                                  note=note[:255], created_by=actor if getattr(actor, 'is_authenticated', False) else None)
        removed += left
    return removed


def pack_price(pack):
    """Price + total votes, for the payment page."""
    return {'id': str(pack.id), 'label': pack.label, 'votes': pack.votes, 'bonus_votes': pack.bonus_votes,
            'total_votes': pack.votes + pack.bonus_votes, 'price': str(pack.price), 'currency': pack.poll.currency}
