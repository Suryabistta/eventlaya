"""Event crew groups: one group per event ("<Event title> crew") holding the organizer and the
staff assigned to the event's gates, kept in sync by signals (see signals.py).

Created lazily, when the first staff member is assigned. Membership is fully managed here, so
admins can't add/remove/rename these groups by hand. Backfill: `manage.py sync_crew_chats`.
"""
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from .models import Conversation, ConversationMember
from .services import MAX_TITLE, _add_members, _remove_members, notify_conversation

User = get_user_model()


def crew_title(event):
    return f'{event.title} crew'[:MAX_TITLE]


def crew_conversation(event):
    return Conversation.objects.filter(event=event, is_event_crew=True).first()


def sync_event_crew(event):
    """Bring the event's crew group in line with its gate assignments. Returns the group (or None)."""
    from apps.events.models import StaffGateAssignment

    organizer = event.organizer
    staff_ids = set(
        StaffGateAssignment.objects.filter(event=event, is_active=True, staff__role=User.Role.STAFF)
        .values_list('staff_id', flat=True)
    )
    conv = crew_conversation(event)
    if conv is None:
        if not staff_ids or organizer.role != User.Role.ORGANIZER:
            return None
        try:
            with transaction.atomic():
                conv = Conversation.objects.create(
                    owner=organizer, kind=Conversation.Kind.GROUP, title=crew_title(event), event=event,
                    is_event_crew=True, created_by=organizer,
                )
        except IntegrityError:
            conv = crew_conversation(event)

    changed = False
    if conv.title != crew_title(event):
        conv.title = crew_title(event)
        conv.save(update_fields=['title', 'updated_at'])
        changed = True
    if conv.owner_id != organizer.id:
        conv.owner = organizer
        conv.save(update_fields=['owner', 'updated_at'])
        changed = True

    current = set(conv.memberships.filter(left_at__isnull=True).values_list('user_id', flat=True))
    desired = staff_ids | {organizer.id}
    removed = current - desired
    if removed:
        _remove_members(conv, removed)
    if _add_members(conv, [organizer.id], role=ConversationMember.Role.ADMIN):
        changed = True
    if _add_members(conv, sorted(staff_ids - current, key=str)):
        changed = True
    if changed or removed:
        notify_conversation(conv, removed_ids=removed)
    return conv


def rename_event_crew(event):
    conv = crew_conversation(event)
    if conv and conv.title != crew_title(event):
        conv.title = crew_title(event)
        conv.save(update_fields=['title', 'updated_at'])
        notify_conversation(conv)


def detach_event_crew(event):
    """The event is being deleted: keep the history as an ordinary group the organizer can manage."""
    Conversation.objects.filter(event=event, is_event_crew=True).update(is_event_crew=False)
