from datetime import date, timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import FCMToken, PlatformModule, RoleModulePermission
from apps.accounts.modules import clear_cache
from apps.events.models import Event, EventGate, StaffGateAssignment

from . import realtime
from .models import Conversation, ConversationMember, Message

User = get_user_model()


def seed_chat_module():
    """The chat module as migration 0010 seeds it (on for organizer/staff, off for attendee/vendor)."""
    module, _ = PlatformModule.objects.get_or_create(slug='chat', defaults={'name': 'Team Chat'})
    for role in ('organizer', 'staff', 'attendee', 'vendor'):
        RoleModulePermission.objects.update_or_create(
            role=role, module=module, defaults={'is_enabled': role in ('organizer', 'staff')})
    clear_cache()


def make_user(name, role, **extra):
    return User.objects.create_user(
        username=name, email=f'{name}@example.com', password='password123', role=role, first_name=name.title(), **extra,
    )


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class ChatTestBase(APITestCase):
    def setUp(self):
        seed_chat_module()
        self.addCleanup(clear_cache)
        self.org = make_user('org', User.Role.ORGANIZER)
        self.s1 = make_user('sam', User.Role.STAFF, team_owner=self.org)
        self.s2 = make_user('sita', User.Role.STAFF, team_owner=self.org)
        self.other_org = make_user('rival', User.Role.ORGANIZER)
        self.other_staff = make_user('rob', User.Role.STAFF, team_owner=self.other_org)
        self.attendee = make_user('ann', User.Role.ATTENDEE)
        self.admin = make_user('root', User.Role.SUPERADMIN, is_superuser=True)

    def as_(self, user):
        self.client.force_authenticate(user=user)
        return self.client

    def direct(self, a, b):
        res = self.as_(a).post('/api/chat/conversations/', {'kind': 'direct', 'user_id': str(b.id)}, format='json')
        self.assertIn(res.status_code, (200, 201), res.data)
        return res.data['id']

    def group(self, members, title='Ops'):
        res = self.as_(self.org).post('/api/chat/conversations/', {
            'kind': 'group', 'title': title, 'user_ids': [str(u.id) for u in members],
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        return res.data['id']

    def send(self, user, conv_id, body='hello', **extra):
        return self.as_(user).post(f'/api/chat/conversations/{conv_id}/messages/', {'body': body, **extra}, format='json')

    def make_event(self, organizer=None, title='Fest', slug='fest'):
        return Event.objects.create(
            organizer=organizer or self.org, title=title, slug=slug, location='Kathmandu', start_date=date.today(),
        )


class DirectChatTests(ChatTestBase):
    def test_get_or_create_one_conversation_per_pair(self):
        res = self.as_(self.org).post('/api/chat/conversations/', {'kind': 'direct', 'user_id': str(self.s1.id)}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['kind'], 'direct')
        self.assertEqual(res.data['title'], 'Sam')
        self.assertEqual(res.data['other_member']['id'], str(self.s1.id))
        self.assertEqual(res.data['member_count'], 2)
        again = self.as_(self.s1).post('/api/chat/conversations/', {'user_id': str(self.org.id)}, format='json')
        self.assertEqual(again.status_code, status.HTTP_200_OK)
        self.assertEqual(again.data['id'], res.data['id'])
        self.assertEqual(again.data['title'], 'Org')
        self.assertEqual(Conversation.objects.count(), 1)

    def test_staff_to_staff_in_same_org(self):
        conv_id = self.direct(self.s1, self.s2)
        self.assertEqual(Conversation.objects.get(id=conv_id).owner, self.org)

    def test_cross_org_direct_chat_refused(self):
        for a, b in [(self.org, self.other_staff), (self.s1, self.other_staff), (self.org, self.other_org),
                     (self.s1, self.attendee), (self.admin, self.org), (self.org, self.admin), (self.attendee, self.org)]:
            res = self.as_(a).post('/api/chat/conversations/', {'kind': 'direct', 'user_id': str(b.id)}, format='json')
            self.assertIn(res.status_code, (400, 403), (a, b, res.data))
        self.assertEqual(Conversation.objects.count(), 0)

    def test_cannot_chat_with_self_or_unknown(self):
        self.assertEqual(self.as_(self.org).post('/api/chat/conversations/', {'user_id': str(self.org.id)}, format='json').status_code, 400)
        self.assertEqual(self.as_(self.org).post('/api/chat/conversations/', {'user_id': 'nope'}, format='json').status_code, 400)

    def test_staff_assigned_to_event_counts_as_org_member(self):
        freelancer = make_user('fred', User.Role.STAFF)  # not on the roster
        event = self.make_event()
        StaffGateAssignment.objects.create(staff=freelancer, event=event)
        self.assertEqual(self.as_(self.org).post('/api/chat/conversations/', {'user_id': str(freelancer.id)}, format='json').status_code, 201)


class IsolationTests(ChatTestBase):
    def setUp(self):
        super().setUp()
        self.conv_id = self.direct(self.org, self.s1)
        self.msg_id = self.send(self.org, self.conv_id).data['id']

    def test_outsiders_cannot_see_or_touch_conversation(self):
        for outsider in (self.other_org, self.other_staff, self.s2, self.attendee, self.admin):
            c = self.as_(outsider)
            self.assertEqual(c.get('/api/chat/conversations/').data, [])
            self.assertEqual(c.get(f'/api/chat/conversations/{self.conv_id}/').status_code, 404)
            self.assertEqual(c.get(f'/api/chat/conversations/{self.conv_id}/messages/').status_code, 404)
            self.assertEqual(self.send(outsider, self.conv_id).status_code, 404)
            self.assertEqual(c.post(f'/api/chat/conversations/{self.conv_id}/read/').status_code, 404)
            self.assertEqual(c.patch(f'/api/chat/messages/{self.msg_id}/', {'body': 'x'}, format='json').status_code, 404)
            self.assertEqual(c.delete(f'/api/chat/messages/{self.msg_id}/').status_code, 404)
        self.assertEqual(Message.objects.count(), 1)

    def test_staff_removed_from_team_loses_access(self):
        self.as_(self.org).delete(f'/api/auth/team/{self.s1.id}/')
        self.s1.refresh_from_db()
        self.s1.is_active = True  # even if the account stays usable, the chat belongs to the old org
        self.s1.save()
        c = self.as_(self.s1)
        self.assertEqual(c.get('/api/chat/conversations/').data, [])
        self.assertEqual(c.get(f'/api/chat/conversations/{self.conv_id}/messages/').status_code, 404)
        # ...and the organizer sees the direct chat as read-only.
        detail = self.as_(self.org).get(f'/api/chat/conversations/{self.conv_id}/').data
        self.assertTrue(detail['read_only'])
        res = self.send(self.org, self.conv_id)
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'read_only')

    def test_contacts_are_my_org_only(self):
        names = {u['email'] for u in self.as_(self.s1).get('/api/chat/contacts/').data}
        self.assertEqual(names, {'org@example.com', 'sita@example.com'})
        names = {u['email'] for u in self.as_(self.org).get('/api/chat/contacts/').data}
        self.assertEqual(names, {'sam@example.com', 'sita@example.com'})
        self.assertEqual(self.as_(self.admin).get('/api/chat/contacts/').data, [])
        # Attendees have chat switched off (the module middleware reads the JWT).
        self.client.force_authenticate(user=None)
        token = str(RefreshToken.for_user(self.attendee).access_token)
        self.assertEqual(self.client.get('/api/chat/contacts/', HTTP_AUTHORIZATION=f'Bearer {token}').status_code, 403)

    def test_contacts_hide_people_with_chat_switched_off(self):
        RoleModulePermission.objects.filter(module__slug='chat', role='staff').update(is_enabled=False)
        clear_cache()
        self.assertEqual(self.as_(self.org).get('/api/chat/contacts/').data, [])

    def test_module_switch_blocks_http(self):
        RoleModulePermission.objects.filter(module__slug='chat', role='staff').update(is_enabled=False)
        clear_cache()
        self.client.force_authenticate(user=None)
        token = str(RefreshToken.for_user(self.s1).access_token)
        res = self.client.get('/api/chat/conversations/', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'module_disabled')


class GroupTests(ChatTestBase):
    def test_organizer_creates_group(self):
        conv_id = self.group([self.s1, self.s2])
        detail = self.as_(self.s1).get(f'/api/chat/conversations/{conv_id}/').data
        self.assertEqual(detail['title'], 'Ops')
        self.assertEqual(detail['member_count'], 3)
        roles = {m['user']['id']: m['role'] for m in detail['members']}
        self.assertEqual(roles[str(self.org.id)], 'admin')
        self.assertEqual(roles[str(self.s1.id)], 'member')
        self.assertEqual(detail['my_role'], 'member')

    def test_only_organizers_create_groups_with_own_team(self):
        res = self.as_(self.s1).post('/api/chat/conversations/', {'kind': 'group', 'title': 'X', 'user_ids': []}, format='json')
        self.assertEqual(res.status_code, 403)
        res = self.as_(self.org).post('/api/chat/conversations/', {
            'kind': 'group', 'title': 'X', 'user_ids': [str(self.other_staff.id)]}, format='json')
        self.assertEqual(res.status_code, 403)
        res = self.as_(self.org).post('/api/chat/conversations/', {'kind': 'group', 'title': ' ', 'user_ids': []}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(Conversation.objects.count(), 0)

    def test_membership_changes(self):
        conv_id = self.group([self.s1])
        base = f'/api/chat/conversations/{conv_id}'
        c = self.as_(self.org)
        self.assertEqual(c.post(f'{base}/members/', {'user_ids': [str(self.other_staff.id)]}, format='json').status_code, 403)
        res = c.post(f'{base}/members/', {'user_ids': [str(self.s2.id)]}, format='json')
        self.assertEqual(res.data['member_count'], 3)
        # Non-admins can't manage.
        s1 = self.as_(self.s1)
        self.assertEqual(s1.delete(f'{base}/members/{self.s2.id}/').status_code, 403)
        self.assertEqual(s1.patch(base + '/', {'title': 'Mine'}, format='json').status_code, 403)
        # Rename, promote, remove.
        c = self.as_(self.org)
        self.assertEqual(c.patch(base + '/', {'title': 'Night shift'}, format='json').data['title'], 'Night shift')
        self.assertEqual(c.patch(f'{base}/members/{self.s1.id}/', {'role': 'admin'}, format='json').status_code, 200)
        self.assertEqual(c.delete(f'{base}/members/{self.s2.id}/').data['member_count'], 2)
        self.assertEqual(self.as_(self.s2).get(base + '/').status_code, 404)
        # The organizer can't be removed or demoted, even by another admin.
        s1 = self.as_(self.s1)
        self.assertEqual(s1.delete(f'{base}/members/{self.org.id}/').status_code, 403)
        self.assertEqual(s1.patch(f'{base}/members/{self.org.id}/', {'role': 'member'}, format='json').status_code, 403)
        # Re-adding someone who was removed works.
        self.assertEqual(s1.post(f'{base}/members/', {'user_ids': [str(self.s2.id)]}, format='json').data['member_count'], 3)

    def test_leave_and_mute(self):
        conv_id = self.group([self.s1])
        base = f'/api/chat/conversations/{conv_id}'
        self.assertEqual(self.as_(self.org).post(f'{base}/leave/').status_code, 403)
        self.assertTrue(self.as_(self.s1).post(f'{base}/mute/', {'muted': True}, format='json').data['muted'])
        self.assertFalse(self.as_(self.s1).patch(base + '/', {'muted': False}, format='json').data['muted'])
        self.assertEqual(self.as_(self.s1).post(f'{base}/leave/').status_code, 200)
        self.assertEqual(self.as_(self.s1).get(base + '/').status_code, 404)
        self.assertEqual(ConversationMember.objects.get(conversation_id=conv_id, user=self.s1).left_at is not None, True)

    def test_cannot_leave_direct_chat(self):
        conv_id = self.direct(self.org, self.s1)
        self.assertEqual(self.as_(self.s1).post(f'/api/chat/conversations/{conv_id}/leave/').status_code, 400)


class MessageTests(ChatTestBase):
    def setUp(self):
        super().setUp()
        self.conv_id = self.direct(self.org, self.s1)

    def test_send_list_and_cursor_pagination(self):
        base = timezone.now() - timedelta(hours=1)
        conv = Conversation.objects.get(id=self.conv_id)
        for i in range(7):
            Message.objects.create(conversation=conv, sender=self.org, body=f'm{i}', created_at=base + timedelta(minutes=i))
        c = self.as_(self.s1)
        url = f'/api/chat/conversations/{self.conv_id}/messages/'
        page = c.get(url, {'limit': 3}).data
        self.assertEqual([m['body'] for m in page['results']], ['m6', 'm5', 'm4'])
        self.assertTrue(page['has_more'])
        page = c.get(url, {'limit': 3, 'before': page['next_before']}).data
        self.assertEqual([m['body'] for m in page['results']], ['m3', 'm2', 'm1'])
        page = c.get(url, {'limit': 3, 'before': page['next_before']}).data
        self.assertEqual([m['body'] for m in page['results']], ['m0'])
        self.assertFalse(page['has_more'])
        self.assertIsNone(page['next_before'])
        # Timestamp cursor and catching up with `after`.
        page = c.get(url, {'before': (base + timedelta(minutes=2)).isoformat()}).data
        self.assertEqual([m['body'] for m in page['results']], ['m1', 'm0'])
        m4 = Message.objects.get(body='m4')
        page = c.get(url, {'after': str(m4.id)}).data
        self.assertEqual([m['body'] for m in page['results']], ['m5', 'm6'])
        self.assertEqual(c.get(url, {'before': 'garbage'}).status_code, 400)

    def test_send_validation_and_reply(self):
        self.assertEqual(self.send(self.org, self.conv_id, body='  ').status_code, 400)
        self.assertEqual(self.send(self.org, self.conv_id, body='x' * 4001).status_code, 400)
        first = self.send(self.org, self.conv_id, body='first').data
        res = self.send(self.s1, self.conv_id, body='reply', reply_to=first['id'])
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['reply_to']['id'], first['id'])
        self.assertEqual(res.data['sender']['id'], str(self.s1.id))
        other_conv = self.direct(self.org, self.s2)
        msg_elsewhere = self.send(self.org, other_conv).data['id']
        self.assertEqual(self.send(self.s1, self.conv_id, reply_to=msg_elsewhere).status_code, 400)

    def test_client_id_makes_send_idempotent(self):
        a = self.send(self.org, self.conv_id, body='once', client_id='abc-1')
        b = self.send(self.org, self.conv_id, body='once', client_id='abc-1')
        self.assertEqual(a.status_code, 201)
        self.assertEqual(b.status_code, 200)
        self.assertEqual(a.data['id'], b.data['id'])
        self.assertEqual(a.data['client_id'], 'abc-1')
        self.assertEqual(Message.objects.count(), 1)

    def test_image_attachment_must_be_own_upload(self):
        path = default_storage.save(f'uploads/chat/{self.org.id}/pic.png', ContentFile(b'png-bytes'))
        self.addCleanup(default_storage.delete, path)
        res = self.send(self.org, self.conv_id, body='', attachment={'url': default_storage.url(path), 'name': 'stage.png'})
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['attachment']['name'], 'stage.png')
        self.assertEqual(res.data['attachment']['mime'], 'image/png')
        self.assertEqual(res.data['attachment']['size'], 9)
        self.assertEqual(res.data['attachment']['url'], default_storage.url(path))
        # Someone else's upload, a missing file and paths outside uploads/ are refused.
        for bad in (default_storage.url(path), '/media/uploads/chat/x/../../secret.png', '/etc/passwd',
                    f'/media/uploads/chat/{self.s1.id}/missing.png'):
            self.assertEqual(self.send(self.s1, self.conv_id, attachment=bad).status_code, 400, bad)

    def test_edit_rules(self):
        msg = self.send(self.org, self.conv_id, body='typo').data
        url = f'/api/chat/messages/{msg["id"]}/'
        self.assertEqual(self.as_(self.s1).patch(url, {'body': 'hack'}, format='json').status_code, 403)
        res = self.as_(self.org).patch(url, {'body': 'fixed'}, format='json')
        self.assertEqual(res.data['body'], 'fixed')
        self.assertIsNotNone(res.data['edited_at'])
        Message.objects.filter(id=msg['id']).update(created_at=timezone.now() - timedelta(minutes=16))
        res = self.as_(self.org).patch(url, {'body': 'late'}, format='json')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'edit_window')

    def test_delete_rules(self):
        msg = self.send(self.org, self.conv_id, body='secret').data
        url = f'/api/chat/messages/{msg["id"]}/'
        self.assertEqual(self.as_(self.s1).delete(url).status_code, 403)  # direct chat: only the sender
        res = self.as_(self.org).delete(url)
        self.assertTrue(res.data['is_deleted'])
        self.assertEqual(res.data['body'], '')
        self.assertEqual(Message.objects.get(id=msg['id']).body, '')
        listed = self.as_(self.s1).get(f'/api/chat/conversations/{self.conv_id}/messages/').data['results'][0]
        self.assertTrue(listed['is_deleted'])
        self.assertEqual(self.as_(self.org).patch(url, {'body': 'back'}, format='json').status_code, 400)

    def test_group_admin_can_delete_others_messages(self):
        conv_id = self.group([self.s1, self.s2])
        msg = self.send(self.s1, conv_id, body='spam').data
        self.assertEqual(self.as_(self.s2).delete(f'/api/chat/messages/{msg["id"]}/').status_code, 403)
        self.assertEqual(self.as_(self.org).delete(f'/api/chat/messages/{msg["id"]}/').status_code, 200)


