"""A contestant edits their own profile through a private link (/contestant/<token>), no account needed.

Only the public-facing profile: photo, more photos, tagline, bio and social links. Name, number and status stay with
the organizer. The organizer can turn this off per contest (Poll.contestants_can_edit).
"""
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from .contest_serializers import ContestantSerializer
from .models import Candidate, audit

EDITABLE = ('subtitle', 'description', 'photo_url', 'gallery', 'social_links')


class SelfEditThrottle(SimpleRateThrottle):
    scope = 'contestant_self_edit'
    rate = '60/hour'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


def contestant_for(token):
    c = get_object_or_404(Candidate.objects.select_related('poll', 'poll__event'), edit_token=token) if token else None
    if c is None:
        from django.http import Http404
        raise Http404
    return c


def profile_links(c):
    from apps.core.email import site_url
    poll = c.poll
    base = site_url(poll.event)
    return {
        'profile_url': f'{base}/e/{poll.event.slug}/vote/{poll.slug or poll.id}/c/{poll.public_ref(c)}',
        'edit_url': f'{base}/contestant/{c.ensure_edit_token()}',
    }


def self_data(c):
    poll = c.poll
    return {
        'contest': {'title': poll.title, 'event_title': poll.event.title, 'status': poll.status},
        'contestant': {
            'name': c.name, 'display_number': poll.public_number(c.number),
            **{k: getattr(c, k) for k in EDITABLE},
        },
        'profile_url': profile_links(c)['profile_url'],
    }


class ContestantSelfView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [SelfEditThrottle]

    def get(self, request, token):
        c = contestant_for(token)
        if not c.poll.contestants_can_edit:
            return Response({'error': 'The organizers update contestant profiles for this contest.', 'code': 'edit_off'}, status=403)
        return Response(self_data(c))

    def patch(self, request, token):
        c = contestant_for(token)
        if not c.poll.contestants_can_edit:
            return Response({'error': 'The organizers update contestant profiles for this contest.', 'code': 'edit_off'}, status=403)
        data = {k: request.data[k] for k in EDITABLE if k in request.data}
        ser = ContestantSerializer(c, data=data, partial=True, context={'poll': c.poll})
        ser.is_valid(raise_exception=True)
        ser.save()
        audit(c.poll, None, 'contestant_self_edit', f'{c.name} updated their profile ({", ".join(sorted(data)) or "nothing"})')
        c.refresh_from_db()
        return Response(self_data(c))


class ContestantSelfUploadView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [SelfEditThrottle]
    parser_classes = [MultiPartParser]

    def post(self, request, token):
        from apps.core.uploads import store_image
        c = contestant_for(token)
        if not c.poll.contestants_can_edit:
            return Response({'error': 'The organizers update contestant profiles for this contest.'}, status=403)
        try:
            return Response(store_image(request.FILES.get('file'), f'uploads/contestant/self/{c.id}'), status=status.HTTP_201_CREATED)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
