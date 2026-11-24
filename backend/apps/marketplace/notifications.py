"""Email + push for booking requests. Everything runs after the DB commit and never raises into the request."""
import logging
import threading

from django.conf import settings
from django.db import transaction

from apps.core import fcm

logger = logging.getLogger(__name__)

# Tests switch this off to send pushes inline.
PUSH_IN_THREAD = True


def _frontend(path):
    return f"{getattr(settings, 'FRONTEND_URL', 'https://eventlaya.com').rstrip('/')}{path}"


def _email(to, subject, title, *, name=None, paragraphs=(), details=(), button=None, after=()):
    if not to:
        return
    from apps.core.email_layout import send_branded
    send_branded(to, subject, title=title, preheader=paragraphs[0] if paragraphs else title, name=name,
                 paragraphs=paragraphs, details=details, button=button, after=after)


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
    _email(owner_email, f'New booking request: {name} – {when}', 'New booking request',
           paragraphs=[f'{inquiry.sender_name} wants to book {name} for {when}.'],
           details=[('Name', inquiry.sender_name), ('Phone', inquiry.sender_phone or '-'), ('Email', inquiry.sender_email or '-'),
                    ('Event', inquiry.event_type or '-'), ('Message', inquiry.message or '-')],
           button=('Confirm or decline', _frontend('/app/inquiries')),
           after=['The slot is on hold until you confirm or decline the request.'])
    _push(owner_id, 'New booking request', f'{inquiry.sender_name} · {name} · {when}',
          _data(inquiry, kind, 'booking_request'))


def _decision(inquiry):
    kind, name, _owner_id, _owner_email, when = _describe(inquiry)
    confirmed = inquiry.status == 'booked'
    verb = 'confirmed' if confirmed else 'declined'
    _email(inquiry.sender_email, f'Your booking with {name} was {verb}', f'Booking {verb}', name=inquiry.sender_name,
           paragraphs=[f'{name} has {verb} your request for {when}.' + (' See you there!' if confirmed else ''),
                       *([f'Message from {name}: {inquiry.owner_note}'] if inquiry.owner_note else [])],
           button=('See my requests', _frontend('/app/my/inquiries')))
    _push(inquiry.user_id, f'Booking {verb}', f'{name} · {when}',
          _data(inquiry, kind, 'booking_confirmed' if confirmed else 'booking_declined'))


def _cancelled(inquiry):
    kind, name, owner_id, owner_email, when = _describe(inquiry)
    reopened = ' The slot is open again for other customers.' if inquiry.slot_id else ''
    _email(owner_email, f'Booking cancelled: {name} – {when}', 'Booking cancelled',
           paragraphs=[f'{inquiry.sender_name} cancelled their request for {name} on {when}.{reopened}'],
           button=('Open bookings', _frontend('/app/inquiries')))
    _push(owner_id, 'Booking cancelled', f'{inquiry.sender_name} · {name} · {when}',
          _data(inquiry, kind, 'booking_cancelled'))


def _owner_cancelled(inquiry):
    kind, name, _owner_id, _owner_email, when = _describe(inquiry)
    if inquiry.sender_email:
        _email(inquiry.sender_email, f'Your booking with {name} was cancelled', 'Booking cancelled', name=inquiry.sender_name,
               paragraphs=[f'{name} has cancelled your booking for {when}.',
                           *([f'Message from {name}: {inquiry.owner_note}'] if inquiry.owner_note else [])],
               after=['Contact them if you have questions.'])
    _push(inquiry.user_id, 'Booking cancelled', f'{name} · {when}', _data(inquiry, kind, 'booking_cancelled'))


def notify_owner_cancelled(inquiry):
    _after_commit(_owner_cancelled, inquiry)


def notify_new_request(inquiry):
    _after_commit(_new_request, inquiry)


def notify_decision(inquiry):
    _after_commit(_decision, inquiry)


def notify_cancelled(inquiry):
    _after_commit(_cancelled, inquiry)
