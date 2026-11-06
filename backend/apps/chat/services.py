"""Chat operations shared by the REST views and the WebSocket consumer.

Every function takes the acting user, re-checks access (active membership + still in the chat's org)
and raises ChatError on refusal. Realtime events and pushes go out after the transaction commits.
"""
import mimetypes
import uuid
from datetime import timedelta
from urllib.parse import urlparse

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.storage import default_storage
from django.db import IntegrityError, transaction
from django.db.models import Count, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from . import realtime
from .access import org_member_ids, org_owner_ids, shared_owner_id
from .models import MAX_BODY, Conversation, ConversationMember, Message

User = get_user_model()

EDIT_WINDOW = timedelta(minutes=15)
DEFAULT_PAGE = 30
MAX_PAGE = 100
MAX_TITLE = 120
MAX_GROUP_MEMBERS = 500


class ChatError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _uuid(value):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return None


# ---------- Serialization ----------

def user_data(user):
    if user is None:
        return None
    avatar = None
    if user.avatar:
        try:
            avatar = user.avatar.url
        except ValueError:
            avatar = None
    return {
        'id': str(user.id),
        'name': user.get_full_name() or user.username,
        'email': user.email,
        'role': user.role,
        'avatar': avatar,
    }


def _message_qs():
    return Message.objects.select_related('sender', 'reply_to', 'reply_to__sender')


def message_data(m):
    deleted = m.deleted_at is not None
    attachment = None
    if m.attachment and not deleted:
        attachment = {
            'url': default_storage.url(m.attachment),
            'name': m.attachment_name,
            'mime': m.attachment_mime,
            'size': m.attachment_size,
        }
    reply = None
    if m.reply_to_id and m.reply_to is not None:
        r = m.reply_to
        r_deleted = r.deleted_at is not None
        reply = {
            'id': str(r.id),
            'sender_id': str(r.sender_id) if r.sender_id else None,
            'sender_name': (r.sender.get_full_name() or r.sender.username) if r.sender_id else None,
            'body': '' if r_deleted else r.body[:200],
            'has_attachment': bool(r.attachment) and not r_deleted,
            'is_deleted': r_deleted,
        }
    return {
        'id': str(m.id),
        'conversation_id': str(m.conversation_id),
        'sender': user_data(m.sender),
        'body': '' if deleted else m.body,
        'attachment': attachment,
        'reply_to': reply,
        'client_id': m.client_id or None,
        'created_at': m.created_at.isoformat(),
        'edited_at': m.edited_at.isoformat() if m.edited_at else None,
        'deleted_at': m.deleted_at.isoformat() if m.deleted_at else None,
        'is_deleted': deleted,
    }


def _iso(dt):
    return dt.isoformat() if dt else None


def my_memberships(user):
    return ConversationMember.objects.filter(
        user=user, left_at__isnull=True, conversation__owner_id__in=org_owner_ids(user),
    )


def _unread_subquery(user):
    return (
        Message.objects.filter(
            conversation=OuterRef('conversation_id'), created_at__gt=OuterRef('last_read_at'), deleted_at__isnull=True,
        )
        .exclude(sender=user).order_by().values('conversation').annotate(c=Count('id')).values('c')
    )


def unread_counts(conv_id, user_ids):
    """{user_id: unread messages in this conversation} for these members (push badge numbers)."""
    unread = (
        Message.objects.filter(
            conversation_id=conv_id, created_at__gt=OuterRef('last_read_at'), deleted_at__isnull=True,
        )
        .exclude(sender_id=OuterRef('user_id')).order_by().values('conversation').annotate(c=Count('id')).values('c')
    )
    rows = ConversationMember.objects.filter(conversation_id=conv_id, user_id__in=list(user_ids), left_at__isnull=True)
    return dict(rows.annotate(unread=Coalesce(Subquery(unread), 0)).values_list('user_id', 'unread'))


