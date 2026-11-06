"""Who may chat with whom.

There is no Organization table: an organizer *is* the org, and its members are the organizer plus
team_queryset(organizer) (staff on the roster or assigned to one of the organizer's events). A staff
member can therefore belong to more than one org. Every chat belongs to one org (Conversation.owner),
and access is re-checked on every request: an active membership row AND still being in that org.
Superadmins get no special access to org chats.
"""
from django.contrib.auth import get_user_model

from apps.accounts.modules import module_enabled
from apps.accounts.team import team_queryset

User = get_user_model()


def org_owner_ids(user):
    """Ids of the organizers whose org `user` belongs to."""
    if not user or not getattr(user, 'is_authenticated', False) or not user.is_active:
        return set()
    if user.role == User.Role.ORGANIZER:
        return {user.id}
    if user.role == User.Role.STAFF:
        from apps.events.models import StaffGateAssignment
        ids = set(
            StaffGateAssignment.objects.filter(staff=user, event__organizer__role=User.Role.ORGANIZER)
            .values_list('event__organizer_id', flat=True)
        )
        if user.team_owner_id and User.objects.filter(id=user.team_owner_id, role=User.Role.ORGANIZER).exists():
            ids.add(user.team_owner_id)
        return ids
    return set()


def org_member_ids(owner_id):
    """Active users in the organizer's org (organizer included)."""
    owner = User.objects.filter(id=owner_id, role=User.Role.ORGANIZER, is_active=True).first()
    if owner is None:
        return set()
    return {owner.id} | set(team_queryset(owner).filter(is_active=True).values_list('id', flat=True))


def in_org(user, owner_id):
    return owner_id in org_owner_ids(user)


def shared_owner_id(a, b):
    """The org two users share (None if none), preferring the organizer's own org or a's roster org."""
    shared = org_owner_ids(a) & org_owner_ids(b)
    if not shared:
        return None
    for candidate in (a.id, b.id, a.team_owner_id, b.team_owner_id):
        if candidate in shared:
            return candidate
    return sorted(shared, key=str)[0]


def contacts(user):
    """People `user` can start a direct chat with: everyone in their org(s) who has chat switched on."""
    ids = set()
    for owner_id in org_owner_ids(user):
        ids |= org_member_ids(owner_id)
    ids.discard(user.id)
    people = User.objects.filter(id__in=ids, is_active=True).order_by('first_name', 'last_name', 'email')
    return [u for u in people if module_enabled('chat', u)]
