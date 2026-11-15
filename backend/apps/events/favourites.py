"""Saved events ("favourites") for signed-in people. Module `favourites` (ModuleAccessMiddleware: /api/me/favourites/).

GET    /api/me/favourites/            → {ids: [event id…], events: [public event cards…]} (published ones only)
POST   /api/me/favourites/            {event: id or slug} → saves it
DELETE /api/me/favourites/<event id>/ → removes it
"""
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Event, EventFavourite

LISTED = [Event.Status.PUBLISHED, Event.Status.ONGOING, Event.Status.COMPLETED]


class MyFavouritesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from apps.accounts.tenancy import scope_events
        from .serializers import EventSerializer
        from .views import public_event_data
        events = list(scope_events(
            Event.objects.filter(favourites__user=request.user, status__in=LISTED).select_related('organizer')
            .order_by('-favourites__created_at'), request))
        data = EventSerializer(events, many=True, context={'request': request}).data
        return Response({'ids': [str(e.id) for e in events], 'events': [public_event_data(e, d) for e, d in zip(events, data)]})

    def post(self, request):
        ref = str(request.data.get('event') or '').strip()
        qs = Event.objects.filter(status__in=LISTED)
        event = (qs.filter(pk=ref).first() if len(ref) == 36 else None) or get_object_or_404(qs, slug=ref)
        EventFavourite.objects.get_or_create(user=request.user, event=event)
        return Response({'id': str(event.id), 'saved': True}, status=status.HTTP_201_CREATED)


class MyFavouriteDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, event_id):
        EventFavourite.objects.filter(user=request.user, event_id=event_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
