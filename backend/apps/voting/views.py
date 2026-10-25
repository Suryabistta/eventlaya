import hashlib
from django.shortcuts import get_object_or_404
from django.db import transaction, models
from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from apps.events.models import EventTicket
from .models import Poll, Candidate, Vote
from .serializers import PollSerializer, CandidateSerializer

class PollViewSet(viewsets.ModelViewSet):
    serializer_class = PollSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        event_id = self.request.query_params.get('event')
        if event_id:
            return Poll.objects.filter(event_id=event_id).prefetch_related('candidates')
        return Poll.objects.all().prefetch_related('candidates')


class CandidateViewSet(viewsets.ModelViewSet):
    serializer_class = CandidateSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Candidate.objects.all()


class CastVoteView(APIView):
    """
    Submits a vote with 1-person-1-vote verification.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request, poll_id):
        poll = get_object_or_404(Poll, id=poll_id)
        if not poll.is_active:
            return Response({'error': 'This poll is closed.'}, status=status.HTTP_400_BAD_REQUEST)

        candidate_id = request.data.get('candidate_id')
        voter_id_input = request.data.get('voter_identifier', '').strip()
        ticket_token = request.data.get('ticket_token', '').strip()

        candidate = get_object_or_404(Candidate, id=candidate_id, poll=poll)

        ticket = None
        if poll.require_ticket:
            if not ticket_token:
                return Response({'error': 'A valid attendee ticket is required to vote in this poll.'}, status=status.HTTP_400_BAD_REQUEST)
            ticket = EventTicket.objects.filter(event=poll.event, qr_token=ticket_token).first()
            if not ticket:
                return Response({'error': 'Ticket not found for this event.'}, status=status.HTTP_400_BAD_REQUEST)
            raw_identity = f"ticket:{ticket.id}"
        else:
            if not voter_id_input:
                return Response({'error': 'Voter identity (phone/email) is required.'}, status=status.HTTP_400_BAD_REQUEST)
            raw_identity = f"raw:{voter_id_input.lower()}"

        # Hash identity for privacy and uniqueness check
        voter_hash = hashlib.sha256(raw_identity.encode('utf-8')).hexdigest()

        if Vote.objects.filter(poll=poll, voter_identifier=voter_hash).exists():
            return Response({
                'error': 'You have already voted in this poll. Multiple voting is not allowed.'
            }, status=status.HTTP_409_CONFLICT)

        with transaction.atomic():
            Vote.objects.create(
                poll=poll,
                candidate=candidate,
                ticket=ticket,
                voter_identifier=voter_hash
            )
            # Atomically increment vote counter
            Candidate.objects.filter(id=candidate.id).update(vote_count=models.F('vote_count') + 1)
            candidate.refresh_from_db()

        return Response({
            'message': f"Vote recorded successfully for {candidate.name}!",
            'candidate_id': str(candidate.id),
            'new_vote_count': candidate.vote_count
        }, status=status.HTTP_201_CREATED)
