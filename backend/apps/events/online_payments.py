"""Online ticket payment (purpose 'ticket_order') on top of apps.payments, plus the organizer's order list.

Flow: the buyer picks Khalti / eSewa at Review → the order is created with its tickets RESERVED (they hold
stock and capacity for PaymentSettings.reservation_minutes) → redirect to the provider → on return the
payment is verified server to server → tickets become VALID and the order email goes out. A failed,
cancelled or expired payment releases the tickets (CANCELLED) so the buyer can try again.

Money: the platform's own Khalti/eSewa merchant accounts collect; organizers are paid out by hand
(apps.payments.models.Payout). See docs/payments.md.
"""
import csv
from collections import Counter
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.payments import services as pay
from apps.payments.models import PaymentIntent
from apps.payments.providers import available_providers
from apps.payments.registry import register_purpose

from .models import Event, EventTicket, TicketOrder

PURPOSE = 'ticket_order'
T = EventTicket.Status
P = TicketOrder.PaymentStatus
LIVE_TICKET = [T.VALID, T.CHECKED_IN, T.CHECKED_OUT]
# Lazy release (on registration) waits a little past the hold, for buyers returning from the provider right now
LAZY_GRACE = timedelta(minutes=2)


class PaymentChoiceError(Exception):
    def __init__(self, message, code=status.HTTP_400_BAD_REQUEST):
        super().__init__(message)
        self.message, self.code = message, code


# ---------------------------------------------------------------------------
# What the registration page may offer
# ---------------------------------------------------------------------------

def online_options(event, user=None):
    """{'venue', 'online', 'providers', 'mode', 'hold_minutes'} for this event and viewer.

    Online needs: the event set to online/both, the payments module on (for the viewer and the organizer)
    and at least one provider with keys. When online isn't possible, pay at the venue still works — even
    for an "online only" event — so a switched-off module never blocks registration.
    """
    from apps.accounts.modules import module_enabled
    mode = event.payment_mode
    providers = []
    if mode in (Event.PaymentMode.ONLINE, Event.PaymentMode.BOTH) and module_enabled('payments', user) \
            and module_enabled('payments', event.organizer):
        allowed = set(event.online_providers or [])
        providers = [p.public() for p in available_providers() if not allowed or p.id in allowed]
    online = bool(providers)
    return {
        'mode': mode,
        'online': online,
        'venue': mode != Event.PaymentMode.ONLINE or not online,
        'providers': providers,
        'hold_minutes': pay.reservation_minutes() if online else None,
    }


def choose_payment(event, user, lines, total, method, provider_id):
    """('free' | 'venue' | 'online', provider_id) for an order, or raise PaymentChoiceError."""
    if total <= 0:
        return 'free', None
    opts = online_options(event, user)
    if method == 'online':
        if not opts['online']:
            raise PaymentChoiceError('Online payment is not available for this event. Choose pay at the venue.')
        if provider_id not in [p['id'] for p in opts['providers']]:
            names = ' or '.join(p['name'] for p in opts['providers'])
            raise PaymentChoiceError(f'Choose how to pay online: {names}.')
        try:
            pay.check_provider(provider_id, total)
        except pay.PaymentError as e:
            raise PaymentChoiceError(e.message)
        return 'online', provider_id
    online_only = sorted({tt.name for tt, _ in lines if tt is not None and tt.online_only})
    if online_only:
        names = ', '.join(online_only)
        if opts['online']:
            raise PaymentChoiceError(f'{names} tickets must be paid online. Choose Khalti or eSewa.')
        raise PaymentChoiceError(f"{names} tickets can only be paid online, which isn't available right now.")
    if not opts['venue']:
        raise PaymentChoiceError('This event takes online payment only. Choose how to pay online.')
    return 'venue', None


# ---------------------------------------------------------------------------
# Reservations
# ---------------------------------------------------------------------------

