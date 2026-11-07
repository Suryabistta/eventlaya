"""Attendee-facing: the signed-in user's own tickets (linked by EventTicket.user)."""
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EventTicket
from .seats import visible_seat
from .sub_events import display_title

UPCOMING_PHASES = ('upcoming', 'live', 'draft')


def event_summary(event, request=None):
    banner = event.banner.url if event.banner else None
    if banner and request is not None:
        banner = request.build_absolute_uri(banner)
    org = event.organizer
    return {
        'id': str(event.id),
        'title': display_title(event),
        'slug': event.slug,
        'tagline': event.tagline,
        'category': event.category,
        'banner': banner,
        'location': event.location,
        'map_query': event.map_query,
        'start_date': event.start_date,
        'start_time': event.start_time,
        'end_date': event.end_date,
        'end_time': event.end_time,
        'starts_at': event.starts_at,
        'ends_at': event.ends_at,
        'status': event.status,
        'phase': event.phase(),
        'organizer_name': org.organization_name or org.get_full_name() or 'Organizer',
        'organizer_verified': org.is_verified,
    }


def my_ticket_data(ticket, request=None, review_ids=None):
    from apps.reviews.rules import event_review_block
    review_ids = review_ids if review_ids is not None else {}
    my_review_id = review_ids.get(ticket.event_id)
    return {
        'id': str(ticket.id),
        'ticket_number': ticket.ticket_number,
        'qr_token': ticket.qr_token,
        'status': ticket.status,
        'attendee_name': ticket.attendee_name,
        'attendee_email': ticket.attendee_email,
        'order_reference': ticket.order.reference if ticket.order_id else None,
        'guest_number': ticket.guest_number,
        'seat_number': visible_seat(ticket),
        'pass_layout': ticket.event.ticket_layout,
        'attendee_phone': ticket.attendee_phone,
        'ticket_type': {'id': str(ticket.ticket_type_id), 'name': ticket.ticket_type.name} if ticket.ticket_type_id else None,
        'ticket_type_name': ticket.ticket_type_name,
        'price': str(ticket.price),
        'promo_code': ticket.promo_code.code if ticket.promo_code_id else None,
        'payment': ticket.order.payment_info() if ticket.order_id else None,
        'gate_note': ticket.ticket_type.gate_note if ticket.ticket_type_id else '',
        'is_attended': ticket.is_attended,
        'first_check_in': ticket.first_check_in,
        'last_activity': ticket.last_activity,
        'created_at': ticket.created_at,
        'event': event_summary(ticket.event, request),
        'my_review_id': str(my_review_id) if my_review_id else None,
        'can_review': my_review_id is None and event_review_block(request.user, ticket.event) is None,
    }


def _my_tickets(user):
    # Online checkouts in progress or abandoned aren't tickets (yet)
    return (EventTicket.objects.filter(user=user)
            .exclude(status=EventTicket.Status.RESERVED)
            .exclude(status=EventTicket.Status.CANCELLED, order__payment_status='failed')
            .select_related('event', 'event__organizer', 'ticket_type', 'promo_code', 'order'))


def _review_ids(user):
    from apps.reviews.models import Review
    return dict(Review.objects.filter(author=user, kind=Review.Kind.EVENT).values_list('event_id', 'id'))


class MyTicketsView(APIView):
    """GET ?when=upcoming|past|all (default all). Upcoming = not yet ended (soonest first);
    past = ended or cancelled (most recent first)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        when = request.query_params.get('when', 'all')
        if when not in ('upcoming', 'past', 'all'):
            return Response({'error': 'when must be upcoming, past or all.'}, status=status.HTTP_400_BAD_REQUEST)
        from apps.accounts.tenancy import scope_events
        tickets = list(scope_events(_my_tickets(request.user), request, 'event__organizer'))  # white-label site: theirs only
        phases = {t.event_id: t.event.phase() for t in tickets}
        upcoming = sorted((t for t in tickets if phases[t.event_id] in UPCOMING_PHASES), key=lambda t: t.event.starts_at)
        past = sorted((t for t in tickets if phases[t.event_id] not in UPCOMING_PHASES),
                      key=lambda t: t.event.starts_at, reverse=True)
        chosen = {'upcoming': upcoming, 'past': past, 'all': upcoming + past}[when]
        reviews = _review_ids(request.user)
        return Response({
            'count': len(chosen),
            'results': [my_ticket_data(t, request, reviews) for t in chosen],
        })


class MyTicketDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, ticket_id):
        from apps.accounts.tenancy import scope_events
        ticket = get_object_or_404(scope_events(_my_tickets(request.user), request, 'event__organizer'), pk=ticket_id)
        return Response(my_ticket_data(ticket, request, _review_ids(request.user)))