def conversations_for(user, conv_ids=None, include_members=False):
    """Conversation summaries as `user` sees them (newest activity first)."""
    qs = my_memberships(user).select_related('conversation', 'conversation__event')
    if conv_ids is not None:
        qs = qs.filter(conversation_id__in=conv_ids)
    count_sq = (
        ConversationMember.objects.filter(conversation=OuterRef('conversation_id'), left_at__isnull=True)
        .order_by().values('conversation').annotate(c=Count('id')).values('c')
    )
    latest_sq = Message.objects.filter(conversation=OuterRef('conversation_id')).order_by('-created_at', '-id').values('id')[:1]
    memberships = list(qs.annotate(
        unread=Coalesce(Subquery(_unread_subquery(user)), 0),
        member_count=Coalesce(Subquery(count_sq), 0),
        latest_message_id=Subquery(latest_sq),
    ))

    latest = _message_qs().in_bulk([m.latest_message_id for m in memberships if m.latest_message_id])
    direct_ids = [m.conversation_id for m in memberships if m.conversation.kind == Conversation.Kind.DIRECT]
    others = {
        cm.conversation_id: cm.user
        for cm in ConversationMember.objects.filter(conversation_id__in=direct_ids).exclude(user=user).select_related('user')
    }
    members = {}
    if include_members:
        for cm in (ConversationMember.objects.filter(conversation_id__in=[m.conversation_id for m in memberships], left_at__isnull=True)
                   .select_related('user').order_by('joined_at')):
            members.setdefault(cm.conversation_id, []).append({
                'user': user_data(cm.user),
                'role': cm.role,
                'joined_at': _iso(cm.joined_at),
                'last_read_at': _iso(cm.last_read_at),
                'last_read_message_id': str(cm.last_read_message_id) if cm.last_read_message_id else None,
            })
    org_cache = {}

    out = []
    for m in memberships:
        c = m.conversation
        other = others.get(c.id)
        read_only = False
        if c.kind == Conversation.Kind.DIRECT:
            if c.owner_id not in org_cache:
                org_cache[c.owner_id] = org_member_ids(c.owner_id)
            read_only = other is None or other.id not in org_cache[c.owner_id]
        last = latest.get(m.latest_message_id)
        data = {
            'id': str(c.id),
            'kind': c.kind,
            'title': (other.get_full_name() or other.username) if (c.kind == Conversation.Kind.DIRECT and other) else c.title,
            'is_event_crew': c.is_event_crew,
            'event': {'id': str(c.event_id), 'title': c.event.title} if c.event_id else None,
            'owner_id': str(c.owner_id),
            'created_by_id': str(c.created_by_id) if c.created_by_id else None,
            'created_at': _iso(c.created_at),
            'last_message_at': _iso(c.last_message_at),
            'last_message': message_data(last) if last else None,
            'unread_count': m.unread,
            'muted': m.muted,
            'my_role': m.role,
            'member_count': m.member_count,
            'other_member': user_data(other) if c.kind == Conversation.Kind.DIRECT else None,
            'read_only': read_only,
            'last_read_message_id': str(m.last_read_message_id) if m.last_read_message_id else None,
        }
        if include_members:
            data['members'] = members.get(c.id, [])
        out.append(data)
    out.sort(key=lambda d: d['last_message_at'] or d['created_at'], reverse=True)
    return out


def conversation_detail(user, conv_id):
    data = conversations_for(user, [conv_id], include_members=True)
    if not data:
        raise ChatError('not_found', 'Conversation not found.', 404)
    return data[0]


# ---------- Access ----------

def get_membership(user, conv_id):
    """The user's active membership in a conversation of an org they're still in, else 404."""
    cid = _uuid(conv_id)
    membership = cid and my_memberships(user).filter(conversation_id=cid).select_related('conversation').first()
    if not membership:
        raise ChatError('not_found', 'Conversation not found.', 404)
    return membership


