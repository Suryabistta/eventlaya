import logging
from django.conf import settings

logger = logging.getLogger(__name__)


def site_url(event):
    """Base URL for links about an event: the organizer's live white-label site, else FRONTEND_URL."""
    from apps.accounts.tenancy import site_url_for_organizer
    return (site_url_for_organizer(event.organizer) if event is not None else '') or \
        getattr(settings, 'FRONTEND_URL', 'https://eventlaya.com').rstrip('/')


def pass_url(ticket):
    """Public page that shows one pass (the QR token in the link is what grants access)."""
    return f"{site_url(ticket.event)}/ticket/{ticket.qr_token}"


def event_url(event):
    return f"{site_url(event)}/e/{event.slug}"


def email_brand(event):
    """(brand name, show "Powered by Eventlaya") for an event's emails."""
    from apps.accounts.tenancy import live_branding_for_organizer
    branding = live_branding_for_organizer(event.organizer)
    if branding is None:
        return 'Eventlaya', True
    return (branding.brand_name or event.organizer.organization_name or 'Eventlaya'), not branding.remove_watermark


def from_email(event):
    """'Dharan Film Festival via Eventlaya <passes@eventlaya.com>' for white-label events (same mailbox)."""
    from email.utils import formataddr, parseaddr
    default = getattr(settings, 'DEFAULT_FROM_EMAIL', 'passes@eventlaya.com')
    brand, _ = email_brand(event)
    if brand == 'Eventlaya':
        return default
    _name, address = parseaddr(default)
    return formataddr((f'{brand} via Eventlaya', address or 'passes@eventlaya.com'))

def payment_receipt(order):
    """[(label, value)] for the payment part of an order email: amount, how it was paid, reference."""
    if order is None:
        return []
    amount = f'Rs {order.total:,.2f}'
    if order.payment_status == 'free':
        return [('Total', 'Free')]
    if order.payment_status == 'due':
        return [('Total', f'{amount} to pay at the venue')]
    if order.payment_status == 'paid' and order.paid_via != 'venue':
        provider = {'khalti': 'Khalti', 'esewa': 'eSewa', 'test': 'Test payment'}.get(order.paid_via, order.paid_via)
        rows = [('Paid', f'{amount} online with {provider}')]
        if order.payment_reference:
            rows.append(('Payment reference', order.payment_reference))
        if order.paid_at:
            from django.utils import timezone
            rows.append(('Paid on', timezone.localtime(order.paid_at).strftime('%d %b %Y, %I:%M %p')))
        rows.append(('Receipt', f'Order {order.reference}'))
        return rows
    return [('Total', order.payment_label)]


def send_ticket_email(ticket, event, order=None):
    """The attendee's pass: ticket number, when/where, payment receipt and a button to the QR pass."""
    from apps.events.sub_events import display_title
    from .email_layout import event_when, send_branded
    title = display_title(event)  # "Main event › Sub-event" for a sub-event
    receipt = payment_receipt(order if order is not None else (ticket.order if ticket.order_id else None))
    ok = send_branded(
        ticket.attendee_email, f"Your pass: {title}", event=event,
        title="You're going!", preheader=f'Your pass for {title} · {ticket.ticket_number}',
        name=ticket.attendee_name,
        paragraphs=[f"Your place at {title} is confirmed. Show the QR code on your pass at the entrance."],
        code=ticket.ticket_number, code_label='Ticket number',
        details=[('Event', title), ('When', event_when(event)), ('Where', event.location or 'To be announced'), *receipt],
        button=('View my QR pass', pass_url(ticket)),
        after=['Save the pass on your phone or take a screenshot so it works without internet at the gate.'],
        links=[('Event page', event_url(event))],
    )
    if ok:
        logger.info(f"Ticket email dispatched to {ticket.attendee_email} for {ticket.ticket_number}")
    return ok


def send_registration_email(ticket, event):
    """Registration-only events (no pass): a plain confirmation of the registration, no QR or pass link."""
    from apps.events.sub_events import display_title
    from .email_layout import event_when, send_branded
    title = display_title(event)
    return send_branded(
        ticket.attendee_email, f"Registration confirmed: {title}", event=event,
        title="You're registered", preheader=f'Registration {ticket.ticket_number} for {title}',
        name=ticket.attendee_name,
        paragraphs=[f"Your registration for {title} is confirmed."],
        details=[('Registration no.', ticket.ticket_number), ('When', event_when(event)), ('Where', event.location or 'To be announced')],
        button=('Event page', event_url(event)),
        after=['No ticket or pass is needed. The organizer will contact you if anything else is required.'],
    )


