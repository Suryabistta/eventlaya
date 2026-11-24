"""SMTP backend for production (Resend).

- Paces sends: Resend allows only a few emails per second per account, so bulk sends (guest messages, event
  cancelled, reminders) would otherwise lose everything past the limit. EMAIL_MIN_INTERVAL seconds between emails
  (per process); one retry after a short wait if the server still refuses one.
- Reply-To: replies go to EMAIL_REPLY_TO (support@eventlaya.com) unless the message sets its own.
"""
import logging
import threading
import time

from django.conf import settings
from django.core.mail.backends.smtp import EmailBackend

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_last_sent = 0.0


def _wait_turn():
    global _last_sent
    gap = float(getattr(settings, 'EMAIL_MIN_INTERVAL', 0.6))
    with _lock:
        wait = _last_sent + gap - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_sent = time.monotonic()


class PacedSMTPBackend(EmailBackend):
    def send_messages(self, email_messages):
        if not email_messages:
            return 0
        reply_to = getattr(settings, 'EMAIL_REPLY_TO', '')
        sent = 0
        new_conn = self.open()
        try:
            for msg in email_messages:
                if reply_to and not msg.reply_to:
                    msg.reply_to = [reply_to]
                for attempt in (1, 2):
                    _wait_turn()
                    try:
                        # The connection is already open, so the base class reuses it
                        if super().send_messages([msg]):
                            sent += 1
                            break
                    except Exception:
                        if attempt == 2:
                            raise
                    if attempt == 1:
                        logger.warning('Email to %s refused, retrying once', msg.to)
                        time.sleep(1.5)
                        # The server may have dropped the connection after the refusal
                        self.close()
                        self.open()
        finally:
            if new_conn:
                self.close()
        return sent
