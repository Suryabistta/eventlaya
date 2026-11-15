"""SMS through Aakash SMS (Nepal). Off until AAKASH_SMS_TOKEN is set on the server; then send_sms() sends.

Used for optional contestant notifications (apps.voting.notify). Failures are logged, never raised.
"""
import logging
import re

import requests
from django.conf import settings

logger = logging.getLogger(__name__)
AAKASH_URL = 'https://sms.aakashsms.com/sms/v3/send'


def sms_enabled():
    return bool(getattr(settings, 'AAKASH_SMS_TOKEN', ''))


def normalize(phone):
    """Nepali mobile numbers as 10 digits (98XXXXXXXX); None when it isn't one."""
    digits = re.sub(r'\D', '', phone or '')
    if digits.startswith('977'):
        digits = digits[3:]
    return digits if re.fullmatch(r'9[678]\d{8}', digits) else None


def send_sms(phone, text):
    to = normalize(phone)
    if not to:
        return False
    if not sms_enabled():
        logger.info('SMS not sent (no AAKASH_SMS_TOKEN): %s', to)
        return False
    try:
        r = requests.post(AAKASH_URL, data={'auth_token': settings.AAKASH_SMS_TOKEN, 'to': to, 'text': text[:600]}, timeout=10)
        return r.status_code == 200
    except requests.RequestException as e:
        logger.warning('SMS to %s failed: %s', to, e)
        return False


def send_application_sms(response, event):
    """Text an applicant when their application is received (Aakash SMS, Nepal). Async thread, never raises."""
    phone = getattr(response, 'submitter_phone', '')
    if not phone or not sms_enabled():
        return False
    to = normalize(phone)
    if not to:
        return False
    import threading
    from apps.events.sub_events import display_title
    title = display_title(event)
    name = (response.submitter_name or 'there').strip().split()[0]
    msg = f"Namaste {name}, your application for '{title}' has been received (App No: {response.number}). The festival team will review your submission."

    def run():
        send_sms(to, msg)

    threading.Thread(target=run, daemon=True).start()
    return True


def send_review_sms(response, event):
    """Text an applicant when their application is accepted or rejected. Async thread, never raises."""
    phone = getattr(response, 'submitter_phone', '')
    if not phone or not sms_enabled():
        return False
    to = normalize(phone)
    if not to:
        return False
    import threading
    from apps.events.sub_events import display_title
    title = display_title(event)
    name = (response.submitter_name or 'there').strip().split()[0]
    if response.review_status == 'accepted':
        msg = f"Namaste {name}, congratulations! Your application for '{title}' has been accepted. Check your email for details."
    elif response.review_status == 'rejected':
        msg = f"Namaste {name}, thank you for applying to '{title}'. We regret that your application was not selected this time."
    else:
        return False

    def run():
        send_sms(to, msg)

    threading.Thread(target=run, daemon=True).start()
    return True
