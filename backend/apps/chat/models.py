"""Team chat: direct and group conversations inside one organizer's org (the organizer + their team)."""
import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

MAX_BODY = 4000


class Conversation(models.Model):
    class Kind(models.TextChoices):
        DIRECT = 'direct', 'Direct'
        GROUP = 'group', 'Group'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # The organizer whose org this chat belongs to. Members must stay in that org to keep access.
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='owned_chats')
    kind = models.CharField(max_length=10, choices=Kind.choices)
    title = models.CharField(max_length=120, blank=True)
    # Event crew groups are kept in sync with the event's gate staff (see crew.py).
    event = models.ForeignKey(
        'events.Event', null=True, blank=True, on_delete=models.SET_NULL, related_name='chat_conversations',
    )
    is_event_crew = models.BooleanField(default=False)
    # "<smaller user id>:<larger user id>" for direct chats, so each pair has one conversation.
    direct_key = models.CharField(max_length=80, null=True, blank=True, unique=True, editable=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
    )
    last_message_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-last_message_at', '-created_at']
        constraints = [
            models.UniqueConstraint(fields=['event'], condition=Q(is_event_crew=True), name='chat_one_crew_group_per_event'),
        ]

    def __str__(self):
        return self.title or f'{self.get_kind_display()} chat {self.id}'

    @staticmethod
    def pair_key(a_id, b_id):
        a, b = sorted([str(a_id), str(b_id)])
        return f'{a}:{b}'


class ConversationMember(models.Model):
    class Role(models.TextChoices):
        ADMIN = 'admin', 'Admin'
        MEMBER = 'member', 'Member'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='chat_memberships')
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    last_read_at = models.DateTimeField(default=timezone.now)
    last_read_message = models.ForeignKey(
        'Message', null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
    )
    muted = models.BooleanField(default=False)
    joined_at = models.DateTimeField(default=timezone.now)
    left_at = models.DateTimeField(null=True, blank=True)  # soft leave/removal; null = current member
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [['conversation', 'user']]
        indexes = [models.Index(fields=['user', 'left_at'])]

    def __str__(self):
        return f'{self.user} in {self.conversation}'


class Message(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='chat_messages',
    )
    body = models.TextField(max_length=MAX_BODY, blank=True)
    # Storage path (relative to MEDIA_ROOT) of an image uploaded through /api/uploads/.
    attachment = models.CharField(max_length=255, blank=True)
    attachment_name = models.CharField(max_length=255, blank=True)
    attachment_mime = models.CharField(max_length=100, blank=True)
    attachment_size = models.PositiveIntegerField(null=True, blank=True)
    reply_to = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    # Set by the client so a retried/offline send is stored once.
    client_id = models.CharField(max_length=64, blank=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [models.Index(fields=['conversation', '-created_at'])]
        constraints = [
            models.UniqueConstraint(
                fields=['sender', 'client_id'], condition=~Q(client_id=''), name='chat_unique_client_id_per_sender',
            ),
        ]

    def __str__(self):
        return f'{self.sender} @ {self.created_at:%Y-%m-%d %H:%M}'
