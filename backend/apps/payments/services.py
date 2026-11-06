"""Payment flow: create an intent, start a checkout, verify with the provider, settle exactly once.

Nothing here trusts the browser: returns and polls only trigger a server-side lookup with the
provider, and the amount and ids it reports must match the intent.
"""
import logging
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import PaymentIntent, PaymentLog, PaymentSettings
from .providers import Khalti, ProviderError, available_providers, get_provider
from .registry import get_purpose

logger = logging.getLogger(__name__)
S = PaymentIntent.Status

# How often a status poll may ask the provider again
RECHECK_SECONDS = 4
# Expired intents are re-checked for this long, to catch payments made after the hold ran out
LATE_PAYMENT_WINDOW = timedelta(hours=3)


class PaymentError(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.message, self.code = message, code


def money(value):
    return Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _strip_secrets(data):
    """Provider responses are logged for audit; never keep anything key-like."""
    if isinstance(data, dict):
        return {k: ('***' if any(s in k.lower() for s in ('secret', 'key', 'signature', 'token', 'password')) else _strip_secrets(v))
                for k, v in data.items()}
    if isinstance(data, list):
        return [_strip_secrets(v) for v in data]
    return data


def log(intent, kind, message='', data=None, actor=None):
    return PaymentLog.objects.create(
        intent=intent, kind=kind, message=(message or '')[:255], data=_strip_secrets(data or {}),
        actor=actor if getattr(actor, 'is_authenticated', False) else None,
    )


def _lock(intent_or_id):
    pk = getattr(intent_or_id, 'pk', intent_or_id)
    return PaymentIntent.objects.select_for_update().get(pk=pk)


def reservation_minutes():
    return PaymentSettings.load().reservation_minutes or 15


# ---------------------------------------------------------------------------
# Creating and starting
# ---------------------------------------------------------------------------

def create_intent(*, purpose, amount, description, reference='', payer_name='', payer_email='', payer_phone='',
                  user=None, organizer=None, event=None, metadata=None, return_url='', expires_at=None):
    """A new payment for a registered purpose. amount is NPR (Decimal / str), > 0."""
    if get_purpose(purpose) is None:
        raise ValueError(f'Unknown payment purpose {purpose!r}; call register_purpose() first.')
    amount = money(amount)
    if amount <= 0:
        raise ValueError('amount must be more than 0')
    intent = PaymentIntent.objects.create(
        purpose=purpose, reference=str(reference or ''), description=(description or purpose)[:200], amount=amount,
        payer_name=(payer_name or '')[:255], payer_email=payer_email or '', payer_phone=(payer_phone or '')[:30],
        user=user if getattr(user, 'is_authenticated', False) else None, organizer=organizer, event=event,
        metadata=metadata or {}, return_url=return_url or '',
        expires_at=expires_at or timezone.now() + timedelta(minutes=reservation_minutes()),
    )
    log(intent, 'created', f'Rs {amount} for {purpose}', {'reference': intent.reference})
    return intent


def callback_base(request=None):
    base = getattr(settings, 'PAYMENTS_CALLBACK_BASE_URL', '') or (request.build_absolute_uri('/') if request is not None else '')
    return (base or getattr(settings, 'FRONTEND_URL', 'http://localhost:5173')).rstrip('/')


def callback_urls(intent, request=None):
    base = callback_base(request)
    front = urlparse(intent.return_url) if intent.return_url else None
    website = f'{front.scheme}://{front.netloc}/' if front and front.netloc else getattr(settings, 'FRONTEND_URL', base) + '/'
    return {
        'return': f'{base}/api/payments/return/khalti/{intent.id}/',
        'success': f'{base}/api/payments/return/esewa/{intent.id}/success/',
        'failure': f'{base}/api/payments/return/esewa/{intent.id}/failure/',
        'test_page': f'{base}/api/payments/test/{intent.id}/',
        'website': website,
    }


def check_provider(provider_id, amount=None):
    """Raise PaymentError unless this provider can take this amount right now."""
    provider = get_provider(provider_id)
    if provider is None or provider not in available_providers():
        raise PaymentError(f'{provider.name if provider else "That payment method"} is not available right now. Choose another option.')
    if amount is not None and provider.id == Khalti.id and money(amount) < Khalti.MIN_AMOUNT:
        raise PaymentError('Khalti takes payments of Rs 10 or more. Choose another option.')
    return provider


def start_checkout(intent, provider_id, request=None):
    """Send the intent to the provider. Returns the checkout: {'redirect_url'} or {'form_action', 'fields'}.

    The same provider again (e.g. a reload) re-uses the running checkout; switching providers mid-way is refused.
    """
    error = None
    with transaction.atomic():
        intent = _lock(intent)
        if intent.status not in PaymentIntent.OPEN:
            raise PaymentError(f'This payment is already {intent.get_status_display().lower()}.', 409)
        if intent.expires_at and intent.expires_at <= timezone.now():
            raise PaymentError('This payment has expired. Start again.', 409)
        provider = check_provider(provider_id, intent.amount)
        if intent.status == S.PENDING and intent.provider:
            if intent.provider != provider.id:
                raise PaymentError(f'This payment was already started with {get_provider(intent.provider).name}.', 409)
            if intent.checkout:
                return intent.checkout
        try:
            ref, checkout, raw = provider.start(intent, callback_urls(intent, request))
        except ProviderError as e:
            error = e
        else:
            intent.provider, intent.provider_ref, intent.checkout, intent.status = provider.id, ref, checkout, S.PENDING
            intent.save(update_fields=['provider', 'provider_ref', 'checkout', 'status', 'updated_at'])
            log(intent, 'checkout', f'Started with {provider.name}', {'provider_ref': ref, 'response': raw})
            return checkout
    # Logged after the transaction: inside it, raising would roll the log row back with everything else
    log(intent, 'checkout_error', error.message, error.data)
    raise PaymentError(error.message, 502)


# ---------------------------------------------------------------------------
# Settling (exactly once)
# ---------------------------------------------------------------------------

def _platform_fee():
    pct = PaymentSettings.load().platform_fee_percent or Decimal('0')
    return pct


def _fulfil(intent):
    """Run the purpose's on_paid once. Caller holds the row lock inside a transaction."""
    if intent.status != S.PAID or intent.fulfilled_at:
        return False
    purpose = get_purpose(intent.purpose)
    if purpose is None:
        log(intent, 'fulfil_error', f'No handler registered for {intent.purpose}')
        return False
    try:
        with transaction.atomic():  # savepoint: a failing handler leaves nothing half-done
            purpose.on_paid(intent)
            intent.fulfilled_at = timezone.now()
            intent.save(update_fields=['fulfilled_at', 'updated_at'])
    except Exception as e:  # noqa: BLE001 — retried by later verifies and the cron
        logger.exception('on_paid failed for payment %s', intent.id)
        log(intent, 'fulfil_error', str(e)[:255])
        return False
    log(intent, 'fulfilled', f'{purpose.label} delivered')
    return True


def mark_paid(intent, txn_id='', fee=None, actor=None, note=''):
    """Record a successful payment and deliver it. Idempotent: a second call does nothing."""
    with transaction.atomic():
        intent = _lock(intent)
        if intent.status in (S.PAID, S.REFUNDED):
            _fulfil(intent)
            return intent
        previous = intent.status
        pct = _platform_fee()
        intent.status, intent.paid_at = S.PAID, timezone.now()
        intent.provider_txn_id = txn_id or intent.provider_txn_id
        intent.provider_fee = fee if fee is not None else intent.provider_fee
        intent.platform_fee_percent = pct
        intent.platform_fee = money(intent.amount * pct / Decimal('100'))
        intent.failure_reason = ''
        intent.save()
        log(intent, 'paid', note or f'Paid with {intent.get_provider_display() or intent.provider}',
            {'previous_status': previous, 'txn_id': txn_id}, actor)
        if previous in PaymentIntent.CLOSED_UNPAID:
            log(intent, 'late_payment', f'Paid after it was {previous}')
        _fulfil(intent)
        return intent


def close(intent, status, reason='', actor=None):
    """Cancel / fail / expire an open intent and let the purpose release what it held. Idempotent."""
    assert status in PaymentIntent.CLOSED_UNPAID
    with transaction.atomic():
        intent = _lock(intent)
        if intent.status not in PaymentIntent.OPEN:
            return intent
        intent.status, intent.failure_reason = status, (reason or '')[:255]
        intent.save(update_fields=['status', 'failure_reason', 'updated_at'])
        log(intent, status, reason, actor=actor)
        purpose = get_purpose(intent.purpose)
        if purpose and purpose.on_failed:
            try:
                with transaction.atomic():
                    purpose.on_failed(intent)
            except Exception as e:  # noqa: BLE001
                logger.exception('on_failed failed for payment %s', intent.id)
                log(intent, 'release_error', str(e)[:255])
        return intent


def mark_refunded(intent, actor=None, note=''):
    """Record that the money went back (done by hand in the merchant dashboard). Paid intents only."""
    with transaction.atomic():
        intent = _lock(intent)
        if intent.status == S.REFUNDED:
            return intent
        if intent.status != S.PAID:
            raise PaymentError('Only paid payments can be marked refunded.', 409)
        intent.status, intent.refunded_at, intent.refund_note = S.REFUNDED, timezone.now(), (note or '').strip()
        intent.save(update_fields=['status', 'refunded_at', 'refund_note', 'updated_at'])
        log(intent, 'refunded', note or 'Marked refunded', actor=actor)
        purpose = get_purpose(intent.purpose)
        if purpose and purpose.on_refunded:
            purpose.on_refunded(intent)
        return intent


def apply_result(intent, result, source='verify'):
    """Act on a provider lookup."""
    if result.state == 'paid':
        if result.amount is not None and money(result.amount) != intent.amount:
            log(intent, 'tamper', f'Amount mismatch: provider says Rs {result.amount}, expected Rs {intent.amount}',
                {'provider_status': result.provider_status})
            PaymentIntent.objects.filter(pk=intent.pk).update(failure_reason='Amount did not match; not accepted.')
            return PaymentIntent.objects.get(pk=intent.pk)
        return mark_paid(intent, result.txn_id, result.fee, note=f'Confirmed by {source}')
    if result.state == 'refunded':
        if intent.status == S.PAID:
            return mark_refunded(intent, note=f'Refunded at {intent.get_provider_display()} ({result.provider_status})')
        return close(intent, S.FAILED, f'{result.provider_status} at the provider')
    if result.state in ('failed', 'cancelled', 'expired'):
        return close(intent, {'failed': S.FAILED, 'cancelled': S.CANCELLED, 'expired': S.EXPIRED}[result.state],
                     result.provider_status or result.state)
    return intent


def verify(intent, source='verify'):
    """Look the payment up with the provider (server to server) and settle it. Returns the fresh intent."""
    intent = PaymentIntent.objects.get(pk=intent.pk)
    provider = get_provider(intent.provider)
    if provider is None or not intent.provider_ref:
        return intent
    PaymentIntent.objects.filter(pk=intent.pk).update(last_checked_at=timezone.now())
    try:
        result = provider.lookup(intent)
    except ProviderError as e:
        log(intent, 'verify_error', e.message, e.data)
        return PaymentIntent.objects.get(pk=intent.pk)
    log(intent, 'verify', f'{source}: {result.provider_status or result.state}',
        {'state': result.state, 'response': result.raw})
    return apply_result(intent, result, source)


def refresh(intent):
    """For status polls: re-check open intents with the provider (rate limited), finish stuck fulfilments."""
    now = timezone.now()
    if intent.status in PaymentIntent.OPEN and intent.provider and (
            not intent.last_checked_at or now - intent.last_checked_at > timedelta(seconds=RECHECK_SECONDS)):
        intent = verify(intent, 'status check')
    if intent.status in PaymentIntent.OPEN and intent.expires_at and intent.expires_at < now - timedelta(minutes=2):
        intent = close(intent, S.EXPIRED, 'Not paid in time')
    if intent.status == S.PAID and not intent.fulfilled_at:
        with transaction.atomic():
            _fulfil(_lock(intent))
        intent = PaymentIntent.objects.get(pk=intent.pk)
    return intent


def expire_stale(now=None, check_provider=True):
    """Cron: close intents past their hold (asking the provider first), catch late payments, retry fulfilment."""
    now = now or timezone.now()
    counts = {'expired': 0, 'paid': 0, 'late_paid': 0, 'fulfilled': 0}
    for intent in PaymentIntent.objects.filter(status__in=PaymentIntent.OPEN, expires_at__lt=now):
        if check_provider and intent.provider and intent.provider_ref:
            intent = verify(intent, 'expiry check')
        if intent.status == S.PAID:
            counts['paid'] += 1
            continue
        if intent.status in PaymentIntent.OPEN:
            close(intent, S.EXPIRED, 'Not paid in time')
        counts['expired'] += 1
    if check_provider:
        recent = PaymentIntent.objects.filter(
            status=S.EXPIRED, provider__in=['khalti', 'esewa'], expires_at__gte=now - LATE_PAYMENT_WINDOW,
        ).exclude(provider_ref='')
        for intent in recent:
            if verify(intent, 'late payment check').status == S.PAID:
                counts['late_paid'] += 1
    for intent in PaymentIntent.objects.filter(status=S.PAID, fulfilled_at__isnull=True):
        with transaction.atomic():
            if _fulfil(_lock(intent)):
                counts['fulfilled'] += 1
    return counts


# ---------------------------------------------------------------------------
# Return URLs
# ---------------------------------------------------------------------------

def safe_return_url(url):
    """The frontend page to come back to, if it's one of ours (platform hosts or a claimed white-label domain)."""
    if not url or not isinstance(url, str) or len(url) > 450:
        return ''
    parts = urlparse(url)
    if parts.scheme not in ('http', 'https') or not parts.netloc:
        return ''
    host = parts.hostname or ''
    front = urlparse(getattr(settings, 'FRONTEND_URL', '') or '')
    from apps.accounts.tenancy import host_allowed
    if host != (front.hostname or '') and not host_allowed(parts.netloc):
        return ''
    if not settings.DEBUG and parts.scheme != 'https' and host not in ('localhost', '127.0.0.1'):
        return ''
    query = [(k, v) for k, v in parse_qsl(parts.query) if k not in ('payment', 'status')]
    return urlunparse((parts.scheme, parts.netloc, parts.path, '', urlencode(query), ''))


def frontend_redirect(intent):
    base = intent.return_url or (getattr(settings, 'FRONTEND_URL', '').rstrip('/') + '/')
    parts = urlparse(base)
    query = [(k, v) for k, v in parse_qsl(parts.query) if k not in ('payment', 'status')]
    query += [('payment', str(intent.id)), ('status', intent.status)]
    return urlunparse((parts.scheme, parts.netloc, parts.path, '', urlencode(query), ''))


def public_intent(intent):
    """What the payer (anyone holding the intent id) sees."""
    purpose = get_purpose(intent.purpose)
    data = {
        'id': str(intent.id),
        'purpose': intent.purpose,
        'reference': intent.reference,
        'description': intent.description,
        'status': intent.status,
        'amount': str(intent.amount),
        'currency': intent.currency,
        'provider': intent.provider or None,
        'provider_name': intent.get_provider_display() if intent.provider else None,
        'provider_txn_id': intent.provider_txn_id or None,
        'created_at': intent.created_at,
        'expires_at': intent.expires_at,
        'paid_at': intent.paid_at,
        'fulfilled': bool(intent.fulfilled_at),
        'failure_reason': intent.failure_reason or None,
        'result': None,
    }
    if purpose and purpose.describe:
        try:
            data['result'] = purpose.describe(intent)
        except Exception:  # noqa: BLE001
            logger.exception('describe failed for payment %s', intent.id)
    return data