def recipient_ids(conv):
    """Active members who still belong to the chat's org."""
    ids = set(conv.memberships.filter(left_at__isnull=True).values_list('user_id', flat=True))
    return ids & org_member_ids(conv.owner_id)


def notify_conversation(conv, removed_ids=()):
    """conversation.updated (each member's own view) and conversation.removed for people taken out."""
    conv_id, removed_ids = conv.id, list(removed_ids)

    def build():
        conversation = Conversation.objects.get(pk=conv_id)
        for uid in recipient_ids(conversation):
            user = User.objects.get(pk=uid)
            data = conversations_for(user, [conv_id], include_members=True)
            if data:
                yield uid, {'type': 'conversation.updated', 'conversation': data[0]}
        for uid in removed_ids:
            yield uid, {'type': 'conversation.removed', 'conversation_id': str(conv_id)}
    realtime.send_after_commit(build)


def _broadcast_message(event_type, msg):
    conv_id, msg_id = msg.conversation_id, msg.id

    def build():
        m = _message_qs().get(pk=msg_id)
        payload = {'type': event_type, 'conversation_id': str(conv_id), 'message': message_data(m)}
        if event_type == 'message.deleted':
            payload['message_id'] = str(msg_id)
        for uid in recipient_ids(m.conversation):
            yield uid, payload
    realtime.send_after_commit(build)


def _require_admin(membership):
    if membership.conversation.kind != Conversation.Kind.GROUP:
        raise ChatError('not_group', 'Only group chats have members to manage.')
    if membership.role != ConversationMember.Role.ADMIN:
        raise ChatError('forbidden', 'Only group admins can do that.', 403)


def _require_not_crew(conv):
    if conv.is_event_crew:
        raise ChatError('event_crew', 'Event crew groups are managed automatically from gate assignments.')


def _add_members(conv, user_ids, role=ConversationMember.Role.MEMBER):
    """Add (or re-add after leaving) members. Returns the ids actually added."""
    now, added = timezone.now(), []
    existing = {cm.user_id: cm for cm in conv.memberships.filter(user_id__in=user_ids)}
    for uid in user_ids:
        cm = existing.get(uid)
        if cm is None:
            ConversationMember.objects.create(conversation=conv, user_id=uid, role=role, joined_at=now, last_read_at=now)
            added.append(uid)
        elif cm.left_at is not None:
            cm.left_at, cm.joined_at, cm.last_read_at, cm.last_read_message, cm.role = None, now, now, None, role
            cm.muted = False
            cm.save()
            added.append(uid)
    return added


def _remove_members(conv, user_ids):
    return conv.memberships.filter(user_id__in=user_ids, left_at__isnull=True).update(left_at=timezone.now())


def _member_ids_from(value):
    if value is None:
        return []
    if not isinstance(value, (list, tuple)):
        raise ChatError('invalid', 'user_ids must be a list.')
    ids = []
    for v in value:
        u = _uuid(v)
        if u is None:
            raise ChatError('invalid', 'user_ids contains an invalid id.')
        ids.append(u)
    return list(dict.fromkeys(ids))


def _clean_title(title):
    title = (title or '').strip()
    if not title:
        raise ChatError('invalid', 'Give the group a name.')
    if len(title) > MAX_TITLE:
        raise ChatError('invalid', f'Group names can be at most {MAX_TITLE} characters.')
    return title


# ---------- Conversations ----------

