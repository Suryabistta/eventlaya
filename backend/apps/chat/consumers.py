"""WebSocket endpoint /ws/chat/: one socket per client, receiving events for all of the user's chats.

Auth: a simplejwt access token in `?token=<jwt>` or as the subprotocol pair ["bearer", "<jwt>"].
The socket is accepted and then closed with 4401 (missing/invalid/expired token) or 4403 (chat module
switched off for this user / account not allowed) so clients can tell auth failures from network drops.
Access is re-checked every RECHECK_SECONDS while connected, and the socket is closed with 4401 when the
token expires (reconnect with a fresh token).
"""
import time
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from . import realtime, services
from .services import ChatError, message_data

CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403
RECHECK_SECONDS = 30


def _token_from_scope(scope):
    """(token, subprotocol_to_accept)"""
    protocols = scope.get('subprotocols') or []
    if len(protocols) >= 2 and protocols[0].lower() in ('bearer', 'access_token', 'jwt'):
        return protocols[1], protocols[0]
    query = parse_qs((scope.get('query_string') or b'').decode('latin1'))
    token = (query.get('token') or [''])[0]
    return token, (protocols[0] if protocols else None)


@database_sync_to_async
def _authenticate(raw_token):
    """(user, expires_at_epoch) for a valid access token, else (None, None)."""
    if not raw_token:
        return None, None
    from rest_framework_simplejwt.authentication import JWTAuthentication
    from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken, TokenError
    try:
        auth = JWTAuthentication()
        validated = auth.get_validated_token(raw_token.encode())
        user = auth.get_user(validated)
    except (InvalidToken, TokenError, AuthenticationFailed):
        return None, None
    if not user or not user.is_active:
        return None, None
    return user, validated.get('exp')


@database_sync_to_async
def _allowed(user):
    """Close code if the user may not use chat right now, else None."""
    from django.contrib.auth import get_user_model
    from apps.accounts.modules import module_enabled
    fresh = get_user_model().objects.filter(pk=user.pk, is_active=True).first()
    if fresh is None:
        return CLOSE_UNAUTHENTICATED
    if not module_enabled('chat', fresh):
        return CLOSE_FORBIDDEN
    return None


class ChatConsumer(AsyncJsonWebsocketConsumer):
    user = None
    group = None

    async def connect(self):
        token, subprotocol = _token_from_scope(self.scope)
        self.user, self.expires_at = await _authenticate(token)
        await self.accept(subprotocol)
        if self.user is None:
            await self._reject(CLOSE_UNAUTHENTICATED, 'unauthenticated', 'Sign in again.')
            return
        code = await _allowed(self.user)
        if code:
            await self._reject(code, 'module_disabled', 'Chat is turned off for your account.')
            return
        self.checked_at = time.monotonic()
        self.group = realtime.user_group(self.user.id)
        await self.channel_layer.group_add(self.group, self.channel_name)
        summary = await database_sync_to_async(services.unread_summary)(self.user)
        await self.send_json({'type': 'ready', 'user_id': str(self.user.id), **summary})

    async def disconnect(self, code):
        if self.group:
            await self.channel_layer.group_discard(self.group, self.channel_name)
            self.group = None

    async def _reject(self, code, error_code, message):
        await self.send_json({'type': 'error', 'code': error_code, 'error': message})
        await self.close(code=code)

    async def _still_allowed(self):
        """Re-check token expiry, account and module switch (at most every RECHECK_SECONDS)."""
        if self.group is None:
            return False
        if self.expires_at and time.time() >= self.expires_at:
            await self.disconnect(CLOSE_UNAUTHENTICATED)
            await self._reject(CLOSE_UNAUTHENTICATED, 'token_expired', 'Your session expired. Reconnect with a new token.')
            return False
        if time.monotonic() - self.checked_at >= RECHECK_SECONDS:
            code = await _allowed(self.user)
            if code:
                await self.disconnect(code)
                await self._reject(code, 'module_disabled', 'Chat is turned off for your account.')
                return False
            self.checked_at = time.monotonic()
        return True

    # ----- server -> client -----

    async def chat_event(self, event):
        if await self._still_allowed():
            await self.send_json(event['payload'])

    # ----- client -> server -----

    async def receive_json(self, content, **kwargs):
        if not await self._still_allowed():
            return
        if not isinstance(content, dict):
            await self.send_json({'type': 'error', 'code': 'invalid', 'error': 'Send JSON objects.'})
            return
        kind = content.get('type')
        handler = {
            'message.send': self._send_message,
            'typing': self._typing,
            'read': self._read,
            'ping': self._ping,
        }.get(kind)
        if handler is None:
            await self.send_json({'type': 'error', 'code': 'unknown_type', 'error': f'Unknown type {kind!r}.'})
            return
        try:
            await handler(content)
        except ChatError as e:
            await self.send_json({
                'type': 'error', 'code': e.code, 'error': e.message, 'request_type': kind,
                'client_id': content.get('client_id'), 'conversation_id': content.get('conversation_id'),
            })

    async def _send_message(self, content):
        msg, _created = await database_sync_to_async(services.send_message)(
            self.user, content.get('conversation_id'), body=content.get('body'),
            attachment=content.get('attachment'), reply_to=content.get('reply_to'), client_id=content.get('client_id'),
        )
        data = await database_sync_to_async(message_data)(msg)
        await self.send_json({'type': 'ack', 'client_id': content.get('client_id'), 'message': data})

    async def _typing(self, content):
        conv_id = content.get('conversation_id')
        targets = await database_sync_to_async(services.typing_targets)(self.user, conv_id)
        payload = {
            'type': 'typing', 'conversation_id': str(conv_id), 'user_id': str(self.user.id),
            'name': self.user.get_full_name() or self.user.username, 'is_typing': bool(content.get('is_typing', True)),
        }
        for uid in targets:
            await self.channel_layer.group_send(realtime.user_group(uid), {'type': 'chat.event', 'payload': payload})

    async def _read(self, content):
        result = await database_sync_to_async(services.mark_read)(
            self.user, content.get('conversation_id'), content.get('message_id'),
        )
        await self.send_json({'type': 'read.ack', **result})

    async def _ping(self, content):
        await self.send_json({'type': 'pong'})
