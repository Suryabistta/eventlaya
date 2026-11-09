"""Superadmin → Featured events: pick events to list first on the events page (with a "Featured" badge).

GET  /api/platform/events/?search=&featured=1   published events, featured first (newest dates first otherwise)
POST /api/platform/events/<id>/feature/         {is_featured: bool}
"""
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.events.models import Event
from .models import AdminAction
from .org_admin import log
from .views import IsSuperadmin

LISTED = [Event.Status.PUBLISHED, Event.Status.ONGOING, Event.Status.COMPLETED]


def event_row(e):
    today = timezone.localdate()
    over = (e.end_date or e.start_date) < today if e.start_date else False
    return {
        'id': str(e.id), 'title': e.title, 'slug': e.slug, 'status': e.status, 'is_featured': e.is_featured,
        'start_date': e.start_date, 'location': e.location, 'over': over,
        'organizer': e.organizer.organization_name or e.organizer.get_full_name() or e.organizer.username,
    }


class FeaturedEventListView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        qs = Event.objects.filter(status__in=LISTED).select_related('organizer')
        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(organizer__organization_name__icontains=search) | Q(location__icontains=search))
        if request.query_params.get('featured') == '1':
            qs = qs.filter(is_featured=True)
        return Response([event_row(e) for e in qs.order_by('-is_featured', '-start_date')[:100]])


class FeatureEventView(APIView):
    permission_classes = [IsSuperadmin]

    def post(self, request, pk):
        event = get_object_or_404(Event.objects.select_related('organizer'), pk=pk)
        featured = bool(request.data.get('is_featured'))
        if event.is_featured != featured:
            event.is_featured = featured
            event.save(update_fields=['is_featured', 'updated_at'])
            log(request, event.organizer, AdminAction.Kind.FEATURED_EVENT if featured else AdminAction.Kind.UNFEATURED_EVENT, event.title)
        return Response(event_row(event))
