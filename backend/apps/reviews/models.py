import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

MAX_TEXT = 1000


class Review(models.Model):
    """A 1–5 star review of exactly one event, vendor or venue, by one user (one review per user per target)."""

    class Kind(models.TextChoices):
        EVENT = 'event', 'Event'
        VENDOR = 'vendor', 'Vendor'
        VENUE = 'venue', 'Venue'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=10, choices=Kind.choices, db_index=True)
    # Reviews are the author's own content, so they go when the account is deleted.
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='reviews')
    event = models.ForeignKey('events.Event', null=True, blank=True, on_delete=models.CASCADE, related_name='reviews')
    vendor = models.ForeignKey('marketplace.VendorProfile', null=True, blank=True, on_delete=models.CASCADE, related_name='reviews')
    venue = models.ForeignKey('marketplace.VenueListing', null=True, blank=True, on_delete=models.CASCADE, related_name='reviews')

    rating = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])
    text = models.TextField(blank=True, max_length=MAX_TEXT)
    edited_at = models.DateTimeField(null=True, blank=True, help_text='Last time the author changed rating/text')

    # Moderation: event organizers and superadmins can hide; hidden reviews are never public.
    is_hidden = models.BooleanField(default=False, db_index=True)
    hidden_reason = models.CharField(max_length=255, blank=True)
    hidden_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    hidden_at = models.DateTimeField(null=True, blank=True)

    # One public reply from the owner of what was reviewed (organizer / vendor / venue owner).
    reply_text = models.TextField(blank=True, max_length=MAX_TEXT)
    reply_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    replied_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(fields=['author', 'event'], name='one_review_per_user_per_event'),
            models.UniqueConstraint(fields=['author', 'vendor'], name='one_review_per_user_per_vendor'),
            models.UniqueConstraint(fields=['author', 'venue'], name='one_review_per_user_per_venue'),
            models.CheckConstraint(
                condition=(
                    Q(kind='event', event__isnull=False, vendor__isnull=True, venue__isnull=True)
                    | Q(kind='vendor', event__isnull=True, vendor__isnull=False, venue__isnull=True)
                    | Q(kind='venue', event__isnull=True, vendor__isnull=True, venue__isnull=False)
                ),
                name='review_has_exactly_one_target',
            ),
            models.CheckConstraint(condition=Q(rating__gte=1, rating__lte=5), name='review_rating_1_to_5'),
        ]

    def __str__(self):
        return f"{self.rating}★ {self.kind} review by {self.author}"

    @property
    def target(self):
        return self.event or self.vendor or self.venue

    def target_owner_id(self):
        if self.kind == self.Kind.EVENT:
            return self.event.organizer_id
        if self.kind == self.Kind.VENDOR:
            return self.vendor.user_id
        return self.venue.owner_id
