"""Guest management (module `guest_management`, docs/plan-2026-11-guest-management.md).

PATCH /api/events/<id>/guests/<ticket id>/        {tags, note}: guest tags (VIP, Press...) and a host note
GET   /api/events/<id>/arrivals/                   latest first check-ins (live feed on the dashboard)
GET   /api/events/<id>/guest-messages/             messages sent to guests
POST  /api/events/<id>/guest-messages/             {subject, body, audience}: email (+ app push) to guests
Arrival alerts (`notify_arrival`) and reminders (`send_due_reminders`) run from the gate scan and a scheduled job.
"""
import logging
from datetime import timedelta

from django.core.mail import get_connection, EmailMultiAlternatives
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.html import escape
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Event, EventTicket, GuestMessage
from .views import can_manage_event, can_operate_event

logger = logging.getLogger(__name__)

MAX_TAGS = 8
MESSAGES_PER_HOUR = 5
VIP_TAGS = ['VIP', 'Speaker', 'Press', 'Sponsor', 'Performer', 'Staff guest']


def _event_or_error(request, pk, staff_ok=False):
    event = get_object_or_404(Event.objects.select_related('organizer'), pk=pk)
    allowed = can_operate_event(request.user, event) if staff_ok else can_manage_event(request.user, event)
    if not allowed:
        return None, Response({'error': 'Only the organizer can manage guests.'}, status=status.HTTP_403_FORBIDDEN)
    return event, None


class GuestUpdateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, pk, ticket_id):
        event, err = _event_or_error(request, pk, staff_ok=True)
        if err:
            return err
        ticket = get_object_or_404(EventTicket, pk=ticket_id, event=event)
        fields = []
        if 'tags' in request.data:
            tags = request.data.get('tags')
            if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
                return Response({'error': 'tags must be a list of words.'}, status=status.HTTP_400_BAD_REQUEST)
            clean = []
            for t in tags:
                t = t.strip()[:30]
                if t and t.lower() not in [c.lower() for c in clean]:
                    clean.append(t)
            ticket.guest_tags = clean[:MAX_TAGS]
            fields.append('guest_tags')
        if 'note' in request.data:
            ticket.host_note = str(request.data.get('note') or '').strip()[:1000]
            fields.append('host_note')
        if fields:
            ticket.save(update_fields=[*fields, 'updated_at'])
        return Response({'id': str(ticket.id), 'guest_tags': ticket.guest_tags, 'host_note': ticket.host_note})


class ArrivalsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        event, err = _event_or_error(request, pk, staff_ok=True)
        if err:
            return err
        tickets = event.tickets.filter(first_check_in__isnull=False).order_by('-first_check_in')[:40]
        return Response([
            {'id': str(t.id), 'name': t.attendee_name, 'ticket_type': t.ticket_type_name, 'tags': t.guest_tags,
             'note': t.host_note, 'at': t.first_check_in, 'inside': t.status == EventTicket.Status.CHECKED_IN}
            for t in tickets
        ])


def notify_arrival(ticket, gate_name=''):
    """Push to the organizer and event staff when a guest is scanned in for the first time (event.arrival_alerts)."""
    from apps.accounts.modules import module_enabled
    event = ticket.event
    mode = event.arrival_alerts
    if mode == Event.ArrivalAlerts.OFF or not module_enabled('guest_management'):
        return 0
    if mode == Event.ArrivalAlerts.TAGGED and not ticket.guest_tags:
        return 0
    from apps.core.fcm import send_push_to_event_staff
    tags = f" ({', '.join(ticket.guest_tags)})" if ticket.guest_tags else ''
    when = timezone.localtime(ticket.first_check_in or timezone.now()).strftime('%I:%M %p').lstrip('0')
    body = ' · '.join(x for x in [gate_name, when] if x)
    try:
        return send_push_to_event_staff(event, f'{ticket.attendee_name}{tags} is IN', body,
                                        {'type': 'guest_arrival', 'event_id': str(event.id), 'ticket_id': str(ticket.id)})
    except Exception as e:  # an alert must never break the gate
        logger.warning('Arrival alert failed for %s: %s', ticket.id, e)
        return 0


def audience_tickets(event, audience):
    """Tickets the message goes to. audience: all | not_arrived | inside | tag:<tag> | type:<ticket type id>."""
    qs = event.tickets.exclude(status__in=[EventTicket.Status.CANCELLED, EventTicket.Status.RESERVED])
    if audience == 'not_arrived':
        return qs.filter(first_check_in__isnull=True)
    if audience == 'inside':
        return qs.filter(status=EventTicket.Status.CHECKED_IN)
    if audience.startswith('tag:'):
        tag = audience[4:].lower()
        return [t for t in qs if tag in [x.lower() for x in t.guest_tags]]
    if audience.startswith('type:'):
        return qs.filter(ticket_type_id=audience[5:] or None)
    return qs


def _recipients(tickets):
    """One per email address: {email: (name, user_id)}."""
    out = {}
    for t in tickets:
        email = (t.attendee_email or '').strip().lower()
        if email and email not in out:
            out[email] = (t.attendee_name, t.user_id)
    return out


