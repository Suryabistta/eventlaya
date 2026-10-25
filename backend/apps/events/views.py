from django.utils import timezone
from django.db import models
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import Event, EventTicket, GateScanLog
from .serializers import EventSerializer, EventTicketSerializer, GateScanLogSerializer

class EventViewSet(viewsets.ModelViewSet):
    serializer_class = EventSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    lookup_field = 'id'

    def get_queryset(self):
        user = self.request.user
        if user.is_authenticated:
            # Organizers see their own events
            return Event.objects.filter(organizer=user)
        # Public users see published events
        return Event.objects.filter(status=Event.Status.PUBLISHED)

    def perform_create(self, serializer):
        serializer.save(organizer=self.request.user)


class PublicEventDetailView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, slug):
        event = get_object_or_404(Event, slug=slug, status=Event.Status.PUBLISHED)
        serializer = EventSerializer(event)
        
        # Also return dynamic form schema if attached
        form_schema = None
        if event.registration_form and event.registration_form.status == 'published':
            from apps.dynamic_forms.serializers import FormDetailSerializer
            form_schema = FormDetailSerializer(event.registration_form).data

        return Response({
            'event': serializer.data,
            'form': form_schema
        })


class GateScanView(APIView):
    """Handles Gate In and Gate Out scans with duplicate detection and audit logs."""
    permission_classes = [permissions.AllowAny] # In production: Scanner/Staff role

    def post(self, request, event_id):
        event = get_object_or_404(Event, id=event_id)
        qr_token = request.data.get('qr_token', '').strip()
        scan_type = request.data.get('scan_type', GateScanLog.ScanType.GATE_IN)
        gate_name = request.data.get('gate_name', 'Main Gate')
        device_info = request.data.get('device_info', '')

        if not qr_token:
            return Response({'error': 'qr_token is required'}, status=status.HTTP_400_BAD_REQUEST)

        # Look up ticket by qr_token or ticket_number
        ticket = EventTicket.objects.filter(event=event).filter(
            models.Q(qr_token=qr_token) | models.Q(ticket_number=qr_token)
        ).first()

        now = timezone.now()

        if not ticket:
            return Response({
                'result': 'invalid',
                'message': 'Invalid ticket: No matching attendee record found for this event.',
                'ticket': None
            }, status=status.HTTP_404_NOT_FOUND)

        if ticket.status == EventTicket.Status.CANCELLED:
            return Response({
                'result': 'cancelled',
                'message': 'Ticket has been cancelled.',
                'ticket': EventTicketSerializer(ticket).data
            }, status=status.HTTP_400_BAD_REQUEST)

        user = request.user if request.user.is_authenticated else None

        if scan_type == GateScanLog.ScanType.GATE_IN:
            if ticket.status == EventTicket.Status.CHECKED_IN:
                # Duplicate entry scan alert!
                GateScanLog.objects.create(
                    event=event,
                    ticket=ticket,
                    scan_type=GateScanLog.ScanType.GATE_IN,
                    result=GateScanLog.ScanResult.DUPLICATE,
                    gate_name=gate_name,
                    scanned_by=user,
                    device_info=device_info
                )
                return Response({
                    'result': 'duplicate',
                    'message': f"⚠️ Duplicate Scan: Attendee already inside! First checked in at {ticket.first_check_in.strftime('%H:%M:%S')}.",
                    'ticket': EventTicketSerializer(ticket).data
                }, status=status.HTTP_200_OK)

            # Successful check-in
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
                scanned_by=user,
                device_info=device_info
            )

            return Response({
                'result': 'success',
                'message': f"✅ Access Granted: Welcome {ticket.attendee_name}!",
                'ticket': EventTicketSerializer(ticket).data
            }, status=status.HTTP_200_OK)

        elif scan_type == GateScanLog.ScanType.GATE_OUT:
            if ticket.status != EventTicket.Status.CHECKED_IN:
                GateScanLog.objects.create(
                    event=event,
                    ticket=ticket,
                    scan_type=GateScanLog.ScanType.GATE_OUT,
                    result=GateScanLog.ScanResult.NOT_IN,
                    gate_name=gate_name,
                    scanned_by=user,
                    device_info=device_info
                )
                return Response({
                    'result': 'not_in',
                    'message': "Notice: Attendee was not marked as currently inside.",
                    'ticket': EventTicketSerializer(ticket).data
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
                scanned_by=user,
                device_info=device_info
            )

            return Response({
                'result': 'success',
                'message': f"🚪 Checked Out: {ticket.attendee_name} exited.",
                'ticket': EventTicketSerializer(ticket).data
            }, status=status.HTTP_200_OK)

        return Response({'error': 'Invalid scan_type'}, status=status.HTTP_400_BAD_REQUEST)


class GateStatsView(APIView):
    """Provides real-time attendance counts and recent scan log activity."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, event_id):
        event = get_object_or_404(Event, id=event_id)
        total_registered = event.tickets.filter(
            status__in=[EventTicket.Status.VALID, EventTicket.Status.CHECKED_IN, EventTicket.Status.CHECKED_OUT]
        ).count()
        currently_inside = event.tickets.filter(status=EventTicket.Status.CHECKED_IN).count()
        total_checked_out = event.tickets.filter(status=EventTicket.Status.CHECKED_OUT).count()

        recent_logs = GateScanLog.objects.filter(event=event).select_related('ticket')[:15]

        return Response({
            'event_id': str(event.id),
            'event_title': event.title,
            'capacity': event.capacity,
            'total_registered': total_registered,
            'currently_inside': currently_inside,
            'total_checked_out': total_checked_out,
            'recent_scans': GateScanLogSerializer(recent_logs, many=True).data
        })


class EventTicketListView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, event_id):
        event = get_object_or_404(Event, id=event_id)
        tickets = EventTicket.objects.filter(event=event)
        
        search = request.query_params.get('search', '').strip()
        if search:
            tickets = tickets.filter(
                models.Q(attendee_name__icontains=search) |
                models.Q(attendee_email__icontains=search) |
                models.Q(ticket_number__icontains=search)
            )

        return Response(EventTicketSerializer(tickets, many=True).data)
