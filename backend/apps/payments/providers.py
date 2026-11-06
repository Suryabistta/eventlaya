"""Payment providers: Khalti ePayment API v2, eSewa ePay v2 and a local test provider.

Each provider starts a checkout and looks a payment up on the server side. Results are normalised to
LookupResult.state: paid / pending / failed / cancelled / expired / refunded / unknown.

Khalti: https://docs.khalti.com/khalti-epayment/ (initiate → redirect to payment_url → return_url with
pidx → lookup). eSewa: https://developer.esewa.com.np/pages/Epay (signed form POST → success_url?data=
<base64 signed JSON> / failure_url → transaction status API).
"""
import base64
import binascii
import hashlib
import hmac
import json
import logging
import secrets
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

import requests
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

HTTP_TIMEOUT = 15


class ProviderError(Exception):
    """The provider refused the request or couldn't be reached. `message` is safe to show the payer."""

    def __init__(self, message, data=None):
        super().__init__(message)
        self.message = message
        self.data = data or {}


@dataclass
class LookupResult:
    state: str  # paid / pending / failed / cancelled / expired / refunded / unknown
    provider_status: str = ''
    txn_id: str = ''
    amount: Decimal | None = None
    fee: Decimal | None = None
    raw: dict = field(default_factory=dict)


def _decimal(value):
    if value in (None, ''):
        return None
    try:
        return Decimal(str(value).replace(',', '').strip())
    except (InvalidOperation, ValueError):
        return None


def _json(resp):
    try:
        data = resp.json()
    except ValueError:
        return {'_text': (resp.text or '')[:500]}
    return data if isinstance(data, dict) else {'_data': data}


class BaseProvider:
    id = ''
    name = ''

    def configured(self):
        return False

    def sandbox(self):
        return False

    def start(self, intent, urls):
        """Begin a checkout. urls: {'return': ..., 'success': ..., 'failure': ..., 'website': ...}.
        Returns (provider_ref, checkout, raw) where checkout is {'redirect_url'} or {'form_action', 'fields'}."""
        raise NotImplementedError

    def lookup(self, intent):
        raise NotImplementedError

    def public(self):
        return {'id': self.id, 'name': self.name, 'sandbox': self.sandbox()}


# ---------------------------------------------------------------------------
# Khalti
# ---------------------------------------------------------------------------

KHALTI_STATES = {
    'Completed': 'paid',
    'Pending': 'pending',
    'Initiated': 'pending',
    'Refunded': 'refunded',
    'Partially Refunded': 'refunded',
    'Expired': 'expired',
    'User canceled': 'cancelled',
}


