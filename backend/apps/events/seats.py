"""Seat numbers (module `seat_numbers`): who may see a ticket's seat, and bulk assignment by the organizer."""
from django.db import transaction
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.modules import module_enabled
from .models import Event, EventTicket

MAX_SEAT = EventTicket._meta.get_field('seat_number').max_length


def visible_seat(ticket, staff=False):
    """The seat to show: always to gate staff and the organizer, to attendees only when the event shows seats.

    Empty when the module is off for the event's organizer.
    """
    event = ticket.event
    if not ticket.seat_number or not module_enabled('seat_numbers', event.organizer):
        return ''
    return ticket.seat_number if staff or event.show_seat_number else ''


class EventSeatsView(APIView):
    """POST /api/events/<id>/seats/ {assignments: [{ticket: <ticket number or email>, seat: 'A-12'}]}.

    Used for one seat at a time and for CSV imports (the browser parses the file). An empty seat clears it.
    Answers {updated, errors: [{row, ticket, error}]}; rows with errors are skipped, the rest are saved.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        event = Event.objects.filter(pk=pk).select_related('organizer').first()
        if not event:
            return Response({'error': 'Event not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not (request.user.is_superadmin or event.organizer_id == request.user.id):
            return Response({'error': 'Only the organizer can assign seats.'}, status=status.HTTP_403_FORBIDDEN)
        rows = request.data.get('assignments')
        if not isinstance(rows, list) or not rows:
            return Response({'error': 'Send at least one seat.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(rows) > 5000:
            return Response({'error': 'Import at most 5,000 seats at a time.'}, status=status.HTTP_400_BAD_REQUEST)

        tickets = {t.ticket_number.lower(): t for t in event.tickets.exclude(status='cancelled')}
        by_email = {}
        for t in tickets.values():
            by_email.setdefault(t.attendee_email.lower(), []).append(t)

        errors, changed, seen_seats = [], {}, {}
        for i, row in enumerate(rows, start=1):
            ref = str((row or {}).get('ticket', '')).strip()
            seat = str((row or {}).get('seat', '')).strip()
            ticket = tickets.get(ref.lower())
            if ticket is None:
                matches = by_email.get(ref.lower(), [])
                if len(matches) > 1:
                    errors.append({'row': i, 'ticket': ref, 'error': 'This email has several tickets. Use the ticket number.'})
                    continue
                ticket = matches[0] if matches else None
            if ticket is None:
                errors.append({'row': i, 'ticket': ref, 'error': 'No ticket with this number or email.'})
                continue
            if len(seat) > MAX_SEAT:
                errors.append({'row': i, 'ticket': ref, 'error': f'Seat is longer than {MAX_SEAT} characters.'})
                continue
            if seat and seen_seats.get(seat.lower(), ticket.pk) != ticket.pk:
                errors.append({'row': i, 'ticket': ref, 'error': f'Seat {seat} is given twice in this import.'})
                continue
            if seat:
                seen_seats[seat.lower()] = ticket.pk
            ticket.seat_number = seat
            changed[ticket.pk] = ticket

        # Seats already taken by other tickets that this import doesn't move
        if seen_seats:
            taken = (
                event.tickets.exclude(pk__in=changed.keys()).exclude(seat_number='').exclude(status='cancelled')
                .values_list('seat_number', 'ticket_number')
            )
            for seat, number in taken:
                owner = seen_seats.get(seat.lower())
                if owner:
                    t = changed.pop(owner)
                    errors.append({'row': None, 'ticket': t.ticket_number, 'error': f'Seat {seat} already belongs to {number}.'})

        with transaction.atomic():
            EventTicket.objects.bulk_update(list(changed.values()), ['seat_number'])
        return Response({'updated': len(changed), 'errors': errors})
