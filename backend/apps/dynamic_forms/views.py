import uuid
from datetime import timedelta
from decimal import Decimal
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser
from rest_framework.throttling import AnonRateThrottle
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

    @action(detail=True, methods=['post'])
    def duplicate(self, request, pk=None):
        """POST /api/forms/<id>/duplicate/ {as_template?, event?, link?: registration|application}: copy the form and its
        questions (conditions re-pointed to the copies). As a template it is saved to "Your templates"; with an event
        it becomes that event's registration or application form."""
        src = self.get_object()
        as_template = bool(request.data.get('as_template'))
        event = None
        if request.data.get('event'):
            from apps.events.views import can_manage_event
            event = get_object_or_404(Event, pk=request.data['event'])
            if not can_manage_event(request.user, event):
                return Response({'error': 'Not your event.'}, status=status.HTTP_403_FORBIDDEN)
        title = (request.data.get('title') or src.title).strip()[:255]
        with transaction.atomic():
            copy = Form.objects.create(organizer=request.user, event=event, title=title,
                                       slug=f'{src.slug}-copy'[:240], description=src.description,
                                       status=Form.Status.DRAFT if as_template else Form.Status.PUBLISHED, is_template=as_template)
            ids = {}
            for f in src.fields.order_by('order'):
                old = str(f.id)
                f.id = uuid.uuid4()  # UUID primary keys: a new id makes save() insert a copy
                f._state.adding = True
                f.form = copy
                f.save()
                ids[old] = str(f.id)
            for f in copy.fields.exclude(show_if={}):
                target = ids.get(str((f.show_if or {}).get('field')))
                f.show_if = {**f.show_if, 'field': target} if target else {}
                f.save(update_fields=['show_if'])
            link = request.data.get('link')
            if event is not None and link in ('registration', 'application'):
                setattr(event, 'registration_form' if link == 'registration' else 'application_form', copy)
                event.save(update_fields=['registration_form' if link == 'registration' else 'application_form'])
        return Response(FormDetailSerializer(copy).data, status=status.HTTP_201_CREATED)


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
        phone = (request.data.get('phone') or '').strip()[:30]
        if user is not None:  # signed in: the account fills in what the form left out
            name = name or user.get_full_name() or user.organization_name or user.email.split('@')[0]
            email = email or user.email.lower()
            phone = phone or user.phone
        answers_map = request.data.get('answers', {}) # { field_id: value }

        if not name or not email:
            return Response({'error': 'Name and Email are required.'}, status=status.HTTP_400_BAD_REQUEST)
        phone_problem = phone_error(phone, event.phone_required)
        if phone_problem:
            return Response({'error': phone_problem, 'field': 'phone'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            items = self._parse_items(request.data)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        quantity = sum(i['quantity'] for i in items)
        if event.registration_only:
            # One free registration per person: no ticket choice, guests or payment
            items = [{'ticket_type_id': None, 'quantity': 1, 'guest_names': []}]
            quantity = 1

        # Pay online / at the venue (checked again once the order is priced)
        payment_method = (request.data.get('payment_method') or '').strip()
        provider = (request.data.get('provider') or '').strip()
        if event.registration_only:
            payment_method, provider = '', ''
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
        if existing and event.registration_only:
            return Response({
                'message': f'You are already registered for {event.title}.',
                'already_registered': True,
                'registration_only': True,
                'registration': self._registration_data(existing[0]),
            }, status=status.HTTP_200_OK)
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
        from apps.events.ticketing import default_ticket_type_id as _default_type
        chosen_types = chosen = {str(i['ticket_type_id'] or _default_type(event) or '') for i in items}

        # Validate required form fields if dynamic form is attached
        if form and form.status == Form.Status.PUBLISHED:
            chosen = chosen_types
            problem = check_answers(form, answers_map, event, chosen)
            if problem:
                return Response({'error': problem}, status=status.HTTP_400_BAD_REQUEST)

        from apps.events.models import TicketOrder
        from apps.events.ticketing import TicketError, default_ticket_type_id, promo_applies, resolve_order
        owner = self._owner_for(request, email)
        try:
            with transaction.atomic():
                # 0. One registration at a time per event: the capacity check and ticket numbers can't race
                Event.objects.select_for_update().filter(pk=event.pk).first()
                if event.capacity > 0 and event.registered_count + quantity > event.capacity:
                    left = max(0, event.capacity - event.registered_count)
                    return Response({'error': f'Only {left} spot{"" if left == 1 else "s"} left for this event.' if left else 'Event has reached maximum capacity.'},
                                    status=status.HTTP_409_CONFLICT)
                # 1. Ticket types + promo code (locks the types so their quantities can't oversell)
                if len(items) == 1 and not items[0]['ticket_type_id']:
                    items[0]['ticket_type_id'] = default_ticket_type_id(event)
                if event.registration_only:
                    # Free, one per person: no ticket-type sales windows, sold-out tiers or promo codes apply
                    from apps.events.models import TicketType
                    tt = TicketType.objects.filter(pk=items[0]['ticket_type_id'], event=event).first() if items[0]['ticket_type_id'] else None
                    lines, promo = [(tt, Decimal('0'))], None
                else:
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
                if event.bib_numbers and not online:
                    assign_bibs(event, tickets)
                form_response = self._save_answers(form, event, tickets[0], name, email, phone, answers_map, chosen)
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

        if event.registration_only:
            from apps.core.email import send_registration_email
            send_registration_email(tickets[0], event)
            return Response({
                'message': f'You are registered for {event.title}.',
                'registration_only': True,
                'registration': self._registration_data(tickets[0]),
                'form_response': FormResponseSerializer(form_response).data if form_response else None,
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
    def _registration_data(ticket):
        """Registration-only events: what the attendee sees (no QR token, so there's no pass to show)."""
        return {'id': str(ticket.id), 'number': ticket.ticket_number, 'name': ticket.attendee_name,
                'email': ticket.attendee_email, 'created_at': ticket.created_at}

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
    def _save_answers(form, event, ticket, name, email, phone, answers_map, ticket_type_ids=None):
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
            # Open calls: the organizer screens every entry
            review_status=FormResponse.ReviewStatus.ACCEPTED,
        )
        from .validation import is_visible
        for field in form.fields.all():
            if str(field.id) in answers_map and is_visible(field, answers_map, ticket_type_ids):
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
        from apps.events.views import can_manage_event
        event = get_object_or_404(Event, id=event_id)
        if not can_manage_event(request.user, event):
            return Response({'error': 'Only the organizer can see this.'}, status=status.HTTP_403_FORBIDDEN)
        responses = FormResponse.objects.filter(event=event).prefetch_related('answers', 'answers__field')
        return Response(FormResponseSerializer(responses, many=True).data)


class ResponseReviewView(APIView):
    """POST /api/forms/responses/<id>/review/ {status: accepted|rejected|pending, note}: the organizer screens an
    application (open calls, Event.registration_mode apply). The applicant is emailed when it's accepted or rejected."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        from apps.events.views import can_manage_event
        resp = get_object_or_404(FormResponse.objects.select_related('event'), pk=pk)
        if resp.event is None or not can_manage_event(request.user, resp.event):
            return Response({'error': 'Only the organizer can review applications.'}, status=status.HTTP_403_FORBIDDEN)
        new = request.data.get('status')
        if new not in FormResponse.ReviewStatus.values:
            return Response({'error': 'status must be pending, accepted or rejected.'}, status=status.HTTP_400_BAD_REQUEST)
        note = (request.data.get('note') or '').strip()[:2000]
        changed = resp.review_status != new
        resp.review_status = new
        resp.rejection_note = note if new == FormResponse.ReviewStatus.REJECTED else ''
        resp.save(update_fields=['review_status', 'rejection_note', 'updated_at'])
        if changed:
            # A contestant who came from this application follows the decision (no votes for a rejected applicant)
            from apps.voting.models import Candidate
            if new == FormResponse.ReviewStatus.REJECTED:
                Candidate.objects.filter(application_id=resp.pk, status=Candidate.Status.ACTIVE).update(status=Candidate.Status.WITHDRAWN)
            elif new == FormResponse.ReviewStatus.ACCEPTED:
                Candidate.objects.filter(application_id=resp.pk, status=Candidate.Status.WITHDRAWN).update(status=Candidate.Status.ACTIVE)
        if changed and new != FormResponse.ReviewStatus.PENDING:
            from apps.core.email import send_review_email
            send_review_email(resp, resp.event)
        return Response(FormResponseSerializer(resp).data)


class FormUploadThrottle(AnonRateThrottle):
    """Files for form answers: generous for a real applicant, too tight for bulk abuse."""

    scope = 'form_upload'
    rate = '30/hour'


class FormUploadView(APIView):
    """POST /api/forms/events/<slug>/upload/ multipart `file`: a photo or PDF for a form answer (guests too).
    Stored under uploads/forms/<event id>/; the answer keeps the returned URL (checked in validation.answer_error)."""
    permission_classes = [permissions.AllowAny]
    authentication_classes = [OptionalJWTAuthentication]
    throttle_classes = [FormUploadThrottle]
    parser_classes = [MultiPartParser]
    MAX_BYTES = 5 * 1024 * 1024

    def post(self, request, slug):
        import uuid
        from django.core.files.storage import default_storage
        from PIL import Image, UnidentifiedImageError
        from apps.accounts.tenancy import scope_events
        event = get_object_or_404(scope_events(Event.objects.all(), request), slug=slug)
        # Files for registration answers or for applications: either stage must be open
        closed = event.registration_closed_reason()
        if closed and event.applications_closed_reason():
            return Response({'error': closed}, status=status.HTTP_400_BAD_REQUEST)
        upload = request.FILES.get('file')
        if not upload:
            return Response({'error': 'Choose a file to upload.'}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > self.MAX_BYTES:
            return Response({'error': 'Files must be 5 MB or smaller. For videos, share a link instead.'}, status=status.HTTP_400_BAD_REQUEST)
        head = upload.read(5)
        upload.seek(0)
        if head == b'%PDF-':
            ext = 'pdf'
        else:
            try:
                image = Image.open(upload)
                image.verify()
                ext = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp'}.get(image.format or '')
            except (UnidentifiedImageError, OSError, SyntaxError):
                ext = None
            upload.seek(0)
            if not ext:
                return Response({'error': 'Use a JPG, PNG or WebP photo, or a PDF.'}, status=status.HTTP_400_BAD_REQUEST)
        name = f'{uuid.uuid4().hex}.{ext}'
        if ext == 'pdf':
            # Documents stay private: only the event's organizers and staff can open them (PrivateFileView)
            private_storage().save(f'forms/{event.id}/{name}', upload)
            url = f'/api/forms/files/{event.id}/{name}'
        else:
            # Photos are public (contestant pages, the organizer's review) under an unguessable name
            url = default_storage.url(default_storage.save(f'uploads/forms/{event.id}/{name}', upload))
        return Response({'url': url, 'name': upload.name[:120], 'size': upload.size}, status=status.HTTP_201_CREATED)


def check_answers(form, answers_map, event, ticket_type_ids=None):
    """Error message for the first bad or missing answer, or None (shared by registration and applications).
    Questions hidden by their condition or ticket types are not checked (and their answers are not saved)."""
    from .validation import answer_error, is_visible
    if not isinstance(answers_map, dict):
        return 'Invalid answers.'
    fields = [f for f in form.fields.all() if is_visible(f, answers_map, ticket_type_ids)]
    for field in fields:
        problem = answer_error(field, answers_map.get(str(field.id)), event.id)
        if problem:
            return problem
    for field in fields:
        if not field.required or field.field_type == FormField.FieldType.HEADING:
            continue
        val = answers_map.get(str(field.id))
        if val is None or val == '' or (isinstance(val, list) and len(val) == 0):
            return f"'{field.label}' is required."
    return None


class ApplyView(APIView):
    """POST /api/forms/events/<slug>/apply/ {name, email, phone, answers}: a participant applies (applications stage,
    module `applications`). Creates a pending application (FormResponse without a ticket): no pass, no capacity used.
    One per email; applying again returns the earlier application."""
    permission_classes = [permissions.AllowAny]
    authentication_classes = [OptionalJWTAuthentication]

    def post(self, request, slug):
        from apps.accounts.tenancy import scope_events
        event = get_object_or_404(scope_events(Event.objects.select_related('application_form'), request), slug=slug)
        closed = event.applications_closed_reason()
        if closed:
            return Response({'error': closed}, status=status.HTTP_400_BAD_REQUEST)
        name = (request.data.get('name') or '').strip()[:255]
        email = (request.data.get('email') or '').strip().lower()
        phone = (request.data.get('phone') or '').strip()[:30]
        if not name or not email:
            return Response({'error': 'Name and email are required.'}, status=status.HTTP_400_BAD_REQUEST)
        phone_problem = phone_error(phone, event.phone_required)
        if phone_problem:
            return Response({'error': phone_problem, 'field': 'phone'}, status=status.HTTP_400_BAD_REQUEST)
        form = event.application_form
        answers = request.data.get('answers', {})
        problem = check_answers(form, answers, event)
        if problem:
            return Response({'error': problem}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            # One application at a time per event: no duplicate submissions or numbers
            Event.objects.select_for_update().filter(pk=event.pk).first()
            earlier = FormResponse.objects.filter(event=event, form=form, ticket__isnull=True, submitter_email__iexact=email).first()
            if earlier:
                return Response({'message': f'You already applied to {event.title}.', 'already_applied': True,
                                 'application': application_data(earlier)}, status=status.HTTP_200_OK)
            n = FormResponse.objects.filter(event=event, form=form, ticket__isnull=True).count() + 1
            resp = FormResponse.objects.create(
                form=form, event=event, submitter_name=name, submitter_email=email, submitter_phone=phone,
                review_status=FormResponse.ReviewStatus.PENDING, number=f'APP-{str(event.id)[:4].upper()}-{n:04d}',
            )
            from .validation import is_visible
            for field in form.fields.exclude(field_type=FormField.FieldType.HEADING):
                if str(field.id) in answers and is_visible(field, answers):
                    FormAnswer.objects.create(response=resp, field=field, value=answers[str(field.id)])
        from apps.core.email import send_application_received
        send_application_received(resp, event)
        return Response({'message': f'Your application for {event.title} was received.', 'application': application_data(resp)},
                        status=status.HTTP_201_CREATED)


def application_data(resp):
    return {'id': str(resp.id), 'number': resp.number, 'name': resp.submitter_name, 'email': resp.submitter_email,
            'review_status': resp.review_status, 'submitted_at': resp.submitted_at}


class EventApplicationsView(APIView):
    """GET /api/forms/events/<event id>/applications/: the organizer's list of applications with answers."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        from apps.events.views import can_manage_event
        event = get_object_or_404(Event, id=event_id)
        if not can_manage_event(request.user, event):
            return Response({'error': 'Only the organizer can see applications.'}, status=status.HTTP_403_FORBIDDEN)
        qs = FormResponse.objects.filter(event=event, ticket__isnull=True).prefetch_related('answers', 'answers__field')
        return Response(FormResponseSerializer(qs, many=True).data)


def phone_error(phone, required):
    """Organizers need a number to reach guests (Event.phone_required, on by default)."""
    if not required:
        return None
    if not phone:
        return 'Enter your mobile number.'
    digits = sum(c.isdigit() for c in phone)
    if digits < 7 or digits > 15:
        return 'Enter a valid mobile number.'
    return None


def assign_bibs(event, tickets):
    """Next race bib numbers (Event.bib_numbers), in registration order; the event row is locked so two
    registrations never get the same number. Call inside atomic()."""
    from django.db.models import Max
    Event.objects.select_for_update().filter(pk=event.pk).first()
    last = EventTicket.objects.filter(event=event).aggregate(m=Max('bib_number'))['m']
    nxt = max(last + 1 if last else 0, event.bib_start or 1)
    for t in tickets:
        t.bib_number = nxt
        t.save(update_fields=['bib_number'])
        nxt += 1


def private_storage():
    from django.conf import settings
    from django.core.files.storage import FileSystemStorage
    return FileSystemStorage(location=settings.PRIVATE_MEDIA_ROOT)


class PrivateFileView(APIView):
    """GET /api/forms/files/<event id>/<name>: a document attached to an answer, for the event's organizers and staff."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id, name):
        import re as _re
        from django.http import FileResponse
        from apps.events.views import can_operate_event
        event = get_object_or_404(Event, pk=event_id)
        if not can_operate_event(request.user, event):
            return Response({'error': 'Only the event team can open this file.'}, status=status.HTTP_403_FORBIDDEN)
        if not _re.fullmatch(r'[0-9a-f]{32}\.pdf', name):
            return Response({'error': 'File not found.'}, status=status.HTTP_404_NOT_FOUND)
        storage = private_storage()
        path = f'forms/{event_id}/{name}'
        if not storage.exists(path):
            return Response({'error': 'File not found.'}, status=status.HTTP_404_NOT_FOUND)
        return FileResponse(storage.open(path, 'rb'), content_type='application/pdf', filename=name)
