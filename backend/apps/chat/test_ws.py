"""WebSocket tests. TransactionTestCase so commits really happen (realtime events go out on commit)."""
import asyncio
import sys
import types
from datetime import timedelta

from asgiref.sync import sync_to_async

try:
    import daphne.testing  # noqa: F401
except ImportError:
    # channels.testing imports daphne only for ChannelsLiveServerTestCase, which we don't use; we don't
    # ship daphne (production runs uvicorn), so stand in an empty module.
    _stub = types.ModuleType('daphne.testing')
    _stub.DaphneProcess = None
    sys.modules.setdefault('daphne', types.ModuleType('daphne'))
    sys.modules.setdefault('daphne.testing', _stub)

from channels.testing import WebsocketCommunicator  # noqa: E402
from django.contrib.auth import get_user_model  # noqa: E402
from django.test import TransactionTestCase, override_settings  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402
from rest_framework_simplejwt.tokens import AccessToken  # noqa: E402

from apps.accounts.models import PlatformModule, RoleModulePermission  # noqa: E402
from apps.accounts.modules import clear_cache  # noqa: E402
from config.asgi import application  # noqa: E402

from .models import Message  # noqa: E402
from .tests import seed_chat_module  # noqa: E402

User = get_user_model()


def token_for(user, expired=False):
    token = AccessToken.for_user(user)
    if expired:
        token.set_exp(lifetime=-timedelta(minutes=1))
    return str(token)


