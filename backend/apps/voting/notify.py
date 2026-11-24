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
    """Added to the contest. While it's open they get their links right away; otherwise when voting opens."""
    if candidate.poll.status == Poll.Status.OPEN:
        invite(candidate)
    else:
        notify(candidate, 'You are in the contest',
               f'You have been added to {candidate.poll.title}. We will send your own voting link when voting opens.')


def invite(candidate):
    """Voting is open: the contestant's own page to share, plus (when allowed) the private link to edit it. Once."""
    from django.utils import timezone
    from .self_edit_views import profile_links
    if candidate.invited_at or candidate.status != Candidate.Status.ACTIVE:
        return
    links = profile_links(candidate)
    msg = (f'Voting is open in {candidate.poll.title}! Share your page so friends can vote for you: {links["profile_url"]}')
    if candidate.poll.contestants_can_edit:
        msg += f'\n\nUpdate your photo and bio here (private link, don\'t share it): {links["edit_url"]}'
    notify(candidate, 'Voting is open: share your page', msg)
    Candidate.objects.filter(pk=candidate.pk).update(invited_at=timezone.now())


def voting_opened(poll):
    """Called when a contest opens (button or schedule): invite every active contestant not invited yet, and send
    the "Notify me" reminders (each once; the contact is deleted after)."""
    for c in poll.candidates.filter(status=Candidate.Status.ACTIVE, invited_at__isnull=True):
        invite(c)
    send_reminders(poll)


def send_reminders(poll):
    from apps.core.email import site_url
    from apps.core.email_layout import send_branded
    from .models import ContestReminder
    rows = list(ContestReminder.objects.filter(poll=poll))
    if not rows:
        return
    ContestReminder.objects.filter(pk__in=[r.pk for r in rows]).delete()
    url = f'{site_url(poll.event)}/e/{poll.event.slug}/vote/{poll.slug or poll.id}'
    title = poll.title[:60].encode('ascii', 'ignore').decode().strip() or 'the contest'

    def send():
        from apps.platform.sms_credits import send_paid_sms
        for r in rows:
            try:
                if r.channel == 'email':
                    send_branded(r.destination, f'Voting is open: {poll.title}', event=poll.event, title='Voting is open',
                                 paragraphs=[f'Voting is now open in {poll.title}. Vote for your favourite.'],
                                 button=('Vote now', url),
                                 after=['You asked us to tell you. We won’t message you again about it.'])
                else:
                    send_paid_sms(poll.event.organizer, r.destination, f'Voting is open in {title}. Vote here: {url}', f'{title}: reminder')
            except Exception as e:  # one failed reminder must not stop the rest
                logger.warning('Contest reminder failed (%s): %s', poll.pk, e)
    transaction.on_commit(send)


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
