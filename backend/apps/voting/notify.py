"""Optional contestant notifications for contests (Poll.contestant_notify: off / email / sms / both).

Sent when a contestant is added, when a round is decided (through, or out), and when winners are announced.
Contact details come from Candidate.contact_email / contact_phone (filled from the application on import).
"""
import logging

from django.db import transaction

from .models import Candidate, Poll

logger = logging.getLogger(__name__)


def notify(candidate, subject, message):
    poll = candidate.poll
    mode = poll.contestant_notify
    if mode == Poll.Notify.OFF:
        return

    def send():
        from apps.core.email import send_simple_event_email
        from apps.platform.sms_credits import send_paid_sms
        try:
            if mode in (Poll.Notify.EMAIL, Poll.Notify.BOTH) and candidate.contact_email:
                send_simple_event_email(poll.event, candidate.contact_email, candidate.name, subject, message,
                                        f'{poll.title} · eventlaya.com/e/{poll.event.slug}/vote/{poll.slug or poll.id}')
            if mode in (Poll.Notify.SMS, Poll.Notify.BOTH) and candidate.contact_phone:
                send_paid_sms(poll.event.organizer, candidate.contact_phone, f'{poll.title}: {message}', f'{poll.title}: {candidate.name}')
        except Exception as e:  # a notification must never break the contest
            logger.warning('Contestant notification failed (%s): %s', candidate.pk, e)
    transaction.on_commit(send)


def added(candidate):
    notify(candidate, 'You are in the contest',
           f'You have been added to {candidate.poll.title}. Share your contestant page so people can vote for you.')


def round_decided(poll, summary):
    """After decide_round: tell who went through and who is out (summary has advanced / eliminated ids when given)."""
    nxt = summary.get('next_round_name') or 'the next round'
    for c in Candidate.objects.filter(poll=poll, pk__in=summary.get('advanced_ids') or []):
        notify(c, 'You are through', f'Congratulations! You are through to {nxt} in {poll.title}.')
    for c in Candidate.objects.filter(poll=poll, pk__in=summary.get('eliminated_ids') or []):
        notify(c, 'Thank you for taking part', f'Thank you for taking part in {poll.title}. You did not go through this time.')


def winners_announced(poll, placed):
    """placed: [(candidate, rank, title)] for the winners."""
    for c, rank, title in placed:
        notify(c, 'Results announced', f'Congratulations! You placed {title or f"#{rank}"} in {poll.title}.')