def send_to_guests(event, subject, body, recipients):
    """Email each recipient (one connection), plus app push to those with the app. Returns how many emails went out."""
    from apps.core.email import email_brand, event_url, from_email
    brand, powered = email_brand(event)
    signature = 'Sent via Eventlaya' if brand == 'Eventlaya' else (brand + (' · Powered by Eventlaya' if powered else ''))
    sent = 0
    connection = get_connection(fail_silently=True)
    messages = []
    for email, (name, _) in recipients.items():
        text = f'Namaste {name},\n\n{body}\n\nEvent page: {event_url(event)}\n\n{signature}\n'
        html = (f'<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1C1724;">'
                f'<p style="color:#64748b;margin:0 0 4px;">{escape(event.title)}</p><h2 style="margin:0 0 12px;">{escape(subject)}</h2>'
                f'<p>Namaste <strong>{escape(name)}</strong>,</p><p style="white-space:pre-line;">{escape(body)}</p>'
                f'<p><a href="{event_url(event)}" style="color:#C2215A;">Event page</a></p>'
                f'<p style="color:#94a3b8;font-size:12px;">{escape(signature)}</p></div>')
        msg = EmailMultiAlternatives(subject=f'{subject} · {event.title}', body=text, from_email=from_email(event), to=[email],
                                     connection=connection)
        msg.attach_alternative(html, 'text/html')
        messages.append(msg)
    try:
        sent = connection.send_messages(messages) or 0
    except Exception as e:
        logger.warning('Guest message emails failed for %s: %s', event.id, e)
    # App push to guests who use the app
    try:
        from apps.accounts.models import FCMToken
        from apps.core.fcm import send_push_notification
        user_ids = [u for (_, u) in recipients.values() if u]
        for token in FCMToken.objects.filter(user_id__in=user_ids).values_list('token', flat=True):
            send_push_notification(token, f'{event.title}: {subject}', body[:180], {'type': 'guest_message', 'event_id': str(event.id)})
    except Exception as e:
        logger.warning('Guest message push failed for %s: %s', event.id, e)
    return sent


class GuestMessagesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        event, err = _event_or_error(request, pk)
        if err:
            return err
        return Response([
            {'id': str(m.id), 'subject': m.subject, 'body': m.body, 'audience': m.audience, 'recipients': m.recipients,
             'sent_by': m.sent_by.get_full_name() or m.sent_by.email if m.sent_by_id else '', 'created_at': m.created_at}
            for m in event.guest_messages.select_related('sent_by')[:50]
        ])

    def post(self, request, pk):
        event, err = _event_or_error(request, pk)
        if err:
            return err
        subject = (request.data.get('subject') or '').strip()[:150]
        body = (request.data.get('body') or '').strip()[:3000]
        audience = (request.data.get('audience') or 'all').strip()[:80]
        if not subject or not body:
            return Response({'error': 'Write a subject and a message.'}, status=status.HTTP_400_BAD_REQUEST)
        if event.guest_messages.filter(created_at__gte=timezone.now() - timedelta(hours=1)).count() >= MESSAGES_PER_HOUR:
            return Response({'error': f'You can send {MESSAGES_PER_HOUR} messages an hour. Try again a little later.'},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        recipients = _recipients(audience_tickets(event, audience))
        if not recipients:
            return Response({'error': 'No guests match who you chose.'}, status=status.HTTP_400_BAD_REQUEST)
        if request.data.get('dry_run'):
            return Response({'recipients': len(recipients)})
        send_to_guests(event, subject, body, recipients)
        msg = GuestMessage.objects.create(event=event, subject=subject, body=body, audience=audience,
                                          recipients=len(recipients), sent_by=request.user)
        return Response({'id': str(msg.id), 'recipients': msg.recipients}, status=status.HTTP_201_CREATED)


def send_due_reminders(now=None):
    """Reminder emails for events starting tomorrow (sent ~24 h before) and soon (~2 h before). Each goes out once.
    Run by `manage.py send_event_reminders` every 10 minutes."""
    from apps.accounts.modules import module_enabled
    if not module_enabled('guest_management'):
        return 0
    now = now or timezone.now()
    events = Event.objects.filter(
        reminders_enabled=True, status__in=[Event.Status.PUBLISHED, Event.Status.ONGOING], date_tba=False, tickets_enabled=True,
        start_date__gte=timezone.localdate(now), start_date__lte=timezone.localdate(now) + timedelta(days=2),
    )
    sent = 0
    for event in events:
        starts = event.starts_at
        if not starts:
            continue
        left = starts - now
        for field, window, label in (
            ('reminder_day_sent_at', (timedelta(hours=2, minutes=30), timedelta(hours=25)), 'Tomorrow'),
            ('reminder_soon_sent_at', (timedelta(0), timedelta(hours=2, minutes=30)), 'Starting soon'),
        ):
            # Without a start time there is no sensible "2 hours before"
            if getattr(event, field) or not (window[0] < left <= window[1]) or (field == 'reminder_soon_sent_at' and not event.start_time):
                continue
            when = timezone.localtime(starts).strftime('%A %d %B, %I:%M %p').replace(' 0', ' ')
            body = (f'{event.title} is on {when} at {event.location}.\n\n'
                    + ('Your registration is confirmed; no ticket is needed.' if event.registration_only
                       else 'Have your QR pass ready at the gate (it is in your email and on the Eventlaya app).'))
            sent += send_to_guests(event, f'{label}: {event.title}', body, _recipients(audience_tickets(event, 'all')))
            setattr(event, field, now)
            event.save(update_fields=[field])
    return sent