@override_settings(
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}},
)
class ChatSocketTests(TransactionTestCase):
    def setUp(self):
        clear_cache()
        mk = lambda name, role, **kw: User.objects.create_user(  # noqa: E731
            username=name, email=f'{name}@example.com', password='password123', role=role, first_name=name.title(), **kw)
        self.org = mk('org', User.Role.ORGANIZER)
        self.s1 = mk('sam', User.Role.STAFF, team_owner=self.org)
        self.s2 = mk('sita', User.Role.STAFF, team_owner=self.org)
        self.outsider_org = mk('rival', User.Role.ORGANIZER)
        self.attendee = mk('ann', User.Role.ATTENDEE)
        seed_chat_module()
        self.addCleanup(clear_cache)

    # ----- helpers -----

    def api(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def make_direct(self, a, b):
        return self.api(a).post('/api/chat/conversations/', {'user_id': str(b.id)}, format='json').data['id']

    def make_group(self, members):
        return self.api(self.org).post('/api/chat/conversations/', {
            'kind': 'group', 'title': 'Crew', 'user_ids': [str(u.id) for u in members]}, format='json').data['id']

    async def connect(self, user=None, token=None, subprotocols=None, path=None):
        if path is None and subprotocols:
            path = '/ws/chat/'
        elif path is None:
            path = f'/ws/chat/?token={token if token is not None else token_for(user)}'
        comm = WebsocketCommunicator(application, path, subprotocols=subprotocols)
        connected, sub = await comm.connect()
        return comm, connected, sub

    async def connect_ready(self, user):
        comm, connected, _ = await self.connect(user)
        self.assertTrue(connected)
        ready = await comm.receive_json_from()
        self.assertEqual(ready['type'], 'ready')
        return comm

    async def expect_closed(self, comm, code, error_code):
        err = await comm.receive_json_from()
        self.assertEqual(err['type'], 'error')
        self.assertEqual(err['code'], error_code)
        out = await comm.receive_output()
        self.assertEqual(out['type'], 'websocket.close')
        self.assertEqual(out['code'], code)
        await comm.wait()

    async def next_of(self, comm, kind, timeout=1):
        """Next event of a type (skipping others, e.g. conversation.updated)."""
        while True:
            event = await comm.receive_json_from(timeout=timeout)
            if event['type'] == kind:
                return event

    # ----- auth -----

    async def test_rejects_missing_bad_and_expired_tokens(self):
        for path in ('/ws/chat/', '/ws/chat/?token=garbage', f'/ws/chat/?token={token_for(self.org, expired=True)}'):
            comm, connected, _ = await self.connect(path=path)
            self.assertTrue(connected)  # accepted, then closed with an app close code
            await self.expect_closed(comm, 4401, 'unauthenticated')

    async def test_inactive_user_rejected(self):
        token = token_for(self.s1)
        await User.objects.filter(pk=self.s1.pk).aupdate(is_active=False)
        comm, _, _ = await self.connect(token=token)
        await self.expect_closed(comm, 4401, 'unauthenticated')

    async def test_module_disabled_closes_with_4403(self):
        comm, _, _ = await self.connect(self.attendee)
        await self.expect_closed(comm, 4403, 'module_disabled')

        await RoleModulePermission.objects.filter(module__slug='chat', role='staff').aupdate(is_enabled=False)
        clear_cache()
        comm, _, _ = await self.connect(self.s1)
        await self.expect_closed(comm, 4403, 'module_disabled')

        await PlatformModule.objects.filter(slug='chat').aupdate(is_globally_enabled=False)
        clear_cache()
        comm, _, _ = await self.connect(self.org)
        await self.expect_closed(comm, 4403, 'module_disabled')

    async def test_module_switched_off_while_connected(self):
        from apps.chat import consumers
        comm = await self.connect_ready(self.s1)
        await RoleModulePermission.objects.filter(module__slug='chat', role='staff').aupdate(is_enabled=False)
        clear_cache()
        old = consumers.RECHECK_SECONDS
        consumers.RECHECK_SECONDS = 0
        try:
            await comm.send_json_to({'type': 'ping'})
            await self.expect_closed(comm, 4403, 'module_disabled')
        finally:
            consumers.RECHECK_SECONDS = old

    async def test_subprotocol_token_and_ready_payload(self):
        conv_id = await sync_to_async(self.make_direct)(self.org, self.s1)
        await sync_to_async(self.api(self.org).post)(f'/api/chat/conversations/{conv_id}/messages/', {'body': 'hi'}, format='json')
        comm, connected, sub = await self.connect(subprotocols=['bearer', token_for(self.s1)])
        self.assertTrue(connected)
        self.assertEqual(sub, 'bearer')
        ready = await comm.receive_json_from()
        self.assertEqual(ready, {'type': 'ready', 'user_id': str(self.s1.id), 'unread': 1,
                                 'unread_conversations': 1, 'unread_including_muted': 1})
        await comm.send_json_to({'type': 'ping'})
        self.assertEqual(await comm.receive_json_from(), {'type': 'pong'})
        await comm.disconnect()

    # ----- messaging -----

    async def test_rest_send_is_broadcast_to_members_only(self):
        conv_id = await sync_to_async(self.make_direct)(self.org, self.s1)
        sam = await self.connect_ready(self.s1)
        org = await self.connect_ready(self.org)
        sita = await self.connect_ready(self.s2)
        rival = await self.connect_ready(self.outsider_org)

        res = await sync_to_async(self.api(self.org).post)(
            f'/api/chat/conversations/{conv_id}/messages/', {'body': 'Gate B needs help', 'client_id': 'c1'}, format='json')
        self.assertEqual(res.status_code, 201)
        for comm in (sam, org):
            event = await self.next_of(comm, 'message.new')
            self.assertEqual(event['conversation_id'], conv_id)
            self.assertEqual(event['message']['body'], 'Gate B needs help')
            self.assertEqual(event['message']['client_id'], 'c1')
        self.assertTrue(await sita.receive_nothing())
        self.assertTrue(await rival.receive_nothing())

        # Edits and deletes are broadcast too.
        msg_id = res.data['id']
        await sync_to_async(self.api(self.org).patch)(f'/api/chat/messages/{msg_id}/', {'body': 'Gate C'}, format='json')
        event = await self.next_of(sam, 'message.updated')
        self.assertEqual(event['message']['body'], 'Gate C')
        await sync_to_async(self.api(self.org).delete)(f'/api/chat/messages/{msg_id}/')
        event = await self.next_of(sam, 'message.deleted')
        self.assertEqual(event['message_id'], msg_id)
        self.assertTrue(event['message']['is_deleted'])
        for comm in (sam, org, sita, rival):
            await comm.disconnect()

    async def test_send_over_socket_with_ack_and_idempotency(self):
        conv_id = await sync_to_async(self.make_group)([self.s1, self.s2])
        sam = await self.connect_ready(self.s1)
        sita = await self.connect_ready(self.s2)
        send = {'type': 'message.send', 'conversation_id': conv_id, 'body': 'On my way', 'client_id': 'tmp-1'}
        await sam.send_json_to(send)
        ack = await self.next_of(sam, 'ack')
        self.assertEqual(ack['client_id'], 'tmp-1')
        self.assertEqual(ack['message']['body'], 'On my way')
        new = await self.next_of(sita, 'message.new')
        self.assertEqual(new['message']['id'], ack['message']['id'])
        # A retry with the same client_id is acked with the same message and not stored again.
        await sam.send_json_to(send)
        ack2 = await self.next_of(sam, 'ack')
        self.assertEqual(ack2['message']['id'], ack['message']['id'])
        self.assertEqual(await Message.objects.acount(), 1)
        # Errors come back as error events, not disconnects.
        await sam.send_json_to({'type': 'message.send', 'conversation_id': conv_id, 'body': '', 'client_id': 'tmp-2'})
        err = await self.next_of(sam, 'error')
        self.assertEqual((err['code'], err['client_id'], err['request_type']), ('empty', 'tmp-2', 'message.send'))
        await sam.send_json_to({'type': 'nope'})
        self.assertEqual((await self.next_of(sam, 'error'))['code'], 'unknown_type')
        await sam.disconnect()
        await sita.disconnect()

    async def test_cannot_post_to_foreign_conversation(self):
        conv_id = await sync_to_async(self.make_direct)(self.org, self.s1)
        rival = await self.connect_ready(self.outsider_org)
        sita = await self.connect_ready(self.s2)
        for comm in (rival, sita):
            await comm.send_json_to({'type': 'message.send', 'conversation_id': conv_id, 'body': 'x'})
            self.assertEqual((await self.next_of(comm, 'error'))['code'], 'not_found')
            await comm.send_json_to({'type': 'typing', 'conversation_id': conv_id})
            self.assertEqual((await self.next_of(comm, 'error'))['code'], 'not_found')
            await comm.disconnect()
        self.assertEqual(await Message.objects.acount(), 0)

    async def test_typing_goes_to_other_members(self):
        conv_id = await sync_to_async(self.make_group)([self.s1, self.s2])
        sam = await self.connect_ready(self.s1)
        sita = await self.connect_ready(self.s2)
        await sam.send_json_to({'type': 'typing', 'conversation_id': conv_id, 'is_typing': True})
        event = await self.next_of(sita, 'typing')
        self.assertEqual(event, {'type': 'typing', 'conversation_id': conv_id, 'user_id': str(self.s1.id),
                                 'name': 'Sam', 'is_typing': True})
        self.assertTrue(await sam.receive_nothing())  # not echoed back
        await sam.disconnect()
        await sita.disconnect()

    async def test_read_receipts(self):
        conv_id = await sync_to_async(self.make_direct)(self.org, self.s1)
        res = await sync_to_async(self.api(self.org).post)(
            f'/api/chat/conversations/{conv_id}/messages/', {'body': 'ping'}, format='json')
        org = await self.connect_ready(self.org)
        sam = await self.connect_ready(self.s1)
        await sam.send_json_to({'type': 'read', 'conversation_id': conv_id, 'message_id': res.data['id']})
        ack = await self.next_of(sam, 'read.ack')
        self.assertEqual(ack['unread_count'], 0)
        receipt = await self.next_of(org, 'read')
        self.assertEqual((receipt['user_id'], receipt['message_id'], receipt['conversation_id']),
                         (str(self.s1.id), res.data['id'], conv_id))
        await org.disconnect()
        await sam.disconnect()

    async def test_membership_changes_are_pushed(self):
        conv_id = await sync_to_async(self.make_group)([self.s1])
        sita = await self.connect_ready(self.s2)
        await sync_to_async(self.api(self.org).post)(
            f'/api/chat/conversations/{conv_id}/members/', {'user_ids': [str(self.s2.id)]}, format='json')
        event = await self.next_of(sita, 'conversation.updated')
        self.assertEqual(event['conversation']['id'], conv_id)
        self.assertEqual(event['conversation']['member_count'], 3)
        await sync_to_async(self.api(self.org).delete)(f'/api/chat/conversations/{conv_id}/members/{self.s2.id}/')
        event = await self.next_of(sita, 'conversation.removed')
        self.assertEqual(event['conversation_id'], conv_id)
        # No more messages from that group.
        await sync_to_async(self.api(self.org).post)(f'/api/chat/conversations/{conv_id}/messages/', {'body': 'x'}, format='json')
        self.assertTrue(await sita.receive_nothing())
        await sita.disconnect()

    async def test_token_expiry_closes_socket(self):
        token = AccessToken.for_user(self.s1)
        token.set_exp(lifetime=timedelta(seconds=2))
        comm, connected, _ = await self.connect(token=str(token))
        self.assertEqual((await comm.receive_json_from())['type'], 'ready')
        await asyncio.sleep(2.1)
        await comm.send_json_to({'type': 'ping'})
        await self.expect_closed(comm, 4401, 'token_expired')