class UnreadTests(ChatTestBase):
    def test_unread_counts_and_mark_read(self):
        conv_id = self.direct(self.org, self.s1)
        group_id = self.group([self.s1])
        for i in range(3):
            self.send(self.org, conv_id, body=f'd{i}')
        last_group = self.send(self.org, group_id, body='g').data
        self.send(self.s1, group_id, body='mine')  # own messages never count (and mark the chat read)

        listed = {c['id']: c for c in self.as_(self.s1).get('/api/chat/conversations/').data}
        self.assertEqual(listed[conv_id]['unread_count'], 3)
        self.assertEqual(listed[conv_id]['last_message']['body'], 'd2')
        self.assertEqual(listed[group_id]['unread_count'], 0)
        self.assertEqual(self.as_(self.s1).get('/api/chat/unread/').data,
                         {'unread': 3, 'unread_conversations': 1, 'unread_including_muted': 3})

        first = Message.objects.filter(conversation_id=conv_id).order_by('created_at').first()
        res = self.as_(self.s1).post(f'/api/chat/conversations/{conv_id}/read/', {'message_id': str(first.id)}, format='json')
        self.assertEqual(res.data['unread_count'], 2)
        res = self.as_(self.s1).post(f'/api/chat/conversations/{conv_id}/read/')
        self.assertEqual(res.data['unread_count'], 0)
        # Reading never moves backwards.
        res = self.as_(self.s1).post(f'/api/chat/conversations/{conv_id}/read/', {'message_id': str(first.id)}, format='json')
        self.assertEqual(res.data['unread_count'], 0)
        self.assertEqual(self.as_(self.s1).get('/api/chat/unread/').data['unread'], 0)
        self.assertIsNotNone(last_group)

    def test_muted_chats_do_not_count_towards_badge(self):
        conv_id = self.direct(self.org, self.s1)
        self.send(self.org, conv_id)
        self.as_(self.s1).post(f'/api/chat/conversations/{conv_id}/mute/', {'muted': True}, format='json')
        data = self.as_(self.s1).get('/api/chat/unread/').data
        self.assertEqual((data['unread'], data['unread_including_muted']), (0, 1))

    def test_conversations_ordered_by_latest_message(self):
        a = self.direct(self.org, self.s1)
        b = self.direct(self.org, self.s2)
        self.send(self.org, b)
        self.send(self.org, a)
        self.assertEqual([c['id'] for c in self.as_(self.org).get('/api/chat/conversations/').data], [a, b])


