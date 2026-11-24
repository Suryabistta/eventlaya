"""Module organizer_alerts: email the organizer when someone registers, buys tickets or applies to their event.

Sent in a background thread (the person signing up shouldn't wait for a second email), except with the test
mail backend, where it runs inline so tests can read the outbox.
"""
import logging
import threading

from django.conf import settings

logger = logging.getLogger(__name__)


def _dashboard(path):
    return f"{getattr(settings, 'FRONTEND_URL', 'https://eventlaya.com').rstrip('/')}{path}"


def _enabled(event):
    from apps.accounts.modules import module_enabled
    organizer = getattr(event, 'organizer', None)
    return bool(organizer and organizer.email and module_enabled('organizer_alerts', organizer))


def _dispatch(fn):
    if 'locmem' in settings.EMAIL_BACKEND:
        fn()
        return

    def run():
        from django.db import connection
        try:
            fn()
        except Exception as e:  # an alert must never break a sign-up
            logger.warning('Organizer alert failed: %s', e)
        finally:
            connection.close()
    threading.Thread(target=run, daemon=True, name='organizer-alert').start()


def _send(event, subject, title, paragraphs, details, button):
    from apps.core.email_layout import eventlaya_brand, send_branded
    from apps.events.sub_events import display_title
    to = event.organizer.email
    name = event.organizer.organization_name or event.organizer.first_name or None
    _dispatch(lambda: send_branded(
        to, f'{subject} · {display_title(event)}', brand=eventlaya_brand(), title=title, name=name,
        paragraphs=paragraphs, details=[('Event', display_title(event)), *details], button=button,
        after=['You get these emails because organizer alerts are on for your account.'],
    ))


def new_order(order, tickets, event):
    """Tickets booked (free, pay at the venue, or paid online)."""
    if not _enabled(event) or not tickets:
        return
    who = order.buyer_name if order is not None else tickets[0].attendee_name
    count = len(tickets)
    details = [('Name', who), ('Email', (order.buyer_email if order is not None else tickets[0].attendee_email) or '-')]
    if order is not None:
        details += [('Order', order.reference), ('Payment', order.payment_label)]
    details.append(('Tickets', ', '.join(sorted({t.ticket_type_name or 'Ticket' for t in tickets})) + f' × {count}'))
    _send(event, f'New booking: {who}', 'New booking',
          [f'{who} booked {count} ticket{"s" if count != 1 else ""}.'], details,
          ('See analytics', _dashboard(f'/app/events/{event.id}/analytics')))


def new_registration(ticket, event):
    """Registration-only events."""
    if not _enabled(event):
        return
    _send(event, f'New registration: {ticket.attendee_name}', 'New registration',
          [f'{ticket.attendee_name} registered.'],
          [('Name', ticket.attendee_name), ('Email', ticket.attendee_email or '-'),
           ('Phone', ticket.attendee_phone or '-'), ('Registration no.', ticket.ticket_number)],
          ('See analytics', _dashboard(f'/app/events/{event.id}/analytics')))


def new_application(response, event):
    if not _enabled(event):
        return
    _send(event, f'New application: {response.submitter_name}', 'New application',
          [f'{response.submitter_name} applied. Review it and accept or reject.'],
          [('Name', response.submitter_name), ('Email', response.submitter_email or '-'),
           ('Phone', response.submitter_phone or '-'), ('Application no.', response.number)],
          ('Review applications', _dashboard('/app/applications')))