def start_direct(user, other_id):
    """Get or create the one direct chat between `user` and `other_id`. Returns (conversation, created)."""
    oid = _uuid(other_id)
    other = oid and User.objects.filter(pk=oid, is_active=True).first()
    if not other or other.id == user.id:
        raise ChatError('invalid_user', 'Choose someone on your team to chat with.')
    owner_id = shared_owner_id(user, other)
    if owner_id is None:
        raise ChatError('not_in_org', 'You can only chat with people in your organization.', 403)

    key = Conversation.pair_key(user.id, other.id)
    created = False
    conv = Conversation.objects.filter(direct_key=key).first()
    if conv is None:
        try:
            with transaction.atomic():
                conv = Conversation.objects.create(
                    owner_id=owner_id, kind=Conversation.Kind.DIRECT, direct_key=key, created_by=user,
                )
                _add_members(conv, [user.id, other.id])
                created = True
        except IntegrityError:
            conv = Conversation.objects.get(direct_key=key)
    if not created:
        changed = False
        if conv.owner_id not in (org_owner_ids(user) & org_owner_ids(other)):
            conv.owner_id = owner_id
            conv.save(update_fields=['owner', 'updated_at'])
            changed = True
        if _add_members(conv, [user.id, other.id]):
            changed = True
        if changed:
            notify_conversation(conv)
    else:
        notify_conversation(conv)
    return conv, created


def create_group(user, title, member_ids):
    if user.role != User.Role.ORGANIZER or not user.is_active:
        raise ChatError('forbidden', 'Only organizers can create group chats.', 403)
    title = _clean_title(title)
    ids = _member_ids_from(member_ids)
    allowed = org_member_ids(user.id)
    if any(i not in allowed for i in ids):
        raise ChatError('not_in_org', 'Group members must be on your team.', 403)
    if len(ids) + 1 > MAX_GROUP_MEMBERS:
        raise ChatError('invalid', f'Groups can have at most {MAX_GROUP_MEMBERS} members.')
    with transaction.atomic():
        conv = Conversation.objects.create(owner=user, kind=Conversation.Kind.GROUP, title=title, created_by=user)
        _add_members(conv, [user.id], role=ConversationMember.Role.ADMIN)
        _add_members(conv, [i for i in ids if i != user.id])
    notify_conversation(conv)
    return conv


def rename(user, conv_id, title):
    membership = get_membership(user, conv_id)
    _require_admin(membership)
    conv = membership.conversation
    _require_not_crew(conv)
    conv.title = _clean_title(title)
    conv.save(update_fields=['title', 'updated_at'])
    notify_conversation(conv)
    return conv


def add_members(user, conv_id, member_ids):
    membership = get_membership(user, conv_id)
    _require_admin(membership)
    conv = membership.conversation
    _require_not_crew(conv)
    ids = _member_ids_from(member_ids)
    if not ids:
        raise ChatError('invalid', 'Choose at least one person to add.')
    allowed = org_member_ids(conv.owner_id)
    if any(i not in allowed for i in ids):
        raise ChatError('not_in_org', 'Group members must be on the team.', 403)
    if conv.memberships.filter(left_at__isnull=True).exclude(user_id__in=ids).count() + len(ids) > MAX_GROUP_MEMBERS:
        raise ChatError('invalid', f'Groups can have at most {MAX_GROUP_MEMBERS} members.')
    with transaction.atomic():
        added = _add_members(conv, ids)
    if added:
        notify_conversation(conv)
    return added


def remove_member(user, conv_id, target_id):
    membership = get_membership(user, conv_id)
    _require_admin(membership)
    conv = membership.conversation
    _require_not_crew(conv)
    tid = _uuid(target_id)
    if tid == user.id:
        raise ChatError('invalid', 'Use leave to leave a group.')
    if tid == conv.owner_id:
        raise ChatError('forbidden', "The organizer can't be removed from their group.", 403)
    if not tid or not _remove_members(conv, [tid]):
        raise ChatError('not_found', 'That person is not in this group.', 404)
    notify_conversation(conv, removed_ids=[tid])


def set_member_role(user, conv_id, target_id, role):
    membership = get_membership(user, conv_id)
    _require_admin(membership)
    conv = membership.conversation
    _require_not_crew(conv)
    if role not in ConversationMember.Role.values:
        raise ChatError('invalid', 'role must be "admin" or "member".')
    tid = _uuid(target_id)
    if tid == conv.owner_id and role != ConversationMember.Role.ADMIN:
        raise ChatError('forbidden', 'The organizer is always a group admin.', 403)
    target = tid and conv.memberships.filter(user_id=tid, left_at__isnull=True).first()
    if not target:
        raise ChatError('not_found', 'That person is not in this group.', 404)
    if target.role != role:
        target.role = role
        target.save(update_fields=['role', 'updated_at'])
        notify_conversation(conv)


