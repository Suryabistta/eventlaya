"""Cloudflare Turnstile check for contest votes and OTP requests.

Enabled per contest (Poll.captcha_enabled) and only when TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set;
otherwise it is skipped, so local development and tests need no keys.
"""
import logging

from .sms import env

logger = logging.getLogger(__name__)
VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'


def site_key():
    return env('TURNSTILE_SITE_KEY') if env('TURNSTILE_SECRET_KEY') else ''


def captcha_active(poll):
    return bool(poll.captcha_enabled and site_key())


def verify(token, ip=''):
    """True when Cloudflare accepts the token."""
    import requests
    if not token:
        return False
    try:
        res = requests.post(VERIFY_URL, data={'secret': env('TURNSTILE_SECRET_KEY'), 'response': token, 'remoteip': ip}, timeout=8)
        return bool(res.json().get('success'))
    except Exception:
        logger.exception('Turnstile verification failed')
        return False