def start_ticket_payment(order, provider_id, request, return_url=''):
    """Create the payment for a reserved order and start the checkout. On failure the tickets are released."""
    event = order.event
    from apps.core.email import site_url
    count = order.ticket_count
    intent = pay.create_intent(
        purpose=PURPOSE, amount=order.total, reference=str(order.id),
        description=f'{count} ticket{"" if count == 1 else "s"} · {event.title}'[:200],
        payer_name=order.buyer_name, payer_email=order.buyer_email, payer_phone=order.buyer_phone,
        # The payer: the signed-in buyer even when the tickets are for another email (their "My payments")
        user=order.user or (request.user if request is not None and request.user.is_authenticated else None),
        organizer=event.organizer, event=event,
        metadata={'order_id': str(order.id), 'order_reference': order.reference, 'event_slug': event.slug,
                  'ticket_count': count},
        return_url=pay.safe_return_url(return_url) or f'{site_url(event)}/e/{event.slug}/register',
        expires_at=order.reserved_until,
    )
    TicketOrder.objects.filter(pk=order.pk).update(payment_intent=intent)
    order.payment_intent = intent
    try:
        checkout = pay.start_checkout(intent, provider_id, request)
    except pay.PaymentError as e:
        pay.close(intent, PaymentIntent.Status.FAILED, e.message)
        raise
    return intent, checkout


def release_order(order, note):
    """Give back held tickets of an unpaid online order. Caller holds the order row lock."""
    if order.payment_status != P.PENDING:
        return False
    order.tickets.filter(status=T.RESERVED).update(status=T.CANCELLED)
    order.payment_status = P.FAILED
    order.add_note(note)
    order.save(update_fields=['payment_status', 'payment_notes', 'updated_at'])
    _email_buyer(order, 'Your tickets were released',
                 'Your online payment did not go through in time, so the tickets we held for you were released.',
                 'Nothing was charged. You can register again from the event page while spots are left.')
    return True


def release_expired_reservations(event=None, grace=LAZY_GRACE):
    """Release online orders whose hold ran out (the cron does this too, after asking the provider)."""
    qs = TicketOrder.objects.filter(payment_status=P.PENDING, reserved_until__lt=timezone.now() - grace)
    if event is not None:
        qs = qs.filter(event=event)
    released = 0
    for order in qs.select_related('payment_intent'):
        if order.payment_intent_id:
            pay.close(order.payment_intent, PaymentIntent.Status.EXPIRED, 'Ticket hold ran out')
        else:
            with transaction.atomic():
                release_order(TicketOrder.objects.select_for_update().get(pk=order.pk), 'Ticket hold ran out')
        released += 1
    return released


def release_pending_for_buyer(event, email):
    """A buyer starting over: drop their earlier unfinished online checkout so it stops holding tickets."""
    for order in TicketOrder.objects.filter(event=event, buyer_email__iexact=email, payment_status=P.PENDING).select_related('payment_intent'):
        if order.payment_intent_id:
            pay.close(order.payment_intent, PaymentIntent.Status.CANCELLED, 'Replaced by a new registration')
        else:
            with transaction.atomic():
                release_order(TicketOrder.objects.select_for_update().get(pk=order.pk), 'Replaced by a new registration')


def _room_problem(order, tickets):
    """Why released tickets can't be taken back now (late payment), or None."""
    event = order.event
    if event.capacity and event.registered_count + len(tickets) > event.capacity:
        return 'the event is now full'
    for tt, n in Counter(t.ticket_type for t in tickets if t.ticket_type_id).items():
        if tt.quantity is not None and tt.sold_count + n > tt.quantity:
            return f'{tt.name} tickets sold out'
    return None


# ---------------------------------------------------------------------------
# Purpose handlers
# ---------------------------------------------------------------------------

def _locked_order(intent):
    return TicketOrder.objects.select_for_update().select_related('event').filter(pk=intent.reference).first()