def leave(user, conv_id):
    membership = get_membership(user, conv_id)
    conv = membership.conversation
    if conv.kind != Conversation.Kind.GROUP:
        raise ChatError('not_group', "You can't leave a direct chat; mute it instead.")
    _require_not_crew(conv)
    if conv.owner_id == user.id:
        raise ChatError('forbidden', "The organizer can't leave their own group; mute it instead.", 403)
    _remove_members(conv, [user.id])
    notify_conversation(conv, removed_ids=[user.id])


def set_muted(user, conv_id, muted):
    membership = get_membership(user, conv_id)
    membership.muted = bool(muted)
    membership.save(update_fields=['muted', 'updated_at'])
    conv_id = membership.conversation_id
    realtime.send_after_commit(lambda: [
        (user.id, {'type': 'conversation.updated', 'conversation': d}) for d in conversations_for(user, [conv_id], include_members=True)
    ])
    return membership


# ---------- Messages ----------

def _attachment(user, value):
    """Validate an image uploaded via /api/uploads/ by this user. Returns model field values."""
    if not value:
        return {}
    name = ''
    if isinstance(value, dict):
        name = str(value.get('name') or '')[:255]
        value = value.get('url') or value.get('path') or ''
    if not isinstance(value, str):
        raise ChatError('invalid_attachment', 'attachment must be the url returned by /api/uploads/.')
    path = urlparse(value).path
    media_prefix = urlparse(settings.MEDIA_URL).path
    if path.startswith(media_prefix):
        path = path[len(media_prefix):]
    path = path.lstrip('/')
    parts = path.split('/')
    if len(parts) != 4 or parts[0] != 'uploads' or any(p in ('', '.', '..') for p in parts) or parts[2] != str(user.id):
        raise ChatError('invalid_attachment', 'Attach an image you uploaded through /api/uploads/.')
    if not default_storage.exists(path):
        raise ChatError('invalid_attachment', 'That attachment no longer exists. Upload it again.')
    try:
        size = default_storage.size(path)
    except (OSError, NotImplementedError):
        size = None
    return {
        'attachment': path,
        'attachment_name': name or parts[3],
        'attachment_mime': mimetypes.guess_type(parts[3])[0] or 'application/octet-stream',
        'attachment_size': size,
    }


def _clean_body(body):
    if body is None:
        body = ''
    if not isinstance(body, str):
        raise ChatError('invalid', 'body must be text.')
    body = body.strip()
    if len(body) > MAX_BODY:
        raise ChatError('too_long', f'Messages can be at most {MAX_BODY} characters.')
    return body


def _push_preview(msg, conv, sender):
    sender_name = sender.get_full_name() or sender.username
    text = msg.body[:140] if msg.body else 'Sent a photo'
    if conv.kind == Conversation.Kind.GROUP:
        return conv.title or 'Group chat', f'{sender_name}: {text}'
    return sender_name, text