class Khalti(BaseProvider):
    id = 'khalti'
    name = 'Khalti'
    MIN_AMOUNT = Decimal('10')  # Khalti refuses less than Rs 10 (1000 paisa)

    @property
    def base(self):
        return (settings.KHALTI_BASE_URL or '').rstrip('/') + '/'

    def configured(self):
        return bool(settings.KHALTI_SECRET_KEY and settings.KHALTI_BASE_URL)

    def sandbox(self):
        return 'dev.khalti.com' in self.base

    def _headers(self):
        return {'Authorization': f'Key {settings.KHALTI_SECRET_KEY}', 'Content-Type': 'application/json'}

    @staticmethod
    def paisa(amount):
        return int((Decimal(amount) * 100).quantize(Decimal('1')))

    def start(self, intent, urls):
        body = {
            'return_url': urls['return'],
            'website_url': urls['website'],
            'amount': self.paisa(intent.amount),
            'purchase_order_id': str(intent.id),
            'purchase_order_name': (intent.description or intent.purpose)[:100],
            'merchant_purpose': intent.purpose,
        }
        customer = {k: v for k, v in {
            'name': intent.payer_name[:100], 'email': intent.payer_email,
            'phone': ''.join(c for c in intent.payer_phone if c.isdigit())[-10:],
        }.items() if v}
        if customer.get('phone') and len(customer['phone']) != 10:
            customer.pop('phone')
        if customer:
            body['customer_info'] = customer
        try:
            resp = requests.post(self.base + 'epayment/initiate/', json=body, headers=self._headers(), timeout=HTTP_TIMEOUT)
        except requests.RequestException as e:
            raise ProviderError("Couldn't reach Khalti. Try again in a moment.", {'error': str(e)[:200]})
        data = _json(resp)
        if resp.status_code != 200 or not data.get('pidx') or not data.get('payment_url'):
            logger.warning('Khalti initiate failed (%s): %s', resp.status_code, data)
            raise ProviderError(self._error_text(data), {'http_status': resp.status_code, 'response': data})
        return data['pidx'], {'redirect_url': data['payment_url'], 'expires_at': data.get('expires_at')}, data

    @staticmethod
    def _error_text(data):
        for key, value in data.items():
            if key in ('error_key', 'status_code'):
                continue
            if isinstance(value, list) and value:
                return f'Khalti: {value[0]}'
            if isinstance(value, str) and value:
                return f'Khalti: {value}'
        return 'Khalti could not start the payment. Try again or choose another option.'

    def lookup(self, intent):
        if not intent.provider_ref:
            return LookupResult('unknown')
        try:
            resp = requests.post(self.base + 'epayment/lookup/', json={'pidx': intent.provider_ref},
                                 headers=self._headers(), timeout=HTTP_TIMEOUT)
        except requests.RequestException as e:
            raise ProviderError("Couldn't reach Khalti to check the payment.", {'error': str(e)[:200]})
        data = _json(resp)
        status = data.get('status') or ''
        if resp.status_code == 404 or (not status and data.get('detail') == 'Not found.'):
            return LookupResult('unknown', 'Not found', raw=data)
        if not status:
            raise ProviderError('Khalti returned an unexpected answer.', {'http_status': resp.status_code, 'response': data})
        if data.get('pidx') and data['pidx'] != intent.provider_ref:
            return LookupResult('unknown', 'pidx mismatch', raw=data)
        total = _decimal(data.get('total_amount'))
        return LookupResult(
            KHALTI_STATES.get(status, 'pending'), status, data.get('transaction_id') or '',
            (total / 100) if total is not None else None,
            (_decimal(data.get('fee')) / 100) if _decimal(data.get('fee')) is not None else None,
            data,
        )


# ---------------------------------------------------------------------------
# eSewa
# ---------------------------------------------------------------------------

ESEWA_STATES = {
    'COMPLETE': 'paid',
    'PENDING': 'pending',
    'AMBIGUOUS': 'pending',
    'NOT_FOUND': 'unknown',  # not started yet, or the eSewa session expired
    'CANCELED': 'cancelled',
    'FULL_REFUND': 'refunded',
    'PARTIAL_REFUND': 'refunded',
}
ESEWA_SIGNED_FIELDS = 'total_amount,transaction_uuid,product_code'


def esewa_amount(amount):
    """eSewa amounts as sent in the form and the status query: '500' or '500.50'."""
    d = Decimal(amount).quantize(Decimal('0.01'))
    return str(int(d)) if d == d.to_integral_value() else f'{d:.2f}'


def esewa_signature(message, secret=None):
    secret = settings.ESEWA_SECRET_KEY if secret is None else secret
    digest = hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


def esewa_signed_message(data, field_names):
    return ','.join(f'{name}={data.get(name, "")}' for name in field_names.split(','))


def decode_esewa_response(encoded):
    """Decode and verify the base64 JSON eSewa appends to the success URL (?data=...).
    Returns (data, signature_ok)."""
    try:
        raw = base64.b64decode((encoded or '').strip() + '=' * (-len((encoded or '').strip()) % 4))
        data = json.loads(raw)
    except (binascii.Error, ValueError, TypeError):
        return {}, False
    if not isinstance(data, dict):
        return {}, False
    names = data.get('signed_field_names') or ''
    signature = data.get('signature') or ''
    if not names or not signature:
        return data, False
    expected = esewa_signature(esewa_signed_message(data, names))
    return data, hmac.compare_digest(expected, signature)