def on_ticket_paid(intent):
    order = _locked_order(intent)
    if order is None:
        raise ValueError(f'Ticket order {intent.reference} no longer exists; refund the buyer.')
    if order.payment_status == P.PAID:
        return
    tickets = list(order.tickets.select_for_update().select_related('ticket_type').order_by('guest_number'))
    deliver = True
    if order.payment_status == P.FAILED:  # paid after the hold ran out: take the tickets back if there's room
        problem = _room_problem(order, [t for t in tickets if t.status == T.CANCELLED])
        if problem:
            deliver = False
            order.needs_attention = f'Paid after the ticket hold ran out, but {problem}. Refund the buyer or make room.'
            order.add_note(f'Late payment of Rs {intent.amount}: {problem}')
        else:
            order.add_note('Late payment: released tickets taken back')
    if deliver:
        EventTicket.objects.filter(order=order, status__in=[T.RESERVED, T.CANCELLED]).update(status=T.VALID)
        if order.event.bib_numbers:
            # Bibs are given when the ticket becomes valid, so online payers get theirs too
            from apps.dynamic_forms.views import assign_bibs
            assign_bibs(order.event, list(order.tickets.filter(bib_number__isnull=True).order_by('guest_number')))
    order.payment_method = TicketOrder.PaymentMethod.ONLINE
    order.payment_status = P.PAID
    order.paid_via = intent.provider
    order.paid_amount = intent.amount
    order.paid_at = intent.paid_at or timezone.now()
    order.payment_reference = intent.provider_txn_id or intent.provider_ref
    order.payment_intent = intent
    order.add_note(f'Paid Rs {intent.amount} online with {intent.get_provider_display()} ({order.payment_reference})')
    order.save()
    if deliver:
        from apps.core.email import send_order_email
        order_id = order.pk

        def send():
            fresh = TicketOrder.objects.select_related('event', 'event__organizer').get(pk=order_id)
            send_order_email(fresh, list(fresh.tickets.order_by('guest_number')), fresh.event)
        transaction.on_commit(send)


def on_ticket_failed(intent):
    order = _locked_order(intent)
    if order is None or (order.payment_intent_id and order.payment_intent_id != intent.id):
        return
    label = {'cancelled': 'cancelled', 'expired': 'expired', 'failed': 'failed'}.get(intent.status, intent.status)
    release_order(order, f'Online payment {label} ({intent.failure_reason or "-"}): tickets released')


def on_ticket_refunded(intent):
    order = _locked_order(intent)
    if order is None:
        return
    _refund_order(order, intent.refund_note or 'Refunded')


def _refund_order(order, note, user=None):
    order.tickets.filter(status__in=[T.VALID, T.RESERVED]).update(status=T.CANCELLED)
    order.payment_status = P.REFUNDED
    order.refunded_at = timezone.now()
    order.needs_attention = ''
    order.add_note(f'Refunded: {note}', user)
    order.save()
    _email_buyer(order, 'Your tickets were refunded', f'Your order {order.reference} was refunded and its tickets cancelled.',
                 'The money goes back the way you paid; your bank or wallet may take a few days to show it.')


def _email_buyer(order, subject, line1, line2):
    """Tell the buyer what happened to their order (after the transaction commits)."""
    from apps.core.email import send_simple_event_email
    order_id = order.pk
    transaction.on_commit(lambda: send_simple_event_email(
        TicketOrder.objects.select_related('event').get(pk=order_id).event, order.buyer_email, order.buyer_name, subject, line1, line2))


def describe_ticket_order(intent):
    from .serializers import EventTicketSerializer
    order = TicketOrder.objects.select_related('event').filter(pk=intent.reference).first()
    if order is None:
        return None
    paid = order.payment_status == P.PAID and not order.needs_attention
    tickets = order.tickets.filter(status__in=LIVE_TICKET).order_by('guest_number') if paid else []
    return {
        'type': PURPOSE,
        'order': {'id': str(order.id), 'reference': order.reference, 'ticket_count': order.ticket_count,
                  'total': str(order.total), 'payment': order.payment_info()},
        'event': {'slug': order.event.slug, 'title': order.event.title},
        'tickets': EventTicketSerializer(tickets, many=True).data if paid else [],
        'needs_attention': order.needs_attention or None,
    }


register_purpose(PURPOSE, on_paid=on_ticket_paid, on_failed=on_ticket_failed, on_refunded=on_ticket_refunded,
                 describe=describe_ticket_order, label='Ticket order')


# ---------------------------------------------------------------------------
# Organizer: per-event payment settings
# ---------------------------------------------------------------------------

def _manage(request, event_id):
    event = get_object_or_404(Event, id=event_id)
    if not (request.user.is_superadmin or event.organizer_id == request.user.id):
        return event, Response({'error': 'Only the event organizer can change payments.'}, status=status.HTTP_403_FORBIDDEN)
    return event, None


def settings_payload(event, request):
    from apps.payments.models import PaymentSettings
    return {
        'payment_mode': event.payment_mode,
        'online_providers': event.online_providers or [],
        'available_providers': [p.public() for p in available_providers()],
        'effective': online_options(event, request.user),
        'online_only_types': list(event.ticket_types.filter(online_only=True).values_list('name', flat=True)),
        'platform_fee_percent': str(PaymentSettings.load().platform_fee_percent),
    }


