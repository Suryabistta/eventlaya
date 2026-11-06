"""Pluggable SMS sending for voter OTP codes.

Provider is chosen by env SMS_PROVIDER: "aakash" (default when AAKASH_SMS_TOKEN is set), "sparrow", or "console"
(development: the message is written to the server log, and kept in `console_outbox` for tests).

    SMS_PROVIDER=aakash   AAKASH_SMS_TOKEN=...                 # https://sms.aakashsms.com (Dashboard → API token)
    SMS_PROVIDER=sparrow  SPARROW_SMS_TOKEN=... SPARROW_SMS_FROM=...  # https://web.sparrowsms.com (optional)
"""
import logging
import os
import re

from django.conf import settings

logger = logging.getLogger(__name__)

console_outbox = []  # (to, text) sent by the console provider; tests read it


class SMSError(Exception):
    pass


def env(name, default=''):
    return getattr(settings, name, None) or os.environ.get(name, default)


def normalize_nepal_mobile(value):
    """'+977 984-1234567' → '9841234567'. Nepali mobiles are 10 digits starting 97 or 98. Raises ValueError."""
    digits = re.sub(r'\D', '', value or '')
    if digits.startswith('977') and len(digits) == 13:
        digits = digits[3:]
    if not re.fullmatch(r'9[78]\d{8}', digits):
        raise ValueError('Enter a Nepali mobile number: 10 digits starting with 98 or 97.')
    return digits


class ConsoleSMS:
    name = 'console'

    def send(self, to, text):
        console_outbox.append((to, text))
        del console_outbox[:-50]
        logger.warning('[SMS console] to %s: %s', to, text)


class AakashSMS:
    """Aakash SMS v3: POST https://sms.aakashsms.com/sms/v3/send  auth_token, to (10-digit, comma separated), text.

    Response: {"error": false, "message": "1 messages has been queued for delivery.", "data": {"valid": [...],
    "invalid": [...]}} — or {"error": true, "message": "Not enough balance."}.
    """
    name = 'aakash'
    URL = 'https://sms.aakashsms.com/sms/v3/send'

    def __init__(self, token=None):
        self.token = token or env('AAKASH_SMS_TOKEN')

    def send(self, to, text):
        import requests
        if not self.token:
            raise SMSError('AAKASH_SMS_TOKEN is not set.')
        try:
            res = requests.post(self.URL, data={'auth_token': self.token, 'to': to, 'text': text}, timeout=10)
            data = res.json()
        except Exception as e:  # network error, non-JSON body
            raise SMSError(f'Aakash SMS request failed: {e}') from e
        if res.status_code >= 400 or data.get('error'):
            raise SMSError(f"Aakash SMS: {data.get('message') or res.status_code}")
        valid = (data.get('data') or {}).get('valid') if isinstance(data.get('data'), dict) else None
        if valid is not None and not valid:
            raise SMSError('Aakash SMS rejected the number.')


class SparrowSMS:
    """Sparrow SMS v2: POST https://api.sparrowsms.com/v2/sms/  token, from (approved sender identity), to, text.

    Success is HTTP 200 with {"response_code": 200, ...}; errors are 4xx with {"response_code": 10xx, "response": "..."}.
    """
    name = 'sparrow'
    URL = 'https://api.sparrowsms.com/v2/sms/'

    def __init__(self, token=None, sender=None):
        self.token = token or env('SPARROW_SMS_TOKEN')
        self.sender = sender or env('SPARROW_SMS_FROM')

    def send(self, to, text):
        import requests
        if not self.token or not self.sender:
            raise SMSError('SPARROW_SMS_TOKEN and SPARROW_SMS_FROM must be set.')
        try:
            res = requests.post(self.URL, data={'token': self.token, 'from': self.sender, 'to': to, 'text': text}, timeout=10)
            data = res.json()
        except Exception as e:
            raise SMSError(f'Sparrow SMS request failed: {e}') from e
        if res.status_code != 200 or data.get('response_code') not in (200, None):
            raise SMSError(f"Sparrow SMS: {data.get('response') or res.status_code}")


PROVIDERS = {'console': ConsoleSMS, 'aakash': AakashSMS, 'sparrow': SparrowSMS}


def provider_name():
    name = (env('SMS_PROVIDER') or '').strip().lower()
    if name in PROVIDERS:
        return name
    return 'aakash' if env('AAKASH_SMS_TOKEN') else 'console'


def get_provider():
    return PROVIDERS[provider_name()]()


def send_sms(to, text):
    get_provider().send(to, text)