class EventCrewTests(ChatTestBase):
    def setUp(self):
        super().setUp()
        self.event = self.make_event(title='Rock Night', slug='rock-night')
        self.gate = EventGate.objects.create(event=self.event, name='Main gate')

    def crew(self):
        return Conversation.objects.get(event=self.event, is_event_crew=True)

    def active_ids(self, conv):
        return set(conv.memberships.filter(left_at__isnull=True).values_list('user_id', flat=True))

    def test_created_on_first_assignment_and_kept_in_sync(self):
        self.assertFalse(Conversation.objects.filter(event=self.event).exists())
        res = self.as_(self.org).post('/api/events/staff-assign/', {
            'staff_email': self.s1.email, 'event_id': str(self.event.id), 'gate_id': str(self.gate.id),
        }, format='json')
        self.assertIn(res.status_code, (200, 201), res.data)
        crew = self.crew()
        self.assertEqual(crew.title, 'Rock Night crew')
        self.assertEqual(crew.owner, self.org)
        self.assertEqual(self.active_ids(crew), {self.org.id, self.s1.id})
        self.assertEqual(crew.memberships.get(user=self.org).role, 'admin')

        a2 = StaffGateAssignment.objects.create(staff=self.s2, event=self.event, gate=self.gate)
        self.assertEqual(self.active_ids(crew), {self.org.id, self.s1.id, self.s2.id})
        a2.delete()
        self.assertEqual(self.active_ids(crew), {self.org.id, self.s1.id})
        StaffGateAssignment.objects.create(staff=self.s2, event=self.event, gate=self.gate)
        self.assertEqual(self.active_ids(crew), {self.org.id, self.s1.id, self.s2.id})

        self.event.title = 'Rock Night II'
        self.event.save()
        self.assertEqual(self.crew().title, 'Rock Night II crew')
        self.assertEqual(Conversation.objects.filter(is_event_crew=True).count(), 1)

        listed = self.as_(self.s2).get('/api/chat/conversations/').data
        self.assertEqual(listed[0]['is_event_crew'], True)
        self.assertEqual(listed[0]['event']['id'], str(self.event.id))

    def test_crew_groups_are_managed_automatically(self):
        StaffGateAssignment.objects.create(staff=self.s1, event=self.event)
        base = f'/api/chat/conversations/{self.crew().id}'
        c = self.as_(self.org)
        self.assertEqual(c.post(f'{base}/members/', {'user_ids': [str(self.s2.id)]}, format='json').data['code'], 'event_crew')
        self.assertEqual(c.delete(f'{base}/members/{self.s1.id}/').status_code, 400)
        self.assertEqual(c.patch(base + '/', {'title': 'x'}, format='json').status_code, 400)
        self.assertEqual(self.as_(self.s1).post(f'{base}/leave/').status_code, 400)

    def test_team_removal_removes_from_crew(self):
        StaffGateAssignment.objects.create(staff=self.s1, event=self.event)
        crew = self.crew()
        self.as_(self.org).delete(f'/api/auth/team/{self.s1.id}/')
        self.assertEqual(self.active_ids(crew), {self.org.id})

    def test_event_delete_keeps_history_as_plain_group(self):
        StaffGateAssignment.objects.create(staff=self.s1, event=self.event)
        crew_id = self.crew().id
        self.event.delete()
        conv = Conversation.objects.get(id=crew_id)
        self.assertFalse(conv.is_event_crew)
        self.assertIsNone(conv.event_id)

    def test_backfill_command(self):
        StaffGateAssignment.objects.create(staff=self.s1, event=self.event)
        Conversation.objects.all().delete()
        other_event = self.make_event(title='Empty', slug='empty')
        call_command('sync_crew_chats', stdout=mock.MagicMock())
        call_command('sync_crew_chats', stdout=mock.MagicMock())  # idempotent
        self.assertEqual(self.active_ids(self.crew()), {self.org.id, self.s1.id})
        self.assertFalse(Conversation.objects.filter(event=other_event).exists())
        self.assertEqual(Conversation.objects.count(), 1)