def send_message(user, conv_id, body='', attachment=None, reply_to=None, client_id=None):
    """Store and broadcast a message. Returns (message, created); a repeated client_id returns the original."""
    membership = get_membership(user, conv_id)
    conv = membership.conversation
    client_id = str(client_id or '').strip()[:64]
    if client_id:
        existing = _message_qs().filter(sender=user, client_id=client_id).first()
        if existing:
            if existing.conversation_id != conv.id:
                raise ChatError('invalid', 'client_id was already used for another conversation.')
            return existing, False

    body = _clean_body(body)
    fields = _attachment(user, attachment)
    if not body and not fields:
        raise ChatError('empty', 'Type a message or attach a photo.')
    if conv.kind == Conversation.Kind.DIRECT:
        other = conv.memberships.exclude(user=user).values_list('user_id', flat=True).first()
        if other is None or other not in org_member_ids(conv.owner_id):
            raise ChatError('read_only', 'This person is no longer on the team.', 403)
    reply = None
    if reply_to:
        rid = _uuid(reply_to)
        reply = rid and Message.objects.filter(pk=rid, conversation=conv).first()
        if not reply:
            raise ChatError('invalid', 'The message you are replying to is not in this conversation.')

    try:
        with transaction.atomic():
            msg = Message.objects.create(
                conversation=conv, sender=user, body=body, reply_to=reply, client_id=client_id, **fields,
            )
            Conversation.objects.filter(pk=conv.pk).update(last_message_at=msg.created_at, updated_at=msg.created_at)
            # Your own message marks the chat read up to it.
            ConversationMember.objects.filter(pk=membership.pk).update(last_read_at=msg.created_at, last_read_message=msg)
    except IntegrityError:
        existing = _message_qs().filter(sender=user, client_id=client_id).first() if client_id else None
        if existing and existing.conversation_id == conv.id:
            return existing, False
        raise

    _broadcast_message('message.new', msg)
    push_to = set(
        conv.memberships.filter(left_at__isnull=True, muted=False).exclude(user=user).values_list('user_id', flat=True)
    ) & org_member_ids(conv.owner_id)
    if push_to:
        title, text = _push_preview(msg, conv, user)
        realtime.push_after_commit(push_to, title, text, {
            'type': 'chat_message', 'conversation_id': str(conv.id), 'message_id': str(msg.id),
        }, counts=lambda ids: unread_counts(conv.id, ids))
    return _message_qs().get(pk=msg.pk), True


def _own_message(user, message_id):
    mid = _uuid(message_id)
    msg = mid and _message_qs().select_related('conversation').filter(pk=mid).first()
    if not msg:
        raise ChatError('not_found', 'Message not found.', 404)
    membership = get_membership(user, msg.conversation_id)
    return msg, membership


def edit_message(user, message_id, body):
    msg, _ = _own_message(user, message_id)
    if msg.sender_id != user.id:
        raise ChatError('forbidden', 'You can only edit your own messages.', 403)
    if msg.deleted_at:
        raise ChatError('deleted', 'This message was deleted.')
    if timezone.now() - msg.created_at > EDIT_WINDOW:
        raise ChatError('edit_window', 'Messages can only be edited for 15 minutes after sending.', 403)
    body = _clean_body(body)
    if not body and not msg.attachment:
        raise ChatError('empty', 'A message needs text. Delete it instead.')
    if body != msg.body:
        msg.body, msg.edited_at = body, timezone.now()
        msg.save(update_fields=['body', 'edited_at', 'updated_at'])
        _broadcast_message('message.updated', msg)
    return msg


def delete_message(user, message_id):
    msg, membership = _own_message(user, message_id)
    is_group_admin = (
        msg.conversation.kind == Conversation.Kind.GROUP and membership.role == ConversationMember.Role.ADMIN
    )
    if msg.sender_id != user.id and not is_group_admin:
        raise ChatError('forbidden', 'You can only delete your own messages.', 403)
    if msg.deleted_at is None:
        msg.deleted_at = timezone.now()
        msg.body = ''
        msg.attachment = msg.attachment_name = msg.attachment_mime = ''
        msg.attachment_size = None
        msg.save(update_fields=['deleted_at', 'body', 'attachment', 'attachment_name', 'attachment_mime',
                                'attachment_size', 'updated_at'])
        _broadcast_message('message.deleted', msg)
    return msg


def _cursor(conv, value, name):
    mid = _uuid(value)
    if mid:
        m = Message.objects.filter(pk=mid, conversation=conv).values('created_at', 'id').first()
        if not m:
            raise ChatError('invalid', f'{name} must be a message id from this conversation or an ISO timestamp.')
        return m['created_at'], m['id']
    dt = parse_datetime(str(value))
    if dt is None:
        raise ChatError('invalid', f'{name} must be a message id from this conversation or an ISO timestamp.')
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt)
    return dt, None


