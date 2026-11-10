"""SMS credits (module `sms`): every SMS an organizer's event sends uses credits from their balance.

Credits come from the plan (Plan.sms_credits per paid month, added when a payment is recorded) and from top-ups the
superadmin adds after a request (SmsCreditRequest) or by hand. One credit = one SMS segment: 160 characters, or 70
when the text has Nepali (Unicode) characters. With too few credits the SMS is skipped, never half-sent.
"""
import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Sum

from .models import SmsCreditEntry

logger = logging.getLogger(__name__)
User = get_user_model()


def segments(text):
    """SMS parts the text needs (concatenated parts carry a small header: 153 / 67 characters each)."""
    unicode_ = any(ord(c) > 127 for c in text)
    single, part = (70, 67) if unicode_ else (160, 153)
    n = len(text)
    return 1 if n <= single else -(-n // part)


def balance(org):
    return SmsCreditEntry.objects.filter(organization=org).aggregate(s=Sum('credits'))['s'] or 0


def add_credits(org, credits, kind, note='', by=None):
    return SmsCreditEntry.objects.create(organization=org, credits=credits, kind=kind, note=note[:255], created_by=by)


def send_paid_sms(org, phone, text, note=''):
    """Send one SMS on the organizer's credits. Returns True when sent; False when the module is off for them, the
    balance is too low, the number isn't a Nepali mobile, or the provider failed (the credits are given back)."""
    from apps.accounts.modules import module_enabled
    from apps.core.sms import normalize, send_sms, sms_enabled
    text = text[:600]
    if not org or not normalize(phone) or not sms_enabled() or not module_enabled('sms', org):
        return False
    need = segments(text)
    with transaction.atomic():
        User.objects.select_for_update().filter(pk=org.pk).first()  # one sender at a time per organization
        if balance(org) < need:
            logger.info('SMS skipped for %s: not enough credits', org.email)
            return False
        entry = add_credits(org, -need, SmsCreditEntry.Kind.USAGE, note or f'SMS to {normalize(phone)}')
    if send_sms(phone, text):
        return True
    entry.delete()  # not sent: refund
    return False