class PushTests(ChatTestBase):
    def setUp(self):
        super().setUp()
        realtime.PUSH_IN_THREAD = False
        self.addCleanup(setattr, realtime, 'PUSH_IN_THREAD', True)

    def test_push_to_unmuted_members_except_sender(self):
        conv_id = self.group([self.s1, self.s2])
        FCMToken.objects.create(user=self.s1, token='tok-s1')
        FCMToken.objects.create(user=self.s2, token='tok-s2')
        FCMToken.objects.create(user=self.org, token='tok-org')
        self.as_(self.s2).post(f'/api/chat/conversations/{conv_id}/mute/', {'muted': True}, format='json')
        with mock.patch('apps.core.fcm.send_push_notification', return_value=True) as push, \
                self.captureOnCommitCallbacks(execute=True):
            self.send(self.org, conv_id, body='Doors open')
        self.assertEqual(push.call_count, 1)
        token, title, body, data = push.call_args.args
        self.assertEqual((token, title, body), ('tok-s1', 'Ops', 'Org: Doors open'))
        self.assertEqual(data['type'], 'chat_message')
        self.assertEqual(data['conversation_id'], conv_id)
        self.assertEqual(push.call_args.kwargs, {'count': 1})  # launcher badge: unread in this chat

    def test_push_count_is_the_recipients_unread_in_that_chat(self):
        conv_id = self.direct(self.org, self.s1)
        FCMToken.objects.create(user=self.s1, token='tok-s1')
        FCMToken.objects.create(user=self.org, token='tok-org')
        with mock.patch('apps.core.fcm.send_push_notification', return_value=True) as push:
            for body in ('One', 'Two'):
                with self.captureOnCommitCallbacks(execute=True):
                    self.send(self.org, conv_id, body=body)
        self.assertEqual([c.kwargs['count'] for c in push.call_args_list], [1, 2])
        # Replying marks the chat read for s1; org now has one unread.
        with mock.patch('apps.core.fcm.send_push_notification', return_value=True) as push, \
                self.captureOnCommitCallbacks(execute=True):
            self.send(self.s1, conv_id, body='Back')
        self.assertEqual((push.call_args.args[0], push.call_args.kwargs['count']), ('tok-org', 1))

    def test_send_works_without_firebase(self):
        conv_id = self.direct(self.org, self.s1)
        FCMToken.objects.create(user=self.s1, token='tok-s1')
        with self.captureOnCommitCallbacks(execute=True):
            res = self.send(self.org, conv_id)
        self.assertEqual(res.status_code, 201)
