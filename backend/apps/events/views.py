import uuid
from datetime import datetime, timedelta
from django.utils import timezone
from django.db import models
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import Event, EventTicket, EventGate, GateScanLog, StaffGateAssignment, TicketType
from .serializers import EventSerializer, EventTicketSerializer, GateScanLogSerializer, EventGateSerializer, EventPageSerializer, assignment_data
from .ticketing import public_ticket_types, ticket_type_breakdown, ticket_type_gate_error
from apps.accounts.tenancy import scope_events


def _is_uuid(value):
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


def can_manage_event(user, event):
    """The organizer who owns the event, or a platform superadmin."""
    if not user or not user.is_authenticated:
        return False
    return bool(getattr(user, 'is_superadmin', False)) or event.organizer_id == user.id


def staff_assignment(user, event):
    if not user or not user.is_authenticated:
        return None
    return StaffGateAssignment.objects.filter(staff=user, event=event, is_active=True).select_related('gate').first()


def can_operate_event(user, event):
    """Managers plus staff actively assigned to the event (gate scanning, live counts, roster)."""
    return can_manage_event(user, event) or staff_assignment(user, event) is not None


def public_event_data(event, data):
    """Attendee-facing event payload: hides capacity and counts when the organizer turned "spots left" off."""
    data['is_full'] = event.is_full
    data['spots_hidden'] = not event.show_spots_left
    if not event.show_spots_left:
        data['capacity'] = 0
        data['registered_count'] = 0
        data['checked_in_count'] = 0
        data['spots_left'] = None
    return data


# Everything attendees can see (drafts stay private).
PUBLIC_EVENT_STATUSES = [Event.Status.PUBLISHED, Event.Status.ONGOING, Event.Status.COMPLETED]

NO_ACCESS = {'error': "You don't have access to this event's gates. Ask the organizer to assign you to a gate."}
from apps.core.fcm import send_push_to_event_staff, notify_capacity_milestone