def list_messages(user, conv_id, before=None, after=None, limit=None):
    """Newest first (optionally `before` a cursor); with `after`, oldest first to catch up after reconnecting."""
    conv = get_membership(user, conv_id).conversation
    try:
        limit = min(max(int(limit or DEFAULT_PAGE), 1), MAX_PAGE)
    except (TypeError, ValueError):
        limit = DEFAULT_PAGE
    qs = _message_qs().filter(conversation=conv)
    if before and after:
        raise ChatError('invalid', 'Use either before or after, not both.')
    if after:
        t, mid = _cursor(conv, after, 'after')
        qs = qs.filter(Q(created_at__gt=t) | Q(created_at=t, id__gt=mid)) if mid else qs.filter(created_at__gt=t)
        rows = list(qs.order_by('created_at', 'id')[:limit + 1])
        has_more, rows = len(rows) > limit, rows[:limit]
        return {
            'results': [message_data(m) for m in rows], 'has_more': has_more,
            'next_after': str(rows[-1].id) if rows else None, 'order': 'oldest_first',
        }
    if before:
        t, mid = _cursor(conv, before, 'before')
        qs = qs.filter(Q(created_at__lt=t) | Q(created_at=t, id__lt=mid)) if mid else qs.filter(created_at__lt=t)
    rows = list(qs.order_by('-created_at', '-id')[:limit + 1])
    has_more, rows = len(rows) > limit, rows[:limit]
    return {
        'results': [message_data(m) for m in rows], 'has_more': has_more,
        'next_before': str(rows[-1].id) if rows and has_more else None, 'order': 'newest_first',
    }


def mark_read(user, conv_id, message_id=None):
    membership = get_membership(user, conv_id)
    conv = membership.conversation
    if message_id:
        mid = _uuid(message_id)
        msg = mid and Message.objects.filter(pk=mid, conversation=conv).first()
        if not msg:
            raise ChatError('not_found', 'Message not found.', 404)
    else:
        msg = Message.objects.filter(conversation=conv).order_by('-created_at', '-id').first()

    # Read position only moves forward.
    if msg and msg.id != membership.last_read_message_id and msg.created_at >= membership.last_read_at:
        membership.last_read_at, membership.last_read_message = msg.created_at, msg
        membership.save(update_fields=['last_read_at', 'last_read_message', 'updated_at'])
        payload = {
            'type': 'read', 'conversation_id': str(conv.id), 'user_id': str(user.id),
            'message_id': str(msg.id), 'read_at': msg.created_at.isoformat(),
        }
        realtime.send_after_commit(lambda: [(uid, payload) for uid in recipient_ids(conv)])
    unread = (
        Message.objects.filter(conversation=conv, created_at__gt=membership.last_read_at, deleted_at__isnull=True)
        .exclude(sender=user).count()
    )
    return {
        'conversation_id': str(conv.id),
        'last_read_message_id': str(membership.last_read_message_id) if membership.last_read_message_id else None,
        'last_read_at': membership.last_read_at.isoformat(),
        'unread_count': unread,
    }


def unread_summary(user):
    """Badge numbers. Muted chats don't count towards `unread`."""
    rows = list(my_memberships(user).annotate(unread=Coalesce(Subquery(_unread_subquery(user)), 0)).values('unread', 'muted'))
    return {
        'unread': sum(r['unread'] for r in rows if not r['muted']),
        'unread_conversations': sum(1 for r in rows if r['unread'] and not r['muted']),
        'unread_including_muted': sum(r['unread'] for r in rows),
    }


def typing_targets(user, conv_id):
    """Other members to tell that `user` is typing (raises if `user` can't post here)."""
    conv = get_membership(user, conv_id).conversation
    return [uid for uid in recipient_ids(conv) if uid != user.id]