class EventPaymentSettingsView(APIView):
    """GET / PUT /api/payments/events/<id>/settings/ {payment_mode, online_providers}"""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        event, err = _manage(request, event_id)
        return err or Response(settings_payload(event, request))

    def put(self, request, event_id):
        event, err = _manage(request, event_id)
        if err:
            return err
        mode = request.data.get('payment_mode', event.payment_mode)
        if mode not in Event.PaymentMode.values:
            return Response({'payment_mode': 'Choose venue, online or both.'}, status=status.HTTP_400_BAD_REQUEST)
        providers = request.data.get('online_providers', event.online_providers or [])
        if not isinstance(providers, list) or any(p not in ('khalti', 'esewa') for p in providers):
            return Response({'online_providers': 'Pick from khalti and esewa.'}, status=status.HTTP_400_BAD_REQUEST)
        event.payment_mode, event.online_providers = mode, providers
        event.save(update_fields=['payment_mode', 'online_providers', 'updated_at'])
        return Response(settings_payload(event, request))


# ---------------------------------------------------------------------------
# Organizer: orders with their payment status (venue and online), totals, CSV, mark paid, refund
# ---------------------------------------------------------------------------

def order_row(o):
    tickets = list(o.tickets.all())
    return {
        'id': str(o.id), 'reference': o.reference, 'created_at': o.created_at,
        'buyer_name': o.buyer_name, 'buyer_email': o.buyer_email, 'buyer_phone': o.buyer_phone,
        'ticket_count': o.ticket_count, 'total': str(o.total),
        'promo_code': o.promo_code.code if o.promo_code_id else None,
        'payment': o.payment_info(),
        'payment_intent_id': str(o.payment_intent_id) if o.payment_intent_id else None,
        'needs_attention': o.needs_attention or None,
        'notes': o.payment_notes,
        'tickets': [{'id': str(t.id), 'ticket_number': t.ticket_number, 'attendee_name': t.attendee_name,
                     'ticket_type_name': t.ticket_type_name, 'price': str(t.price), 'status': t.status}
                    for t in sorted(tickets, key=lambda t: t.guest_number)],
    }


def order_totals(qs):
    def total(q):
        return pay.money(q.aggregate(t=Sum('total'))['t'] or 0)
    online = qs.filter(payment_status=P.PAID).exclude(paid_via='venue')
    venue_paid = qs.filter(payment_status=P.PAID, paid_via='venue')
    due = qs.filter(payment_status=P.DUE)
    return {
        'orders': qs.exclude(payment_status=P.FAILED).count(),
        'online_collected': str(total(online)), 'online_orders': online.count(),
        'venue_collected': str(total(venue_paid)), 'venue_paid_orders': venue_paid.count(),
        'venue_due': str(total(due)), 'venue_due_orders': due.count(),
        'pending_orders': qs.filter(payment_status=P.PENDING).count(),
        'released_orders': qs.filter(payment_status=P.FAILED).count(),
        'refunded': str(total(qs.filter(payment_status=P.REFUNDED))),
        'refunded_orders': qs.filter(payment_status=P.REFUNDED).count(),
        'free_orders': qs.filter(payment_status=P.FREE).count(),
        'needs_attention': qs.exclude(needs_attention='').count(),
    }


