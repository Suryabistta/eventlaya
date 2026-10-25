from django.shortcuts import get_object_or_404
from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from apps.events.models import Event, EventTicket
from apps.events.serializers import EventTicketSerializer
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

    def post(self, request, slug):
        event = get_object_or_404(Event, slug=slug)

        if event.status != Event.Status.PUBLISHED:
            return Response({'error': 'This event is not accepting registrations.'}, status=status.HTTP_400_BAD_REQUEST)

        if not event.allow_registration:
            return Response({'error': 'Registration is currently closed for this event.'}, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        if event.registration_deadline and now > event.registration_deadline:
            return Response({'error': 'Registration deadline has passed.'}, status=status.HTTP_400_BAD_REQUEST)

        if event.capacity > 0 and event.registered_count >= event.capacity:
            return Response({'error': 'Event has reached maximum capacity.'}, status=status.HTTP_409_CONFLICT)

        name = request.data.get('name', '').strip()
        email = request.data.get('email', '').strip().lower()
        phone = request.data.get('phone', '').strip()
        answers_map = request.data.get('answers', {}) # { field_id: value }

        if not name or not email:
            return Response({'error': 'Name and Email are required.'}, status=status.HTTP_400_BAD_REQUEST)

        # Check if already registered
        existing_ticket = EventTicket.objects.filter(event=event, attendee_email__iexact=email).first()
        if existing_ticket:
            return Response({
                'message': f'You are already registered! Here is your digital ticket pass for {event.title}.',
                'ticket': EventTicketSerializer(existing_ticket).data,
                'already_registered': True
            }, status=status.HTTP_200_OK)

        form = event.registration_form

        # Validate required form fields if dynamic form is attached
        if form and form.status == Form.Status.PUBLISHED:
            for field in form.fields.filter(required=True):
                val = answers_map.get(str(field.id))
                if val is None or val == '' or (isinstance(val, list) and len(val) == 0):
                    return Response({'error': f"'{field.label}' is required."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            # 1. Generate digital Ticket with QR Token
            ticket = EventTicket.generate_ticket(
                event=event,
                name=name,
                email=email,
                phone=phone
            )

            # 2. If form attached, record FormResponse and FormAnswers
            form_response = None
            if form:
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

        return Response({
            'message': 'Registration successful! Your digital ticket is ready.',
            'ticket': EventTicketSerializer(ticket).data,
            'form_response': FormResponseSerializer(form_response).data if form_response else None
        }, status=status.HTTP_201_CREATED)


class EventSubmissionsListView(APIView):
    """Organizer endpoint to view all detailed form responses for an event."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        event = get_object_or_404(Event, id=event_id, organizer=request.user)
        responses = FormResponse.objects.filter(event=event).prefetch_related('answers', 'answers__field')
        return Response(FormResponseSerializer(responses, many=True).data)