def _send_simple(event, to, subject, name, line1, line2, signature=None):
    """A short message about an event: a heading, two paragraphs and a button to the event page."""
    from .email_layout import send_branded
    heading = subject.split(':')[0] if ':' in subject else subject
    return send_branded(to, subject, event=event, title=heading, preheader=line1, name=name,
                        paragraphs=[line1, line2], button=('Event page', event_url(event)))


def send_application_received(response, event):
    """Applications stage: confirms the application; the organizer reviews it next (send_review_email)."""
    from apps.events.sub_events import display_title
    title = display_title(event)
    brand, powered = email_brand(event)
    signature = 'Organized via Eventlaya' if brand == 'Eventlaya' else (brand + ('\nPowered by Eventlaya' if powered else ''))
    return _send_simple(event, response.submitter_email, f"Application received: {title}", response.submitter_name,
                        f"Thank you so much! We have received your application for '{title}' (Application No. {response.number}).",
                        "The organizers will review your submission and notify you once a decision is made.", signature)


def send_simple_event_email(event, to, name, subject, line1, line2):
    """A short plain message about an event (released tickets, refunds, cancellations, contestant updates)."""
    if not to:
        return False
    from apps.events.sub_events import display_title
    brand, powered = email_brand(event)
    signature = 'Organized via Eventlaya' if brand == 'Eventlaya' else (brand + ('\nPowered by Eventlaya' if powered else ''))
    return _send_simple(event, to, f'{subject}: {display_title(event)}', name or 'there', line1, line2, signature)


def send_review_email(response, event, contestant=None):
    """Open calls: tell the applicant their application was accepted or not (with the organizer's note).
    `contestant`: accepting also made them a contestant, so this one email says so (and carries their voting
    links when voting is already open) instead of a second "you're in the contest" message."""
    from apps.events.sub_events import display_title
    title = display_title(event)
    brand, powered = email_brand(event)
    signature = 'Organized via Eventlaya' if brand == 'Eventlaya' else (brand + ('\nPowered by Eventlaya' if powered else ''))
    if response.review_status == 'accepted':
        next_steps = "The organizer will contact you with the next steps."
        if contestant is not None:
            from django.utils import timezone
            from apps.voting.models import Candidate, Poll
            from apps.voting.self_edit_views import profile_links
            poll = contestant.poll
            if poll.status == Poll.Status.OPEN:
                links = profile_links(contestant)
                next_steps = (f"You are now a contestant in '{poll.title}' and voting is open. Share your page so friends "
                              f"can vote for you:\n{links['profile_url']}")
                if poll.contestants_can_edit:
                    next_steps += f"\n\nUpdate your photo and bio here (private link, don't share it):\n{links['edit_url']}"
                Candidate.objects.filter(pk=contestant.pk).update(invited_at=timezone.now())
            else:
                next_steps = (f"You are now a contestant in '{poll.title}'. We will send your own voting link when voting opens.")
        return _send_simple(event, response.submitter_email, f"Application accepted: {title}", response.submitter_name,
                            f"Good news: your application for '{title}' has been accepted.", next_steps, signature)
    note = f"Note from the organizer:\n{response.rejection_note}" if response.rejection_note else 'Thank you for applying.'
    return _send_simple(event, response.submitter_email, f"Application update: {title}", response.submitter_name,
                        f"Thank you for applying to '{title}'. Your application was not selected this time.", note, signature)


def send_order_email(order, tickets, event):
    """One email to the buyer with every pass in the order (single tickets use the regular ticket email)."""
    if len(tickets) == 1:
        return send_ticket_email(tickets[0], event, order)
    from apps.events.sub_events import display_title
    from .email_layout import event_when, send_branded
    title = display_title(event)  # "Main event › Sub-event" for a sub-event
    ok = send_branded(
        order.buyer_email, f"Your {len(tickets)} passes: {title}", event=event,
        title=f'Your {len(tickets)} passes are ready', preheader=f'Order {order.reference} for {title}',
        name=order.buyer_name,
        paragraphs=[f"Here are the passes for {title}. Each person shows their own QR code at the entrance."],
        details=[('Event', title), ('When', event_when(event)), ('Where', event.location or 'To be announced'),
                 ('Order', order.reference), *payment_receipt(order)],
        items=[(t.attendee_name, f"{t.ticket_type_name or 'Ticket'} · {t.ticket_number}", ('View pass', pass_url(t))) for t in tickets],
        after=['Forward each guest the link to their own pass, or show them from your phone.'],
        links=[('Event page', event_url(event))],
    )
    if ok:
        logger.info(f"Order email dispatched to {order.buyer_email} for {order.reference}")
    return ok
