"""Email + push for booking requests. Everything runs after the DB commit and never raises into the request."""
import logging
import threading

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction

from apps.core import fcm

logger = logging.getLogger(__name__)

# Tests switch this off to send pushes inline.
PUSH_IN_THREAD = True


def _frontend(path):
    return f"{getattr(settings, 'FRONTEND_URL', 'https://eventlaya.com').rstrip('/')}{path}"


def _email(to, subject, text):
    if not to:
        return
    try:
        send_mail(subject=subject, message=text,
                  from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', 'passes@eventlaya.com'),
                  recipient_list=[to], fail_silently=True)
    except Exception:  # pragma: no cover - fail_silently doesn't cover everything (e.g. bad backend path)
        logger.exception('marketplace: booking email to %s failed', to)


def _push(user_id, title, body, data):
    if not user_id:
        return
    from apps.accounts.models import FCMToken
    tokens = list(FCMToken.objects.filter(user_id=user_id).values_list('token', flat=True))
    if not tokens:
        return

    def _send():
        for token in tokens:
            try:
                fcm.send_push_notification(token, title, body, data)
            except Exception:  # pragma: no cover
                logger.exception('marketplace: booking push failed')

    if PUSH_IN_THREAD:
        threading.Thread(target=_send, daemon=True).start()
    else:
        _send()


def _after_commit(fn, *args):
    def _run():
        try:
            fn(*args)
        except Exception:  # pragma: no cover - notifications must never break bookings
            logger.exception('marketplace: booking notification failed')
    transaction.on_commit(_run, robust=True)


def _describe(inquiry):
    """(kind, listing name, owner user id, owner email, 'Sat 14 Nov 2026, 10:00–14:00 · Main Hall')"""
    if hasattr(inquiry, 'venue_id'):
        listing = inquiry.venue
        kind, name, owner_id = 'venue', listing.name, listing.owner_id
        owner_email = listing.contact_email or listing.owner.email
    else:
        listing = inquiry.vendor
        kind, name, owner_id = 'vendor', listing.business_name, listing.user_id
        owner_email = listing.email or listing.user.email
    slot = inquiry.slot
    if slot is not None:
        when = f'{slot.date:%a %d %b %Y}'
        when += ', full day' if slot.is_full_day else f', {slot.start_time:%H:%M}–{slot.end_time:%H:%M}'
        if slot.space_id:
            when += f' · {slot.space.name}'
    else:
        when = f'{inquiry.event_date:%a %d %b %Y}' if inquiry.event_date else 'date to be agreed'
    return kind, name, owner_id, owner_email, when


def _data(inquiry, kind, type_):
    return {'type': type_, 'kind': kind, 'inquiry_id': str(inquiry.id),
            'slot_id': str(inquiry.slot_id) if inquiry.slot_id else ''}


def _new_request(inquiry):
    kind, name, owner_id, owner_email, when = _describe(inquiry)
    _email(owner_email, f'New booking request: {name} – {when}', f"""Namaste,

{inquiry.sender_name} wants to book {name} for {when}.

• Phone   : {inquiry.sender_phone}
• Email   : {inquiry.sender_email}
• Event   : {inquiry.event_type or '-'}
• Message : {inquiry.message}

The slot is on hold until you confirm or decline the request in your business portal:
{_frontend('/app/inquiries')}

Eventlaya
""")
    _push(owner_id, 'New booking request', f'{inquiry.sender_name} · {name} · {when}',
          _data(inquiry, kind, 'booking_request'))


def _decision(inquiry):
    kind, name, _owner_id, _owner_email, when = _describe(inquiry)
    confirmed = inquiry.status == 'booked'
    verb = 'confirmed' if confirmed else 'declined'
    note = f'\nMessage from {name}: {inquiry.owner_note}\n' if inquiry.owner_note else ''
    _email(inquiry.sender_email, f'Your booking with {name} was {verb}', f"""Namaste {inquiry.sender_name},

{name} has {verb} your request for {when}.
{note}
See your requests: {_frontend('/app/my/inquiries')}

Eventlaya
""")
    _push(inquiry.user_id, f'Booking {verb}', f'{name} · {when}',
          _data(inquiry, kind, 'booking_confirmed' if confirmed else 'booking_declined'))


def _cancelled(inquiry):
    kind, name, owner_id, owner_email, when = _describe(inquiry)
    reopened = ' The slot is open again for other customers.' if inquiry.slot_id else ''
    _email(owner_email, f'Booking cancelled: {name} – {when}', f"""Namaste,

{inquiry.sender_name} cancelled their request for {name} on {when}.{reopened}

Eventlaya
""")
    _push(owner_id, 'Booking cancelled', f'{inquiry.sender_name} · {name} · {when}',
          _data(inquiry, kind, 'booking_cancelled'))


def _owner_cancelled(inquiry):
    kind, name, _owner_id, _owner_email, when = _describe(inquiry)
    note = f'\nMessage from {name}: {inquiry.owner_note}\n' if inquiry.owner_note else ''
    if inquiry.sender_email:
        _email(inquiry.sender_email, f'Your booking with {name} was cancelled', f"""Namaste {inquiry.sender_name},

{name} has cancelled your booking for {when}.
{note}
Contact them if you have questions.

Eventlaya
""")
    _push(inquiry.user_id, 'Booking cancelled', f'{name} · {when}', _data(inquiry, kind, 'booking_cancelled'))


def notify_owner_cancelled(inquiry):
    _after_commit(_owner_cancelled, inquiry)


def notify_new_request(inquiry):
    _after_commit(_new_request, inquiry)


def notify_decision(inquiry):
    _after_commit(_decision, inquiry)


def notify_cancelled(inquiry):
    _after_commit(_cancelled, inquiry)
