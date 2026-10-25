import uuid
from django.db import models
from django.conf import settings

class Poll(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='polls'
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    require_ticket = models.BooleanField(default=True, help_text="Voter must have a valid ticket token for this event")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.title} ({self.event.title})"

    @property
    def total_votes(self):
        return self.votes.count()


class Candidate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='candidates')
    name = models.CharField(max_length=255)
    bio = models.TextField(blank=True)
    photo = models.ImageField(upload_to='voting/candidates/', null=True, blank=True)
    vote_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['-vote_count', 'name']

    def __str__(self):
        return self.name


class Vote(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='votes')
    candidate = models.ForeignKey(Candidate, on_delete=models.CASCADE, related_name='votes')
    ticket = models.ForeignKey(
        'events.EventTicket',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='poll_votes'
    )
    voter_identifier = models.CharField(
        max_length=64,
        db_index=True,
        help_text="SHA256 hash of voter identity to ensure 1-person-1-vote anonymity"
    )
    voted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [['poll', 'voter_identifier']]
