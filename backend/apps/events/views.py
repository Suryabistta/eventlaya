from datetime import datetime
from django.utils import timezone
from django.db import models
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import Event, EventTicket, GateScanLog, StaffGateAssignment
from .serializers import EventSerializer, EventTicketSerializer, GateScanLogSerializer
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
        scanned_at_client = request.data.get('scanned_at_client')

        if not qr_token:
            return Response({'error': 'qr_token is required'}, status=status.HTTP_400_BAD_REQUEST)

        # Look up ticket by qr_token or ticket_number
        ticket = EventTicket.objects.filter(event=event).filter(
            models.Q(qr_token=qr_token) | models.Q(ticket_number=qr_token)
        ).first()

        now = timezone.now()
        if scanned_at_client:
            try:
                now = datetime.fromisoformat(scanned_at_client.replace('Z', '+00:00'))
            except Exception:
                pass

        if not ticket:
            return Response({
                'status': 'invalid',
                'result': 'invalid',
                'message': 'Invalid ticket: No matching attendee record found for this event.',
                'ticket': None,
                'attendee_name': None,
                'gate_name': gate_name,
                'scan_type': scan_type,
                'scanned_at': now.isoformat(),
            }, status=status.HTTP_404_NOT_FOUND)

        if ticket.status == EventTicket.Status.CANCELLED:
            return Response({
                'status': 'cancelled',
                'result': 'cancelled',
                'message': 'Ticket has been cancelled.',
                'ticket': EventTicketSerializer(ticket).data,
                'attendee_name': ticket.attendee_name,
                'gate_name': gate_name,
                'scan_type': scan_type,
                'scanned_at': now.isoformat(),
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
                    'ticket': EventTicketSerializer(ticket).data
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

            # Trigger capacity milestone notification if reached
            current_inside = event.tickets.filter(status=EventTicket.Status.CHECKED_IN).count()
            notify_capacity_milestone(event, current_inside, event.capacity)

            return Response({
                'status': 'gate_in',
                'result': 'success',
                'message': f"✅ Access Granted: Welcome {ticket.attendee_name}!",
                'attendee_name': ticket.attendee_name,
                'gate_name': gate_name,
                'scan_type': scan_type,
                'scanned_at': now.isoformat(),
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
                    'status': 'not_checked_in',
                    'result': 'not_in',
                    'message': "Notice: Attendee was not marked as currently inside.",
                    'attendee_name': ticket.attendee_name,
                    'gate_name': gate_name,
                    'scan_type': scan_type,
                    'scanned_at': now.isoformat(),
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
                'status': 'gate_out',
                'result': 'success',
                'message': f"🚪 Checked Out: {ticket.attendee_name} exited.",
                'attendee_name': ticket.attendee_name,
                'gate_name': gate_name,
                'scan_type': scan_type,
                'scanned_at': now.isoformat(),
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


class MyGateAssignmentView(APIView):
    """Staff-only: Returns their active gate assignment."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        assignment = StaffGateAssignment.objects.filter(
            staff=request.user, is_active=True
        ).select_related('event').first()
        
        if not assignment:
            return Response({'detail': 'No active gate assignment found.'}, status=status.HTTP_404_NOT_FOUND)
        
        return Response({
            'gate_name': assignment.gate_name,
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
    """Admin/Organizer: List or assign staff to an event gate."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        event_id = request.query_params.get('event_id')
        if not event_id:
            return Response({'error': 'event_id query parameter is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        assignments = StaffGateAssignment.objects.filter(event_id=event_id).select_related('staff')
        data = [{
            'id': str(a.id),
            'staff_id': str(a.staff.id),
            'staff_name': a.staff.get_full_name() or a.staff.username,
            'staff_email': a.staff.email,
            'gate_name': a.gate_name,
            'is_active': a.is_active,
            'created_at': a.created_at.isoformat(),
        } for a in assignments]
        return Response(data)

    def post(self, request):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        
        staff_email = request.data.get('staff_email', '').strip()
        event_id = request.data.get('event_id')
        gate_name = request.data.get('gate_name', 'Main Gate').strip()
        
        if not staff_email or not event_id:
            return Response({'error': 'staff_email and event_id are required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            # If user doesn't exist, create as staff user
            staff_user, user_created = User.objects.get_or_create(
                email=staff_email,
                defaults={
                    'username': staff_email.split('@')[0],
                    'role': User.Role.STAFF,
                }
            )
            if user_created:
                staff_user.set_password('password123')
                staff_user.save()
            elif staff_user.role != User.Role.STAFF and staff_user.role != User.Role.SUPERADMIN:
                staff_user.role = User.Role.STAFF
                staff_user.save(update_fields=['role'])

            event = Event.objects.get(id=event_id)
        except (User.DoesNotExist, Event.DoesNotExist) as e:
            return Response({'error': str(e)}, status=status.HTTP_404_NOT_FOUND)
        
        assignment, created = StaffGateAssignment.objects.update_or_create(
            staff=staff_user, event=event,
            defaults={'gate_name': gate_name, 'is_active': True}
        )
        return Response({
            'message': 'Staff assigned to gate successfully' if created else 'Gate assignment updated',
            'id': str(assignment.id),
            'gate_name': assignment.gate_name,
            'staff_email': staff_user.email,
            'staff_name': staff_user.get_full_name() or staff_user.username,
            'event_title': event.title,
        })

    def delete(self, request):
        assignment_id = request.data.get('assignment_id')
        if not assignment_id:
            return Response({'error': 'assignment_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        StaffGateAssignment.objects.filter(id=assignment_id).delete()
        return Response({'message': 'Staff gate assignment removed'})


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
    """Export all attendee roster records for an event as CSV."""
    permission_classes = [permissions.AllowAny]

    def get(self, request, event_id):
        import csv
        from django.http import HttpResponse

        event = get_object_or_404(Event, id=event_id)
        tickets = EventTicket.objects.filter(event=event).order_by('created_at')

        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="eventlaya_attendees_{event.slug}.csv"'

        writer = csv.writer(response)
        writer.writerow([
            'Ticket Number', 'Attendee Name', 'Email', 'Phone',
            'Status', 'First Check In', 'Last Activity', 'Registered At'
        ])

        for t in tickets:
            writer.writerow([
                t.ticket_number,
                t.attendee_name,
                t.attendee_email,
                t.attendee_phone,
                t.status,
                t.first_check_in.strftime('%Y-%m-%d %H:%M:%S') if t.first_check_in else '',
                t.last_activity.strftime('%Y-%m-%d %H:%M:%S') if t.last_activity else '',
                t.created_at.strftime('%Y-%m-%d %H:%M:%S'),
            ])

        return response

