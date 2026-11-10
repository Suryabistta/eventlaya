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