class Esewa(BaseProvider):
    id = 'esewa'
    name = 'eSewa'

    def configured(self):
        return bool(settings.ESEWA_PRODUCT_CODE and settings.ESEWA_SECRET_KEY and settings.ESEWA_FORM_URL and settings.ESEWA_STATUS_URL)

    def sandbox(self):
        return settings.ESEWA_PRODUCT_CODE == 'EPAYTEST' or 'rc-epay' in settings.ESEWA_FORM_URL

    @staticmethod
    def new_transaction_uuid():
        # eSewa allows letters, digits and hyphens only
        return f'{timezone.localtime():%y%m%d-%H%M%S}-{secrets.token_hex(4)}'

    def start(self, intent, urls):
        uuid_ = intent.provider_ref if intent.provider == self.id and intent.provider_ref else self.new_transaction_uuid()
        total = esewa_amount(intent.amount)
        fields = {
            'amount': total,
            'tax_amount': '0',
            'total_amount': total,
            'transaction_uuid': uuid_,
            'product_code': settings.ESEWA_PRODUCT_CODE,
            'product_service_charge': '0',
            'product_delivery_charge': '0',
            'success_url': urls['success'],
            'failure_url': urls['failure'],
            'signed_field_names': ESEWA_SIGNED_FIELDS,
        }
        fields['signature'] = esewa_signature(esewa_signed_message(fields, ESEWA_SIGNED_FIELDS))
        return uuid_, {'form_action': settings.ESEWA_FORM_URL, 'method': 'POST', 'fields': fields}, {'transaction_uuid': uuid_}

    def lookup(self, intent):
        if not intent.provider_ref:
            return LookupResult('unknown')
        params = {
            'product_code': settings.ESEWA_PRODUCT_CODE,
            'total_amount': esewa_amount(intent.amount),
            'transaction_uuid': intent.provider_ref,
        }
        try:
            resp = requests.get(settings.ESEWA_STATUS_URL, params=params, timeout=HTTP_TIMEOUT)
        except requests.RequestException as e:
            raise ProviderError("Couldn't reach eSewa to check the payment.", {'error': str(e)[:200]})
        data = _json(resp)
        status = data.get('status') or ''
        if not status:
            raise ProviderError(data.get('error_message') or 'eSewa returned an unexpected answer.',
                                {'http_status': resp.status_code, 'response': data})
        if data.get('transaction_uuid') and data['transaction_uuid'] != intent.provider_ref:
            return LookupResult('unknown', 'transaction_uuid mismatch', raw=data)
        if data.get('product_code') and data['product_code'] != settings.ESEWA_PRODUCT_CODE:
            return LookupResult('unknown', 'product_code mismatch', raw=data)
        return LookupResult(ESEWA_STATES.get(status, 'pending'), status, data.get('ref_id') or '',
                            _decimal(data.get('total_amount')), None, data)


# ---------------------------------------------------------------------------
# Test provider (DEBUG / PAYMENTS_TEST_PROVIDER=1 only): a local page with Pay / Fail / Cancel buttons
# ---------------------------------------------------------------------------

class TestProvider(BaseProvider):
    id = 'test'
    name = 'Test payment'

    def configured(self):
        return bool(getattr(settings, 'PAYMENTS_TEST_PROVIDER', False))

    def sandbox(self):
        return True

    def start(self, intent, urls):
        ref = intent.provider_ref if intent.provider == self.id and intent.provider_ref else f'TEST-{secrets.token_hex(6).upper()}'
        return ref, {'redirect_url': urls['test_page']}, {'ref': ref}

    def lookup(self, intent):
        outcome = (intent.metadata or {}).get('_test_outcome')
        state = {'paid': 'paid', 'failed': 'failed', 'cancelled': 'cancelled'}.get(outcome, 'pending')
        amount = _decimal((intent.metadata or {}).get('_test_amount')) or intent.amount
        return LookupResult(state, outcome or 'pending', f'{intent.provider_ref}-TXN' if state == 'paid' else '', amount,
                            Decimal('0'), {'outcome': outcome})


PROVIDERS = {p.id: p for p in (Khalti(), Esewa(), TestProvider())}


def get_provider(provider_id):
    return PROVIDERS.get(provider_id)


def enabled_ids():
    raw = getattr(settings, 'PAYMENTS_ENABLED_PROVIDERS', ['khalti', 'esewa'])
    ids = [p for p in raw if p in PROVIDERS and p != 'test']
    if getattr(settings, 'PAYMENTS_TEST_PROVIDER', False):
        ids.append('test')
    return ids


def available_providers():
    """Providers that are switched on and have their keys (production refuses one without keys)."""
    return [PROVIDERS[i] for i in enabled_ids() if PROVIDERS[i].configured()]


def provider_status():
    """For the superadmin: every provider and why it is (not) available."""
    on = enabled_ids()
    out = []
    for p in PROVIDERS.values():
        if p.id == 'test' and p.id not in on:
            continue
        out.append({
            'id': p.id, 'name': p.name, 'enabled': p.id in on, 'configured': p.configured(),
            'available': p.id in on and p.configured(), 'sandbox': p.sandbox(),
        })
    return out