class EventViewSet(viewsets.ModelViewSet):
    serializer_class = EventSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    lookup_field = 'id'

    def get_queryset(self):
        user = self.request.user
        if user.is_authenticated:
            if getattr(user, 'role', '') == 'staff':
                assigned_event_ids = user.gate_assignments.filter(is_active=True).values_list('event_id', flat=True)
                return Event.objects.filter(models.Q(id__in=assigned_event_ids) | models.Q(status=Event.Status.PUBLISHED))
            # Organizers see their own events
            return Event.objects.filter(organizer=user)
        # Visitors use /api/events/public/: it hides counts the organizer chose to hide and respects white-label
        # sites. This organizer view would show registered/checked-in counts for every event.
        return Event.objects.none()

    def perform_create(self, serializer):
        event = serializer.save(organizer=self.request.user)
        TicketType.objects.create(
            event=event, name='General' if event.is_paid else 'Free entry',
            price=event.ticket_price if event.is_paid else 0, order=1,
        )

    def destroy(self, request, *args, **kwargs):
        event = self.get_object()
        if EventTicket.objects.filter(event__parent=event).exists():
            return Response(
                {'error': 'People registered for its sub-events. Cancel the event instead of deleting, so their passes are kept.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if event.tickets.exists():
            return Response(
                {'error': f'{event.registered_count} people registered for this event. Cancel it instead of deleting, so their passes and scan history are kept.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    def perform_update(self, serializer):
        before = (serializer.instance.is_paid, serializer.instance.ticket_price)
        event = serializer.save()
        # Older screens edit one event price: apply it when there's a single ticket type.
        if (event.is_paid, event.ticket_price) != before:
            types = list(event.ticket_types.filter(is_active=True))
            if len(types) == 1:
                types[0].price = event.ticket_price if event.is_paid else 0
                types[0].save(update_fields=['price'])


class PublicEventListView(APIView):
    """Published events from every organizer, for the public "Explore events" page.
    On a white-label site (apps.accounts.tenancy) only that organizer's events."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        events = scope_events(Event.objects.filter(status__in=PUBLIC_EVENT_STATUSES).select_related('organizer'), request)

        when = request.query_params.get('when', 'upcoming')
        today = timezone.localdate()
        not_over = models.Q(end_date__gte=today) | models.Q(end_date__isnull=True, start_date__gte=today)
        if when == 'upcoming':
            # Includes events happening today; finished ones drop off on their own.
            events = events.filter(not_over).exclude(status__in=[Event.Status.COMPLETED, Event.Status.CANCELLED])
            events = events.order_by('-is_featured', 'start_date', 'start_time')
        elif when == 'past':
            events = events.filter(~not_over | models.Q(status=Event.Status.COMPLETED)).order_by('-start_date')

        search = request.query_params.get('search', '').strip()
        if search:
            events = events.filter(
                models.Q(title__icontains=search)
                | models.Q(location__icontains=search)
                | models.Q(organizer__organization_name__icontains=search)
            )

        city = request.query_params.get('city', '').strip()
        if city:
            events = events.filter(location__icontains=city)

        category = request.query_params.get('category', '').strip()
        if category:
            events = events.filter(category=category)

        # ?kind=open_calls: applications / submissions (pageants, film festivals...)
        if request.query_params.get('kind') == 'open_calls':
            events = events.filter(registration_mode=Event.RegistrationMode.APPLY)

        # Sub-events are listed on their main event's page, not on their own here
        from apps.accounts.modules import module_enabled
        if module_enabled('sub_events'):
            events = events.filter(parent__isnull=True)

        events = list(events)
        data = EventSerializer(events, many=True, context={'request': request}).data
        return Response([public_event_data(e, d) for e, d in zip(events, data)])


class PublicEventDetailView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, slug):
        event = get_object_or_404(
            scope_events(Event.objects.select_related('organizer').prefetch_related('agenda', 'speakers', 'faqs'), request),
            slug=slug, status__in=PUBLIC_EVENT_STATUSES + [Event.Status.CANCELLED],
        )
        from .online_payments import online_options, release_expired_reservations
        release_expired_reservations(event)  # unpaid online holds past their time give their spots back
        data = EventSerializer(event).data
        data['payment_options'] = online_options(event, request.user)

        # Public page content
        page = EventPageSerializer(event).data
        data.update(page)
        data['banner_absolute'] = request.build_absolute_uri(event.banner.url) if event.banner else None
        data['spots_left'] = max(0, event.capacity - event.registered_count) if event.capacity else None
        data['ticket_types'] = public_ticket_types(event)
        public_event_data(event, data)
        data['has_promo_codes'] = event.promo_codes.filter(is_active=True).exists()
        org = event.organizer
        # Custom brand name/logo only once the platform has approved the organizer's white-label request
        from apps.platform.models import WhiteLabelRequest
        approved = WhiteLabelRequest.approved_for(org) is not None
        branding = getattr(org, 'tenant_branding', None) if approved and hasattr(org, 'tenant_branding') else None
        data['organizer_info'] = {
            'name': (branding.brand_name if branding and branding.brand_name else None) or org.organization_name or org.get_full_name() or org.username,
            # White-label logo when approved, else the logo the organizer uploaded in their profile
            'logo': (branding.brand_logo if branding and branding.brand_logo else None) or (org.avatar.url if org.avatar else None),
            'verified': org.is_verified,
        }
        from .sub_events import parent_card, sub_event_cards
        data['sub_events'] = sub_event_cards(event)
        data['parent'] = parent_card(event)
        data['managed_by_info'] = (
            {'name': event.managed_by, 'logo': event.managed_by_logo or None, 'label': event.managed_by_label.strip() or 'Managed by'}
            if event.show_managed_by and event.managed_by.strip() else None
        )

        # Also return dynamic form schema if attached
        form_schema = None
        if event.registration_form and event.registration_form.status == 'published':
            from apps.dynamic_forms.serializers import FormDetailSerializer
            form_schema = FormDetailSerializer(event.registration_form).data

        return Response({
            'event': data,
            'form': form_schema
        })


class EventPageView(APIView):
    """Organizer: read and replace the public event page content (tagline, highlights, agenda, speakers, FAQs)."""
    permission_classes = [permissions.IsAuthenticated]

    def _event(self, request, event_id):
        event = get_object_or_404(Event.objects.prefetch_related('agenda', 'speakers', 'faqs'), id=event_id)
        if not can_manage_event(request.user, event):
            return None
        return event

    def get(self, request, event_id):
        event = self._event(request, event_id)
        if event is None:
            return Response({'error': 'Only the event organizer can edit this page.'}, status=status.HTTP_403_FORBIDDEN)
        data = EventPageSerializer(event).data
        data.update({'id': str(event.id), 'slug': event.slug, 'title': event.title, 'status': event.status, 'location': event.location,
                     'start_date': str(event.start_date), 'end_date': str(event.end_date) if event.end_date else None})
        return Response(data)

    def put(self, request, event_id):
        event = self._event(request, event_id)
        if event is None:
            return Response({'error': 'Only the event organizer can edit this page.'}, status=status.HTTP_403_FORBIDDEN)
        serializer = EventPageSerializer(event, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        event = Event.objects.prefetch_related('agenda', 'speakers', 'faqs').get(id=event.id)
        return Response(EventPageSerializer(event).data)


class GateScanView(APIView):
    """Handles Gate In and Gate Out scans with duplicate detection, date verification, and audit logs."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, event_id):
        import json
        event = get_object_or_404(Event, id=event_id)
        if not can_operate_event(request.user, event):
            return Response(NO_ACCESS, status=status.HTTP_403_FORBIDDEN)
        raw_token = request.data.get('qr_token', '').strip()
        scan_type = request.data.get('scan_type', GateScanLog.ScanType.GATE_IN)
        gate_name = request.data.get('gate_name', 'Main Gate').strip() or 'Main Gate'
        device_info = request.data.get('device_info', '')
        scanned_at_client = request.data.get('scanned_at_client')

        if not raw_token:
            return Response({'error': 'qr_token is required'}, status=status.HTTP_400_BAD_REQUEST)

        if scan_type not in (GateScanLog.ScanType.GATE_IN, GateScanLog.ScanType.GATE_OUT):
            return Response({'error': 'Invalid scan_type'}, status=status.HTTP_400_BAD_REQUEST)

        # Resolve the gate: gate_id is preferred; a gate_name matching one of the event's gates
        # is validated the same way; other free-text names (older clients) are logged as-is.
        gate = None
        gate_id = request.data.get('gate_id')
        if gate_id:
            gate = EventGate.objects.filter(event=event, id=gate_id).first() if _is_uuid(gate_id) else None
            if not gate:
                return Response({'result': 'wrong_gate', 'message': "That gate doesn't belong to this event.", 'error': "That gate doesn't belong to this event."}, status=status.HTTP_400_BAD_REQUEST)
        else:
            gate = EventGate.objects.filter(event=event, name__iexact=gate_name).first()

        assignment = None if can_manage_event(request.user, event) else staff_assignment(request.user, event)
        if assignment and assignment.gate_id:
            if gate and gate.id != assignment.gate_id:
                msg = f"You're assigned to {assignment.gate.name}. Ask your organizer to move you to {gate.name}."
                return Response({'result': 'wrong_gate', 'message': msg, 'error': msg}, status=status.HTTP_403_FORBIDDEN)
            gate = gate or assignment.gate

        if gate:
            if not gate.is_active:
                msg = f'{gate.name} is closed. Ask your organizer to reopen it or pick another gate.'
                return Response({'result': 'gate_inactive', 'message': msg, 'error': msg}, status=status.HTTP_400_BAD_REQUEST)
            if not gate.allows(scan_type):
                # `result` lets clients (web + Flutter scanner) show a specific "not valid here" panel
                if scan_type == GateScanLog.ScanType.GATE_IN:
                    result, msg = 'exit_only', f'{gate.name} is an exit-only gate. People can only be checked out here.'
                else:
                    result, msg = 'entry_only', f'{gate.name} is an entry-only gate. People can only be checked in here.'
                return Response({'result': result, 'message': msg, 'error': msg}, status=status.HTTP_400_BAD_REQUEST)
            gate_name = gate.name

        # 1. Normalize QR Token (extract from JSON, URL query, or path)
        qr_token = raw_token
        if raw_token.startswith('{') and raw_token.endswith('}'):
            try:
                parsed = json.loads(raw_token)
                qr_token = parsed.get('qr_token') or parsed.get('token') or parsed.get('ticket_number') or raw_token
            except Exception:
                pass
        elif 'token=' in raw_token:
            qr_token = raw_token.split('token=')[-1].split('&')[0]
        elif '/' in raw_token and ('http' in raw_token or 'eventlaya' in raw_token or 'ticket' in raw_token):
            qr_token = raw_token.rstrip('/').split('/')[-1]
        qr_token = qr_token.strip()

        now = timezone.now()
        if scanned_at_client:
            try:
                now = datetime.fromisoformat(scanned_at_client.replace('Z', '+00:00'))
            except Exception:
                pass

        # 2. Event Status & Lifecycle Validation
        if event.status == Event.Status.CANCELLED:
            return Response({
                'status': 'event_cancelled',
                'result': 'cancelled',
                'message': f"⛔ Gate Entry Denied: The event '{event.title}' has been CANCELLED by the organizer.",
                'ticket': None,
                'attendee_name': None,
                'gate_name': gate_name,
                'scan_type': scan_type,
                'scanned_at': now.isoformat(),
            }, status=status.HTTP_400_BAD_REQUEST)

        # 3. Event Date Window Validation (local dates: Nepal is UTC+5:45)
        current_date = timezone.localdate(now)
        # If scanned more than 1 day before the event date
        if event.start_date and current_date < (event.start_date - timedelta(days=1)):
            return Response({
                'status': 'early_scan',
                'result': 'early_date',
                'message': f"⛔ Date Mismatch: '{event.title}' is scheduled for {event.start_date}. Gate validation opens on event date.",
                'ticket': None,
                'attendee_name': None,
                'gate_name': gate_name,
                'scan_type': scan_type,
                'scanned_at': now.isoformat(),
            }, status=status.HTTP_400_BAD_REQUEST)

        # If event is already completed or ended in the past
        last_date = event.end_date or event.start_date
        if event.status == Event.Status.COMPLETED or (last_date and current_date > (last_date + timedelta(days=1))):
            return Response({
                'status': 'event_expired',
                'result': 'expired',
                'message': f"⛔ Event Concluded: '{event.title}' finished on {last_date}.",
                'ticket': None,
                'attendee_name': None,
                'gate_name': gate_name,
                'scan_type': scan_type,
                'scanned_at': now.isoformat(),
            }, status=status.HTTP_400_BAD_REQUEST)

        # 4. Look up ticket by qr_token or ticket_number (case-insensitive for manual entry)
        ticket = EventTicket.objects.filter(event=event).filter(
            models.Q(qr_token__iexact=qr_token) | models.Q(ticket_number__iexact=qr_token)
        ).first()

        # 5. Handle Cross-Event Checkpoint Mismatch
        if not ticket:
            other_ticket = EventTicket.objects.filter(
                models.Q(qr_token__iexact=qr_token) | models.Q(ticket_number__iexact=qr_token)
            ).select_related('event').first()

            if other_ticket:
                return Response({
                    'status': 'wrong_event',
                    'result': 'wrong_event',
                    'message': f"⛔ Wrong Event Checkpoint: Ticket is issued for '{other_ticket.event.title}', NOT '{event.title}'. Please redirect attendee.",
                    'ticket': EventTicketSerializer(other_ticket, context={'staff': True}).data,
                    'attendee_name': other_ticket.attendee_name,
                    'expected_event': other_ticket.event.title,
                    'gate_name': gate_name,
                    'scan_type': scan_type,
                    'scanned_at': now.isoformat(),
                }, status=status.HTTP_400_BAD_REQUEST)

            return Response({
                'status': 'invalid',
                'result': 'invalid',
                'message': '❌ Invalid Ticket: No attendee record matching this QR token found.',
                'ticket': None,
                'attendee_name': None,
                'gate_name': gate_name,
                'scan_type': scan_type,
                'scanned_at': now.isoformat(),
            }, status=status.HTTP_404_NOT_FOUND)

        # 6. Unpaid online tickets and cancellations
        order = ticket.order if ticket.order_id else None
        unpaid = ticket.status == EventTicket.Status.RESERVED or (
            ticket.status == EventTicket.Status.CANCELLED and order is not None and order.payment_status == 'failed')
        if unpaid:
            # status 'cancelled' so older scanner apps show "denied"; result 'unpaid' for the web scanner
            return Response({
                'status': 'cancelled',
                'result': 'unpaid',
                'message': ('⛔ Entry Denied: Online payment not completed. This ticket is only held while the buyer pays.'
                            if ticket.status == EventTicket.Status.RESERVED else
                            "⛔ Entry Denied: The online payment for this ticket wasn't completed, so it was released."),
                'ticket': EventTicketSerializer(ticket, context={'staff': True}).data,
                'attendee_name': ticket.attendee_name,
                'gate_name': gate_name,
                'scan_type': scan_type,
                'scanned_at': now.isoformat(),
            }, status=status.HTTP_400_BAD_REQUEST)
        if ticket.status == EventTicket.Status.CANCELLED:
            return Response({
                'status': 'cancelled',
                'result': 'cancelled',
                'message': ('⛔ Entry Denied: This ticket was refunded and cancelled.' if order is not None and order.payment_status == 'refunded'
                            else '⛔ Entry Denied: This ticket was cancelled or revoked.'),
                'ticket': EventTicketSerializer(ticket, context={'staff': True}).data,
                'attendee_name': ticket.attendee_name,
                'gate_name': gate_name,
                'scan_type': scan_type,
                'scanned_at': now.isoformat(),
            }, status=status.HTTP_400_BAD_REQUEST)

        user = request.user if request.user.is_authenticated else None

        # 7. Gate In Check
        if scan_type == GateScanLog.ScanType.GATE_IN:
            if ticket.status == EventTicket.Status.CHECKED_IN:
                # Duplicate entry scan alert!
                GateScanLog.objects.create(
                    event=event,
                    ticket=ticket,
                    scan_type=GateScanLog.ScanType.GATE_IN,
                    result=GateScanLog.ScanResult.DUPLICATE,
                    gate_name=gate_name,
                    gate=gate,
                    scanned_by=user,
                    device_info=device_info
                )
                first_check_str = ticket.first_check_in.strftime('%H:%M:%S') if ticket.first_check_in else 'earlier'
                msg = f"⚠️ Duplicate Scan: Attendee already inside! First checked in at {first_check_str}."
                
                # Push notification alert to event staff
                send_push_to_event_staff(
                    event,
                    title="⚠️ Duplicate Scan Attempt",
                    body=f"{ticket.attendee_name} scanned again at {gate_name}",
                    data={"type": "duplicate_scan", "ticket_number": ticket.ticket_number}
                )

                return Response({
                    'status': 'already_in',
                    'result': 'duplicate',
                    'message': msg,
                    'attendee_name': ticket.attendee_name,
                    'gate_name': gate_name,
                    'scan_type': scan_type,
                    'scanned_at': now.isoformat(),
                    'ticket': EventTicketSerializer(ticket, context={'staff': True}).data
                }, status=status.HTTP_200_OK)

            type_msg = ticket_type_gate_error(ticket, gate)
            if type_msg:
                return Response({
                    'status': 'wrong_gate',
                    'result': 'wrong_ticket_gate',
                    'message': f'⛔ {type_msg}',
                    'attendee_name': ticket.attendee_name,
                    'gate_name': gate_name,
                    'scan_type': scan_type,
                    'scanned_at': now.isoformat(),
                    'ticket': EventTicketSerializer(ticket, context={'staff': True}).data
                }, status=status.HTTP_200_OK)

            # Check capacity if limited
            if event.capacity > 0:
                current_inside = event.tickets.filter(status=EventTicket.Status.CHECKED_IN).count()
                if current_inside >= event.capacity:
                    return Response({
                        'status': 'capacity_full',
                        'result': 'capacity_full',
                        'message': f"⚠️ Capacity Full! Maximum limit of {event.capacity} attendees reached.",
                        'attendee_name': ticket.attendee_name,
                        'gate_name': gate_name,
                        'scan_type': scan_type,
                        'scanned_at': now.isoformat(),
                        'ticket': EventTicketSerializer(ticket, context={'staff': True}).data
                    }, status=status.HTTP_200_OK)

            # Handle Pass-Back / Re-entry vs First Check-in
            is_reentry = (ticket.status == EventTicket.Status.CHECKED_OUT)

            ticket.status = EventTicket.Status.CHECKED_IN
            ticket.is_attended = True
            if not ticket.first_check_in:
                ticket.first_check_in = now
            ticket.last_activity = now
            ticket.save(update_fields=['status', 'is_attended', 'first_check_in', 'last_activity'])

            GateScanLog.objects.create(
                event=event,
                ticket=ticket,
                scan_type=GateScanLog.ScanType.GATE_IN,
                result=GateScanLog.ScanResult.SUCCESS,
                gate_name=gate_name,
                    gate=gate,
                scanned_by=user,
                device_info=device_info
            )

            # Trigger capacity milestone notification if reached
            current_inside = event.tickets.filter(status=EventTicket.Status.CHECKED_IN).count()
            notify_capacity_milestone(event, current_inside, event.capacity)

            welcome_msg = f"🔄 Re-Entry Granted: Welcome back {ticket.attendee_name}!" if is_reentry else f"✅ Access Granted: Welcome {ticket.attendee_name}!"

            return Response({
                'status': 're_entry' if is_reentry else 'gate_in',
                'result': 'success',
                'message': welcome_msg,
                'attendee_name': ticket.attendee_name,
                'gate_name': gate_name,
                'scan_type': scan_type,
                'scanned_at': now.isoformat(),
                'ticket': EventTicketSerializer(ticket, context={'staff': True}).data
            }, status=status.HTTP_200_OK)

        elif scan_type == GateScanLog.ScanType.GATE_OUT:
            if ticket.status != EventTicket.Status.CHECKED_IN:
                GateScanLog.objects.create(
                    event=event,
                    ticket=ticket,
                    scan_type=GateScanLog.ScanType.GATE_OUT,
                    result=GateScanLog.ScanResult.NOT_IN,
                    gate_name=gate_name,
                    gate=gate,
                    scanned_by=user,
                    device_info=device_info
                )
                return Response({
                    'status': 'not_checked_in',
                    'result': 'not_in',
                    'message': "Notice: Attendee was not marked as currently inside.",
                    'attendee_name': ticket.attendee_name,
                    'gate_name': gate_name,
                    'scan_type': scan_type,
                    'scanned_at': now.isoformat(),
                    'ticket': EventTicketSerializer(ticket, context={'staff': True}).data
                }, status=status.HTTP_200_OK)

            ticket.status = EventTicket.Status.CHECKED_OUT
            ticket.last_activity = now
            ticket.save(update_fields=['status', 'last_activity'])

            GateScanLog.objects.create(
                event=event,
                ticket=ticket,
                scan_type=GateScanLog.ScanType.GATE_OUT,
                result=GateScanLog.ScanResult.SUCCESS,
                gate_name=gate_name,
                    gate=gate,
                scanned_by=user,
                device_info=device_info
            )

            return Response({
                'status': 'gate_out',
                'result': 'success',
                'message': f"🚪 Checked Out: {ticket.attendee_name} exited.",
                'attendee_name': ticket.attendee_name,
                'gate_name': gate_name,
                'scan_type': scan_type,
                'scanned_at': now.isoformat(),
                'ticket': EventTicketSerializer(ticket, context={'staff': True}).data
            }, status=status.HTTP_200_OK)

        return Response({'error': 'Invalid scan_type'}, status=status.HTTP_400_BAD_REQUEST)


class GateStatsView(APIView):
    """Provides real-time attendance counts and recent scan log activity."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        event = get_object_or_404(Event, id=event_id)
        if not can_operate_event(request.user, event):
            return Response(NO_ACCESS, status=status.HTTP_403_FORBIDDEN)
        total_registered = event.tickets.filter(
            status__in=[EventTicket.Status.VALID, EventTicket.Status.CHECKED_IN, EventTicket.Status.CHECKED_OUT]
        ).count()
        currently_inside = event.tickets.filter(status=EventTicket.Status.CHECKED_IN).count()
        total_checked_out = event.tickets.filter(status=EventTicket.Status.CHECKED_OUT).count()
        total_checked_in = currently_inside + total_checked_out

        recent_logs = GateScanLog.objects.filter(event=event).select_related('ticket')[:15]

        return Response({
            'event_id': str(event.id),
            'event_title': event.title,
            'capacity': event.capacity,
            'total_registered': total_registered,
            'currently_inside': currently_inside,
            'total_checked_in': total_checked_in,
            'total_checked_out': total_checked_out,
            'recent_scans': GateScanLogSerializer(recent_logs, many=True).data
        })


class EventTicketListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        event = get_object_or_404(Event, id=event_id)
        if not can_operate_event(request.user, event):
            return Response(NO_ACCESS, status=status.HTTP_403_FORBIDDEN)
        tickets = EventTicket.objects.filter(event=event)
        
        search = request.query_params.get('search', '').strip()
        if search:
            tickets = tickets.filter(
                models.Q(attendee_name__icontains=search) |
                models.Q(attendee_email__icontains=search) |
                models.Q(ticket_number__icontains=search)
            )

        return Response(EventTicketSerializer(tickets, many=True, context={'staff': True}).data)


class MyGateAssignmentView(APIView):
    """Staff: their active gate assignment (optionally for one event via ?event_id=)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        qs = StaffGateAssignment.objects.filter(staff=request.user, is_active=True).select_related('event', 'gate')
        event_id = request.query_params.get('event_id')
        if event_id:
            if not _is_uuid(event_id):
                return Response({'error': 'event_id is not valid'}, status=status.HTTP_400_BAD_REQUEST)
            qs = qs.filter(event_id=event_id)
        assignment = qs.order_by('-created_at').first()

        if not assignment:
            return Response({'detail': 'No active gate assignment found.'}, status=status.HTTP_404_NOT_FOUND)

        gate = assignment.gate
        return Response({
            'id': str(assignment.id),
            'gate_name': gate.name if gate else assignment.gate_name,
            'gate': EventGateSerializer(gate).data if gate else None,
            'event': {
                'id': str(assignment.event.id),
                'title': assignment.event.title,
                'slug': assignment.event.slug,
                'date': str(assignment.event.start_date),
                'venue': assignment.event.location,
                'capacity': assignment.event.capacity,
            }
        })


class StaffAssignmentManageView(APIView):
    """Organizer (event owner) or superadmin: list, assign or remove gate staff for an event."""
    permission_classes = [permissions.IsAuthenticated]

    def _event(self, request, event_id):
        if not event_id or not _is_uuid(event_id):
            return None, Response({'error': 'event_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        event = Event.objects.filter(id=event_id).first()
        if not event:
            return None, Response({'error': 'Event not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not can_manage_event(request.user, event):
            return None, Response({'error': 'Only the event organizer can manage gate staff.'}, status=status.HTTP_403_FORBIDDEN)
        return event, None

    def get(self, request):
        event, err = self._event(request, request.query_params.get('event_id'))
        if err:
            return err
        assignments = StaffGateAssignment.objects.filter(event=event).select_related('staff', 'gate')
        return Response([assignment_data(a) for a in assignments])

    def post(self, request):
        from django.contrib.auth import get_user_model
        User = get_user_model()

        event, err = self._event(request, request.data.get('event_id'))
        if err:
            return err

        staff_email = (request.data.get('staff_email') or '').strip().lower()
        if not staff_email:
            return Response({'error': 'staff_email is required'}, status=status.HTTP_400_BAD_REQUEST)

        gate_id = request.data.get('gate_id')
        if gate_id:
            gate = EventGate.objects.filter(event=event, id=gate_id).first() if _is_uuid(gate_id) else None
            if not gate:
                return Response({'error': "That gate doesn't belong to this event."}, status=status.HTTP_400_BAD_REQUEST)
        else:
            # Older clients send a free-text gate name: reuse or create the matching gate
            name = (request.data.get('gate_name') or 'Main gate').strip() or 'Main gate'
            gate = EventGate.objects.filter(event=event, name__iexact=name).first()
            if not gate:
                order = (event.gates.aggregate(m=models.Max('order'))['m'] or 0) + 1
                gate = EventGate.objects.create(event=event, name=name, order=order)
        if not gate.is_active:
            return Response({'error': f'{gate.name} is closed. Reopen it before assigning staff.'}, status=status.HTTP_400_BAD_REQUEST)

        staff_user = User.objects.filter(email__iexact=staff_email).first()
        user_created = False
        temp_password = None
        if staff_user is None:
            from apps.accounts.team import create_staff_account
            staff_user, temp_password = create_staff_account(staff_email, event.organizer)
            user_created = True
        elif staff_user.role not in (User.Role.STAFF, User.Role.SUPERADMIN):
            return Response(
                {'error': f'{staff_email} is a {staff_user.get_role_display().lower()} account, not a staff account. Use a different email for gate staff.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        elif staff_user.role == User.Role.STAFF and not staff_user.team_owner_id:
            staff_user.team_owner = event.organizer
            staff_user.save(update_fields=['team_owner'])

        assignment, created = StaffGateAssignment.objects.update_or_create(
            staff=staff_user, event=event,
            defaults={'gate': gate, 'gate_name': gate.name, 'is_active': True}
        )
        data = assignment_data(assignment)
        data.update({
            'message': f'{staff_user.email} assigned to {gate.name}' if created else f'{staff_user.email} moved to {gate.name}',
            'staff_created': user_created,
            'temporary_password': temp_password,
            'event_title': event.title,
        })
        return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def delete(self, request):
        assignment_id = request.data.get('assignment_id') or request.query_params.get('assignment_id')
        if not assignment_id or not _is_uuid(assignment_id):
            return Response({'error': 'assignment_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        assignment = StaffGateAssignment.objects.filter(id=assignment_id).select_related('event', 'staff').first()
        if not assignment:
            return Response({'error': 'Assignment not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not can_manage_event(request.user, assignment.event):
            return Response({'error': 'Only the event organizer can manage gate staff.'}, status=status.HTTP_403_FORBIDDEN)
        email = assignment.staff.email
        assignment.delete()
        return Response({'message': f'{email} removed from this event'})


def _gate_payload(gates, event, include_staff):
    """Gate rows plus today's successful in/out scan counts (and staff for managers)."""
    today = timezone.localdate()
    counts = {}
    rows = (
        GateScanLog.objects.filter(event=event, gate__in=gates, result=GateScanLog.ScanResult.SUCCESS, scanned_at__date=today)
        .values('gate_id', 'scan_type').annotate(n=models.Count('id'))
    )
    for r in rows:
        counts.setdefault(r['gate_id'], {})[r['scan_type']] = r['n']
    staff = {}
    if include_staff:
        for a in StaffGateAssignment.objects.filter(event=event, gate__in=gates).select_related('staff', 'gate'):
            staff.setdefault(a.gate_id, []).append(assignment_data(a))
    out = []
    for g in gates:
        d = EventGateSerializer(g).data
        d['scans_in_today'] = counts.get(g.id, {}).get('gate_in', 0)
        d['scans_out_today'] = counts.get(g.id, {}).get('gate_out', 0)
        if include_staff:
            d['staff'] = staff.get(g.id, [])
        out.append(d)
    return out


class EventGateListView(APIView):
    """GET: the event's gates (managers and assigned staff). POST: add a gate (managers)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        event = get_object_or_404(Event, id=event_id)
        manager = can_manage_event(request.user, event)
        if not manager and not staff_assignment(request.user, event):
            return Response(NO_ACCESS, status=status.HTTP_403_FORBIDDEN)
        gates = list(event.gates.all())
        return Response(_gate_payload(gates, event, include_staff=manager))

    def post(self, request, event_id):
        event = get_object_or_404(Event, id=event_id)
        if not can_manage_event(request.user, event):
            return Response({'error': 'Only the event organizer can add gates.'}, status=status.HTTP_403_FORBIDDEN)
        serializer = EventGateSerializer(data=request.data, context={'event': event})
        serializer.is_valid(raise_exception=True)
        order = request.data.get('order')
        if order in (None, ''):
            order = (event.gates.aggregate(m=models.Max('order'))['m'] or 0) + 1
        gate = serializer.save(event=event, order=order)
        return Response(_gate_payload([gate], event, include_staff=True)[0], status=status.HTTP_201_CREATED)


class EventGateDetailView(APIView):
    """PATCH: rename, change kind/VIP/active/order. DELETE: remove, or close it if it has scans."""
    permission_classes = [permissions.IsAuthenticated]

    def _gate(self, request, event_id, gate_id):
        event = get_object_or_404(Event, id=event_id)
        gate = get_object_or_404(EventGate, id=gate_id, event=event)
        if not can_manage_event(request.user, event):
            return event, None, Response({'error': 'Only the event organizer can change gates.'}, status=status.HTTP_403_FORBIDDEN)
        return event, gate, None

    def patch(self, request, event_id, gate_id):
        event, gate, err = self._gate(request, event_id, gate_id)
        if err:
            return err
        serializer = EventGateSerializer(gate, data=request.data, partial=True, context={'event': event})
        serializer.is_valid(raise_exception=True)
        gate = serializer.save()
        # Keep the legacy free-text name on assignments in sync
        StaffGateAssignment.objects.filter(gate=gate).update(gate_name=gate.name)
        return Response(_gate_payload([gate], event, include_staff=True)[0])

    def delete(self, request, event_id, gate_id):
        event, gate, err = self._gate(request, event_id, gate_id)
        if err:
            return err
        if gate.scan_logs.exists():
            gate.is_active = False
            gate.save(update_fields=['is_active'])
            return Response({
                'deleted': False,
                'deactivated': True,
                'message': f'{gate.name} has scan history, so it was closed instead of deleted. Its scans stay in your reports.',
                'gate': _gate_payload([gate], event, include_staff=True)[0],
            })
        name = gate.name
        gate.delete()
        return Response({'deleted': True, 'deactivated': False, 'message': f'{name} deleted'})


class EventBroadcastNotificationView(APIView):
    """Send real-time announcement push notification to all staff assigned to this event."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, event_id):
        event = get_object_or_404(Event, id=event_id)
        title = request.data.get('title', f"📢 Alert: {event.title}")
        body = request.data.get('message', '').strip()

        if not body:
            return Response({'error': 'message body is required'}, status=status.HTTP_400_BAD_REQUEST)

        sent_count = send_push_to_event_staff(event, title, body, {
            'type': 'admin_broadcast',
            'event_id': str(event.id),
        })

        return Response({
            'message': f"Broadcast notification dispatched to active staff members.",
            'receivers_notified': sent_count,
            'title': title,
            'body': body,
        })


class ExportAttendeesCSVView(APIView):
    """Export all attendee roster records for an event as CSV (organizer only: contains personal data)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        import csv
        from django.http import HttpResponse

        event = get_object_or_404(Event, id=event_id)
        if not can_manage_event(request.user, event):
            return Response({'error': 'Only the event organizer can see this.'}, status=status.HTTP_403_FORBIDDEN)
        tickets = EventTicket.objects.filter(event=event).select_related('promo_code', 'order').order_by('created_at')

        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="eventlaya_attendees_{event.slug}.csv"'

        writer = csv.writer(response)
        if event.registration_only:
            return self._registrations(writer, response, event, tickets)
        writer.writerow([
            'Ticket Number', 'Attendee Name', 'Email', 'Phone', 'Ticket Type', 'Price', 'Promo Code',
            'Status', 'First Check In', 'Last Activity', 'Registered At', 'Order', 'Payment'
        ])

        for t in tickets:
            writer.writerow([
                t.ticket_number,
                t.attendee_name,
                t.attendee_email,
                t.attendee_phone,
                t.ticket_type_name,
                t.price,
                t.promo_code.code if t.promo_code_id else '',
                t.status,
                t.first_check_in.strftime('%Y-%m-%d %H:%M:%S') if t.first_check_in else '',
                t.last_activity.strftime('%Y-%m-%d %H:%M:%S') if t.last_activity else '',
                t.created_at.strftime('%Y-%m-%d %H:%M:%S'),
                t.order.reference if t.order_id else '',
                t.order.payment_label if t.order_id else '',
            ])

        return response

    @staticmethod
    def _registrations(writer, response, event, tickets):
        """Registration-only events: no tickets or check-in, so registration number, contact details and
        one column per registration-form question."""
        response['Content-Disposition'] = f'attachment; filename="eventlaya_registrations_{event.slug}.csv"'
        form = event.registration_form
        fields = list(form.fields.order_by('order')) if form else []
        review = event.is_application
        writer.writerow(['Application No.' if review else 'Registration No.', 'Name', 'Email', 'Phone', 'Status', 'Registered At',
                         *(['Review', 'Review note'] if review else []), *[f.label for f in fields]])
        for t in tickets.prefetch_related('form_response__answers'):
            response_obj = getattr(t, 'form_response', None)
            answers = {a.field_id: a.value for a in response_obj.answers.all()} if response_obj else {}
            def text(v):
                if isinstance(v, dict):
                    v = v.get('value', '')
                return ', '.join(map(str, v)) if isinstance(v, list) else ('' if v is None else str(v))
            writer.writerow([
                t.ticket_number, t.attendee_name, t.attendee_email, t.attendee_phone,
                'cancelled' if t.status == 'cancelled' else 'registered',
                t.created_at.strftime('%Y-%m-%d %H:%M:%S'),
                *([response_obj.review_status if response_obj else '', response_obj.rejection_note if response_obj else ''] if review else []),
                *[text(answers.get(f.id)) for f in fields],
            ])
        return response



from django.db.models import Count
from django.db.models.functions import TruncHour, TruncDate
from .models import EventFunding, EventTask
from .serializers import EventFundingSerializer, EventTaskSerializer


class EventAnalyticsView(APIView):
    """
    Returns rich, structured time-series and aggregate datasets for Chart.js
    visualizations on Web and Mobile dashboards.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        event = get_object_or_404(Event, id=event_id)
        if not can_manage_event(request.user, event):
            return Response({'error': 'Only the event organizer can see this.'}, status=status.HTTP_403_FORBIDDEN)

        # 1. Attendance & Capacity Metrics
        total_registered = event.tickets.count()
        checked_in_count = event.tickets.filter(status__in=[EventTicket.Status.CHECKED_IN, EventTicket.Status.CHECKED_OUT]).count()
        currently_inside = event.tickets.filter(status=EventTicket.Status.CHECKED_IN).count()
        checked_out_count = event.tickets.filter(status=EventTicket.Status.CHECKED_OUT).count()
        checkin_rate = round((checked_in_count / total_registered * 100), 1) if total_registered > 0 else 0

        # 2. Hourly Check-in Velocity (Chart.js Line/Bar)
        # Groups GateScanLogs by hour
        hourly_logs = (
            GateScanLog.objects.filter(event=event)
            .annotate(hour=TruncHour('scanned_at'))
            .values('hour', 'scan_type')
            .annotate(count=Count('id'))
            .order_by('hour')
        )

        hourly_map = {}
        for h in hourly_logs:
            if not h['hour']:
                continue
            time_label = h['hour'].strftime('%I:%M %p')
            if time_label not in hourly_map:
                hourly_map[time_label] = {'gate_in': 0, 'gate_out': 0}
            if h['scan_type'] == GateScanLog.ScanType.GATE_IN:
                hourly_map[time_label]['gate_in'] += h['count']
            else:
                hourly_map[time_label]['gate_out'] += h['count']

        # Real data only: no scans yet → empty series (clients show an empty state)
        hourly_labels = list(hourly_map.keys())
        gate_in_series = [hourly_map[k]['gate_in'] for k in hourly_labels]
        gate_out_series = [hourly_map[k]['gate_out'] for k in hourly_labels]

        # 3. Gate Distribution (Chart.js Doughnut/Pie)
        gate_counts = (
            GateScanLog.objects.filter(event=event, result=GateScanLog.ScanResult.SUCCESS, scan_type=GateScanLog.ScanType.GATE_IN)
            .values('gate_name')
            .annotate(count=Count('id'))
            .order_by('-count')
        )
        gate_labels = [g['gate_name'] for g in gate_counts]
        gate_series = [g['count'] for g in gate_counts]

        # 4. Scan Result Breakdown (Success vs Duplicate vs Not In vs Invalid)
        result_counts = (
            GateScanLog.objects.filter(event=event)
            .values('result')
            .annotate(count=Count('id'))
        )
        results_map = {r['result']: r['count'] for r in result_counts}

        # 5. Daily Registration Curve (Chart.js Area / Line)
        reg_curve = (
            EventTicket.objects.filter(event=event)
            .annotate(day=TruncDate('created_at'))
            .values('day')
            .annotate(count=Count('id'))
            .order_by('day')
        )
        reg_labels = [r['day'].strftime('%b %d') for r in reg_curve if r['day']]
        reg_series = [r['count'] for r in reg_curve if r['day']]

        # 6. Funding & Financials
        # Never invent a budget: a new event starts with zeros until the organizer fills it in
        funding, _ = EventFunding.objects.get_or_create(event=event)

        funding_data = {
            'target_budget': float(funding.target_budget),
            'sponsorship_raised': float(funding.sponsorship_raised),
            'ticket_sales_revenue': float(funding.ticket_sales_revenue),
            'grants_donations': float(funding.grants_donations),
            'total_funding': float(funding.total_funding),
            'total_expenses': float(funding.total_expenses),
            'net_balance': float(funding.net_balance),
            'expenses_breakdown': {
                'Venue & Hall': float(funding.expense_venue),
                'Catering & Food': float(funding.expense_catering),
                'Stage, Sound & Lights': float(funding.expense_production),
                'Marketing & Ads': float(funding.expense_marketing),
                'Prizes & Mementos': float(funding.expense_prizes_gifts),
                'Logistics & Travel': float(funding.expense_logistics),
            }
        }

        # 7. Work Distribution & Task Stats
        tasks = EventTask.objects.filter(event=event)
        task_stats = {
            'total': tasks.count(),
            'todo': tasks.filter(status=EventTask.Status.TODO).count(),
            'in_progress': tasks.filter(status=EventTask.Status.IN_PROGRESS).count(),
            'completed': tasks.filter(status=EventTask.Status.COMPLETED).count(),
            'urgent': tasks.filter(priority=EventTask.Priority.URGENT, status__in=[EventTask.Status.TODO, EventTask.Status.IN_PROGRESS]).count(),
        }

        return Response({
            'event': {
                'id': str(event.id),
                'title': event.title,
                'slug': event.slug,
                'capacity': event.capacity,
                'is_paid': event.is_paid,
                'ticket_price': float(event.ticket_price),
            },
            'ticket_types': ticket_type_breakdown(event),
            'attendance': {
                'capacity': event.capacity,
                'total_registered': total_registered,
                'checked_in': checked_in_count,
                'currently_inside': currently_inside,
                'checked_out': checked_out_count,
                'checkin_rate_pct': checkin_rate,
            },
            'velocity_chart': {
                'labels': hourly_labels,
                'gate_in': gate_in_series,
                'gate_out': gate_out_series,
            },
            'gate_distribution_chart': {
                'labels': gate_labels,
                'counts': gate_series,
            },
            'registration_growth_chart': {
                'labels': reg_labels,
                'counts': reg_series,
            },
            'scan_audit': results_map,
            'funding': funding_data,
            'task_stats': task_stats,
        })


class EventFundingView(APIView):
    """View and update financial and budget breakdown for an event (organizer only)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, event_id):
        event = get_object_or_404(Event, id=event_id)
        if not can_manage_event(request.user, event):
            return Response({'error': 'Only the event organizer can see this.'}, status=status.HTTP_403_FORBIDDEN)
        funding, _ = EventFunding.objects.get_or_create(event=event)
        return Response(EventFundingSerializer(funding).data)

    def post(self, request, event_id):
        event = get_object_or_404(Event, id=event_id)
        if not can_manage_event(request.user, event):
            return Response({'error': 'Only the event organizer can change the budget.'}, status=status.HTTP_403_FORBIDDEN)
        funding, _ = EventFunding.objects.get_or_create(event=event)
        serializer = EventFundingSerializer(funding, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class EventTaskViewSet(viewsets.ModelViewSet):
    """CRUD API for crew tasks, scoped to the requesting organizer (superadmins see all).

    Filters: ?event_id=<uuid> | ?event_id=none (general tasks), ?status=, ?priority=
    """
    serializer_class = EventTaskSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = EventTask.objects.all().select_related('event', 'assigned_to')
        if not getattr(user, 'is_superadmin', False):
            qs = qs.filter(organizer=user)

        event_id = self.request.query_params.get('event_id')
        status_filter = self.request.query_params.get('status')
        priority = self.request.query_params.get('priority')

        if event_id == 'none':
            qs = qs.filter(event__isnull=True)
        elif event_id:
            try:
                qs = qs.filter(event_id=uuid.UUID(event_id))
            except ValueError:
                return qs.none()
        if status_filter:
            qs = qs.filter(status=status_filter)
        if priority:
            qs = qs.filter(priority=priority)

        return qs

    def perform_create(self, serializer):
        event = serializer.validated_data.get('event')
        # A superadmin creating a task for someone else's event files it under that organizer
        owner = event.organizer if (event and getattr(self.request.user, 'is_superadmin', False)) else self.request.user
        serializer.save(organizer=owner)


class PublicPassView(APIView):
    """GET /api/events/passes/<qr_token>/ — one pass by its secret QR token (the link emailed to the buyer)."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, token):
        ticket = get_object_or_404(
            scope_events(EventTicket.objects.select_related('event', 'order', 'ticket_type'), request, 'event__organizer'),
            qr_token=token,
        )
        from .sub_events import display_title
        e = ticket.event
        return Response({
            'ticket': EventTicketSerializer(ticket).data,
            'event': {
                'id': str(e.id), 'title': display_title(e), 'slug': e.slug, 'location': e.location,
                'start_date': e.start_date, 'start_time': e.start_time, 'end_date': e.end_date, 'end_time': e.end_time,
                'banner': request.build_absolute_uri(e.banner.url) if e.banner else None, 'phase': e.phase(),
            },
        })
