from datetime import timedelta
from decimal import Decimal
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from apps.accounts.authentication import OptionalJWTAuthentication
from apps.events.models import Event, EventTicket
from apps.events.serializers import EventTicketSerializer
from apps.payments import services as pay_services
from .models import Form, FormField, FormResponse, FormAnswer
from .serializers import FormDetailSerializer, FormFieldSerializer, FormResponseSerializer

class FormViewSet(viewsets.ModelViewSet):
    serializer_class = FormDetailSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Form.objects.filter(organizer=self.request.user).prefetch_related('fields')

    def perform_create(self, serializer):
        serializer.save(organizer=self.request.user)


class FormFieldViewSet(viewsets.ModelViewSet):
    serializer_class = FormFieldSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return FormField.objects.filter(form__organizer=self.request.user)


class EventRegisterView(APIView):
    """
    Public registration endpoint:
    Accepts attendee details + dynamic answers, enforces capacity/deadline,
    creates ticket and form response atomically.
    """
    permission_classes = [permissions.AllowAny]
    # Signed-in attendees send their JWT: the ticket is linked to their account (see _owner_for).
    # A stale token is ignored rather than rejected so guests are never blocked.
    authentication_classes = [OptionalJWTAuthentication]

    @staticmethod
    def _owner_for(request, email):
        """The account to link a ticket to: the signed-in user with a verified email, registering with that email.
        Other tickets stay unlinked; they attach to whoever verifies that address (accounts.linking)."""
        user = request.user
        if user.is_authenticated and user.email_verified and user.email and user.email.lower() == email.lower():
            return user
        return None

    def post(self, request, slug):
        from apps.accounts.tenancy import scope_events
        event = get_object_or_404(scope_events(Event.objects.all(), request), slug=slug)
        user = request.user if request.user.is_authenticated else None

        closed = event.registration_closed_reason()
        if closed:
            return Response({'error': closed}, status=status.HTTP_400_BAD_REQUEST)

        from apps.events import online_payments
        online_payments.release_expired_reservations(event)  # unpaid online holds past their time free their spots

        if event.capacity > 0 and event.registered_count >= event.capacity:
            return Response({'error': 'Event has reached maximum capacity.'}, status=status.HTTP_409_CONFLICT)

        name = (request.data.get('name') or '').strip()
        email = (request.data.get('email') or '').strip().lower()
        phone = (request.data.get('phone') or '').strip()
        if user is not None:  # signed in: the account fills in what the form left out
            name = name or user.get_full_name() or user.organization_name or user.email.split('@')[0]
            email = email or user.email.lower()
            phone = phone or user.phone
        answers_map = request.data.get('answers', {}) # { field_id: value }

        if not name or not email:
            return Response({'error': 'Name and Email are required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            items = self._parse_items(request.data)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        quantity = sum(i['quantity'] for i in items)

        # Pay online / at the venue (checked again once the order is priced)
        payment_method = (request.data.get('payment_method') or '').strip()
        provider = (request.data.get('provider') or '').strip()
        if payment_method not in ('', 'venue', 'online'):
            return Response({'error': 'payment_method must be venue or online.'}, status=status.HTTP_400_BAD_REQUEST)

        # Starting over drops this buyer's unfinished online checkout, so it stops holding tickets
        online_payments.release_pending_for_buyer(event, email)

        # Already registered: return their passes unless they're explicitly getting more tickets.
        # (Online checkouts that were never paid don't count.)
        existing = list(
            EventTicket.objects.filter(event=event, attendee_email__iexact=email)
            .exclude(status=EventTicket.Status.RESERVED)
            .exclude(status=EventTicket.Status.CANCELLED, order__payment_status='failed')
            .order_by('created_at', 'guest_number')
        )
        if existing and not request.data.get('additional'):
            owner = self._owner_for(request, email)
            if owner is not None:
                EventTicket.objects.filter(id__in=[t.id for t in existing], user__isnull=True).update(user=owner)
                for t in existing:
                    t.user_id = t.user_id or owner.id
            data = EventTicketSerializer(existing, many=True).data
            return Response({
                'message': f'You are already registered! Here is your digital ticket pass for {event.title}.',
                'ticket': data[0],
                'tickets': data,
                'already_registered': True
            }, status=status.HTTP_200_OK)

        if event.capacity > 0 and event.registered_count + quantity > event.capacity:
            left = max(0, event.capacity - event.registered_count)
            return Response({'error': f'Only {left} spot{"" if left == 1 else "s"} left for this event.'},
                            status=status.HTTP_409_CONFLICT)

        form = event.registration_form

        # Validate required form fields if dynamic form is attached
        if form and form.status == Form.Status.PUBLISHED:
            for field in form.fields.filter(required=True):
                val = answers_map.get(str(field.id))
                if val is None or val == '' or (isinstance(val, list) and len(val) == 0):
                    return Response({'error': f"'{field.label}' is required."}, status=status.HTTP_400_BAD_REQUEST)

        from apps.events.models import TicketOrder
        from apps.events.ticketing import TicketError, default_ticket_type_id, promo_applies, resolve_order
        owner = self._owner_for(request, email)
        try:
            with transaction.atomic():
                # 1. Ticket types + promo code (locks the types so their quantities can't oversell)
                if len(items) == 1 and not items[0]['ticket_type_id']:
                    items[0]['ticket_type_id'] = default_ticket_type_id(event)
                lines, promo = resolve_order(event, items, request.data.get('promo_code'))
                total = sum((price for _, price in lines), Decimal('0'))
                # 2. How it's paid: free, at the venue, or online (tickets held until the payment is confirmed)
                method, provider = online_payments.choose_payment(event, user, lines, total, payment_method, provider)
                online = method == 'online'
                order = TicketOrder.objects.create(
                    event=event, reference=TicketOrder.new_reference(), buyer_name=name, buyer_email=email,
                    buyer_phone=phone, user=owner, promo_code=promo, ticket_count=len(lines), total=total,
                    payment_method=method,
                    payment_status={'free': 'free', 'venue': 'due', 'online': 'pending'}[method],
                    reserved_until=timezone.now() + timedelta(minutes=pay_services.reservation_minutes()) if online else None,
                )
                # 2. One pass per ticket: the buyer's first, then their guests'
                guest_names = [g for item in items for g in item['guest_names']]
                tickets = []
                for i, (ticket_type, price) in enumerate(lines):
                    guest_name = (guest_names[i - 1] if 0 < i <= len(guest_names) else '').strip()
                    tickets.append(EventTicket.generate_ticket(
                        event=event,
                        name=name if i == 0 else (guest_name or f'{name} · Guest {i + 1}'),
                        email=email,
                        phone=phone,
                        ticket_type=ticket_type,
                        ticket_type_name=ticket_type.name if ticket_type else '',
                        # Only tickets the code actually applies to carry it (the order records it either way)
                        promo_code=promo if promo and ticket_type and promo_applies(promo, ticket_type) else None,
                        price=price,
                        user=owner,
                        order=order,
                        guest_number=i,
                        status=EventTicket.Status.RESERVED if online else EventTicket.Status.VALID,
                    ))
                form_response = self._save_answers(form, event, tickets[0], name, email, phone, answers_map)
        except TicketError as e:
            return Response({'error': e.message}, status=e.code)
        except online_payments.PaymentChoiceError as e:
            return Response({'error': e.message, 'code': 'payment_choice'}, status=e.code)

        if online:
            # 3. Send the buyer to Khalti / eSewa. No passes until the payment is verified.
            try:
                intent, checkout = online_payments.start_ticket_payment(order, provider, request, request.data.get('return_url') or '')
            except pay_services.PaymentError as e:
                return Response({'error': e.message, 'code': 'payment_start_failed'}, status=e.code)
            intent.refresh_from_db()
            return Response({
                'message': f'Your tickets are held for {pay_services.reservation_minutes()} minutes. Complete the payment to get your passes.',
                'payment_required': True,
                'order': {'id': str(order.id), 'reference': order.reference, 'ticket_count': order.ticket_count,
                          'total': str(order.total), 'payment': order.payment_info()},
                'payment': pay_services.public_intent(intent),
                'checkout': checkout,
            }, status=status.HTTP_201_CREATED)

        from apps.core.email import send_order_email
        send_order_email(order, tickets, event)

        data = EventTicketSerializer(tickets, many=True).data
        return Response({
            'message': 'Registration successful! Your digital ticket is ready.' if len(tickets) == 1
            else f'Registration successful! Your {len(tickets)} passes are ready.',
            'ticket': data[0],
            'tickets': data,
            'order': {'id': str(order.id), 'reference': order.reference, 'ticket_count': order.ticket_count,
                      'total': str(order.total), 'payment': order.payment_info()},
            'form_response': FormResponseSerializer(form_response).data if form_response else None
        }, status=status.HTTP_201_CREATED)

    @staticmethod
    def _parse_items(data):
        """[{ticket_type_id, quantity, guest_names}] from `items`, or from the older single `ticket_type_id`."""
        raw = data.get('items')
        if raw is None:
            raw = [{'ticket_type_id': data.get('ticket_type_id'), 'quantity': data.get('quantity') or 1,
                    'guest_names': data.get('guest_names') or []}]
        if not isinstance(raw, list) or not raw:
            raise ValueError('Choose at least one ticket.')
        items = []
        for item in raw:
            if not isinstance(item, dict):
                raise ValueError('Invalid ticket selection.')
            try:
                qty = int(item.get('quantity') or 0)
            except (TypeError, ValueError):
                raise ValueError('Quantity must be a number.')
            if qty < 0 or qty > 50:
                raise ValueError('Quantity must be between 1 and 50.')
            if qty == 0:
                continue
            names = item.get('guest_names') or []
            if not isinstance(names, list):
                raise ValueError('guest_names must be a list.')
            items.append({'ticket_type_id': item.get('ticket_type_id'), 'quantity': qty,
                          'guest_names': [str(n)[:255] for n in names]})
        if not items:
            raise ValueError('Choose at least one ticket.')
        return items

    @staticmethod
    def _save_answers(form, event, ticket, name, email, phone, answers_map):
        """Record the dynamic form response and answers, if the event has a form."""
        if not form:
            return None
        form_response = FormResponse.objects.create(
            form=form,
            event=event,
            ticket=ticket,
            submitter_name=name,
            submitter_email=email,
            submitter_phone=phone,
            review_status=FormResponse.ReviewStatus.ACCEPTED
        )
        for field in form.fields.all():
            if str(field.id) in answers_map:
                FormAnswer.objects.create(
                    response=form_response,
                    field=field,
                    value=answers_map[str(field.id)]
                )
        return form_response


class EventSubmissionsListView(APIView):
    """Organizer endpoint to view all detailed form responses for an event."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        event = get_object_or_404(Event, id=event_id, organizer=request.user)
        responses = FormResponse.objects.filter(event=event).prefetch_related('answers', 'answers__field')
        return Response(FormResponseSerializer(responses, many=True).data)