class EventOrdersView(APIView):
    """GET /api/events/<id>/orders/?status=&method=&provider=&search=&from=&to=&export=csv"""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        event, err = _manage(request, event_id)
        if err:
            return err
        release_expired_reservations(event)
        qs = TicketOrder.objects.filter(event=event).select_related('promo_code').prefetch_related('tickets')
        p = request.query_params
        if p.get('status'):
            qs = qs.filter(payment_status__in=p['status'].split(','))
        elif not p.get('attention'):
            qs = qs.exclude(payment_status=P.FAILED)  # abandoned online checkouts: only when asked for
        if p.get('method'):
            qs = qs.filter(payment_method=p['method'])
        if p.get('provider'):
            qs = qs.filter(paid_via=p['provider'])
        if p.get('attention'):
            qs = qs.exclude(needs_attention='')
        for key, lookup in (('from', 'created_at__date__gte'), ('to', 'created_at__date__lte')):
            if p.get(key):
                try:
                    qs = qs.filter(**{lookup: timezone.datetime.strptime(p[key], '%Y-%m-%d').date()})
                except ValueError:
                    pass
        if (q := (p.get('search') or '').strip()):
            qs = qs.filter(Q(reference__icontains=q) | Q(buyer_name__icontains=q) | Q(buyer_email__icontains=q)
                           | Q(payment_reference__icontains=q) | Q(tickets__ticket_number__icontains=q)
                           | Q(tickets__attendee_name__icontains=q)).distinct()
        if p.get('export') == 'csv':
            return self._csv(event, qs)
        all_orders = TicketOrder.objects.filter(event=event)
        return Response({
            'count': qs.count(),
            'results': [order_row(o) for o in qs[:500]],
            'totals': order_totals(all_orders),
            'filtered_totals': order_totals(qs) if p else None,
            'settings': settings_payload(event, request),
        })

    @staticmethod
    def _csv(event, qs):
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="eventlaya_orders_{event.slug}.csv"'
        w = csv.writer(response)
        w.writerow(['Order', 'Created', 'Buyer', 'Email', 'Phone', 'Tickets', 'Ticket numbers', 'Total (NPR)', 'Promo code',
                    'Payment method', 'Payment status', 'Paid via', 'Payment reference', 'Paid at', 'Needs attention', 'Notes'])
        for o in qs:
            tickets = sorted(o.tickets.all(), key=lambda t: t.guest_number)
            w.writerow([
                o.reference, timezone.localtime(o.created_at).strftime('%Y-%m-%d %H:%M'), o.buyer_name, o.buyer_email,
                o.buyer_phone, o.ticket_count, ' '.join(t.ticket_number for t in tickets), o.total,
                o.promo_code.code if o.promo_code_id else '', o.get_payment_method_display(), o.get_payment_status_display(),
                o.paid_via, o.payment_reference, timezone.localtime(o.paid_at).strftime('%Y-%m-%d %H:%M') if o.paid_at else '',
                o.needs_attention, o.payment_notes.replace('\n', ' | '),
            ])
        return response


class EventOrderActionView(APIView):
    """POST /api/events/<id>/orders/<order_id>/<action>/ — mark-paid (at the venue), mark-unpaid, refund {note}."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, event_id, order_id, action):
        event, err = _manage(request, event_id)
        if err:
            return err
        note = (request.data.get('note') or '').strip()
        if action == 'refund' and not note:
            return Response({'error': 'Add a note: how and when the money was returned.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            order = get_object_or_404(TicketOrder.objects.select_for_update(), pk=order_id, event=event)
            if action == 'mark-paid':
                if order.payment_status != P.DUE:
                    return Response({'error': 'Only orders to pay at the venue can be marked paid.'}, status=status.HTTP_409_CONFLICT)
                order.payment_status, order.paid_via, order.paid_amount, order.paid_at = P.PAID, 'venue', order.total, timezone.now()
                order.add_note(f'Marked paid at the venue (Rs {order.total}){": " + note if note else ""}', request.user)
                order.save()
            elif action == 'mark-unpaid':
                if not (order.payment_status == P.PAID and order.paid_via == 'venue'):
                    return Response({'error': 'Only venue payments can be undone.'}, status=status.HTTP_409_CONFLICT)
                order.payment_status, order.paid_via, order.paid_amount, order.paid_at = P.DUE, '', None, None
                order.add_note('Venue payment undone', request.user)
                order.save()
            elif action == 'refund':
                if order.payment_status != P.PAID:
                    return Response({'error': 'Only paid orders can be refunded.'}, status=status.HTTP_409_CONFLICT)
                if order.paid_via != 'venue' and order.payment_intent_id:
                    intent = order.payment_intent
                    try:
                        pay.mark_refunded(intent, request.user, note)  # runs on_ticket_refunded
                    except pay.PaymentError as e:
                        return Response({'error': e.message}, status=e.code)
                    order.refresh_from_db()
                else:
                    _refund_order(order, note, request.user)
            else:
                return Response({'error': 'Unknown action.'}, status=status.HTTP_404_NOT_FOUND)
        order = TicketOrder.objects.select_related('promo_code').prefetch_related('tickets').get(pk=order.pk)
        return Response(order_row(order))
