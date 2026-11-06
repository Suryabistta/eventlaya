"""Fan-out to WebSocket clients and push notifications.

Each connected socket joins the group `user_group(user_id)`; every event is sent per recipient, so
membership changes need no group bookkeeping. Sends run after the DB transaction commits, and
failures (e.g. Redis down) are logged, never raised into the request.
"""
import logging
import threading

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

from apps.core import fcm

logger = logging.getLogger(__name__)

# Tests switch this off to send pushes inline.
PUSH_IN_THREAD = True


def user_group(user_id):
    return f'chat_user_{str(user_id).replace("-", "")}'


def send_now(payloads):
    """payloads: iterable of (user_id, payload dict). Sends immediately (no transaction wait)."""
    payloads = list(payloads)
    layer = get_channel_layer()
    if layer is None or not payloads:
        return

    async def _send():
        for user_id, payload in payloads:
            await layer.group_send(user_group(user_id), {'type': 'chat.event', 'payload': payload})

    try:
        async_to_sync(_send)()
    except Exception:  # pragma: no cover - a dead channel layer must not break chat writes
        logger.exception('chat: realtime broadcast failed')


def send_after_commit(build):
    """Run `build()` once the transaction commits and send the (user_id, payload) pairs it returns."""
    def _run():
        try:
            payloads = list(build())
        except Exception:  # pragma: no cover
            logger.exception('chat: building realtime payloads failed')
            return
        send_now(payloads)
    transaction.on_commit(_run, robust=True)


def push_after_commit(user_ids, title, body, data, counts=None):
    """FCM push to these users' devices after commit; a no-op when Firebase isn't configured.

    `counts(user_ids) -> {user_id: n}` (optional, run after commit) gives each user's badge number.
    """
    def _run():
        from apps.accounts.models import FCMToken
        rows = list(FCMToken.objects.filter(user_id__in=list(user_ids)).values_list('user_id', 'token'))
        if not rows:
            return
        per_user = {}
        if counts is not None:
            try:
                per_user = counts({uid for uid, _ in rows})
            except Exception:  # pragma: no cover - a badge number is never worth a lost push
                logger.exception('chat: unread counts for push failed')

        def _send():
            for user_id, token in rows:
                try:
                    fcm.send_push_notification(token, title, body, data, count=per_user.get(user_id))
                except Exception:  # pragma: no cover
                    logger.exception('chat: push failed')

        if PUSH_IN_THREAD:
            threading.Thread(target=_send, daemon=True).start()
        else:
            _send()
    transaction.on_commit(_run, robust=True)
