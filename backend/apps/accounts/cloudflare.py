"""Cloudflare for SaaS (custom hostnames) — certificates for customer domains.

Optional: active only when CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are set (token needs the
"SSL and Certificates: Edit" permission on the eventlaya.com zone). Without them the platform runs in
"manual" mode and the superadmin adds custom hostnames in the Cloudflare dashboard (see docs/white-label.md).

API: https://developers.cloudflare.com/api/resources/custom_hostnames/
"""
import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

API = 'https://api.cloudflare.com/client/v4'
TIMEOUT = 15
DUPLICATE_CODES = {1406, 1407, 1414}  # "Duplicate custom hostname found" and friends


class CloudflareError(Exception):
    def __init__(self, message, status=None, codes=()):
        super().__init__(message)
        self.status = status
        self.codes = set(codes)


def enabled():
    return bool(getattr(settings, 'CLOUDFLARE_API_TOKEN', '') and getattr(settings, 'CLOUDFLARE_ZONE_ID', ''))


def mode():
    return 'cloudflare' if enabled() else 'manual'


def _url(path=''):
    return f"{API}/zones/{settings.CLOUDFLARE_ZONE_ID}/custom_hostnames{path}"


def _call(method, path='', **kwargs):
    headers = {'Authorization': f'Bearer {settings.CLOUDFLARE_API_TOKEN}', 'Content-Type': 'application/json'}
    try:
        res = requests.request(method, _url(path), headers=headers, timeout=TIMEOUT, **kwargs)
    except requests.RequestException as e:
        raise CloudflareError(f'Couldn’t reach Cloudflare: {e.__class__.__name__}') from e
    try:
        body = res.json()
    except ValueError:
        body = {}
    if res.status_code >= 400 or not body.get('success', False):
        errors = body.get('errors') or []
        message = '; '.join(str(e.get('message', '')) for e in errors if isinstance(e, dict)) or f'HTTP {res.status_code}'
        raise CloudflareError(message, res.status_code, [e.get('code') for e in errors if isinstance(e, dict)])
    return body


def _ssl_config():
    # HTTP DCV: Cloudflare validates the certificate itself once the customer's CNAME points at us.
    return {'method': 'http', 'type': 'dv', 'settings': {'min_tls_version': '1.2'}}


def summarize(result):
    """The parts of a custom-hostname object we store."""
    ssl = result.get('ssl') or {}
    errors = list(result.get('verification_errors') or []) + [
        e.get('message', '') if isinstance(e, dict) else str(e) for e in (ssl.get('validation_errors') or [])
    ]
    return {
        'id': result.get('id', ''),
        'status': result.get('status', ''),
        'ssl_status': ssl.get('status', ''),
        'errors': [e for e in errors if e],
    }


def find(hostname):
    body = _call('GET', params={'hostname.exact': hostname, 'per_page': 50})
    for item in body.get('result') or []:
        if (item.get('hostname') or '').lower() == hostname.lower():
            return summarize(item)
    return None


def create(hostname):
    """Create (or adopt an existing) custom hostname. Returns summarize(...)."""
    try:
        payload = {'hostname': hostname, 'ssl': _ssl_config()}
        origin = getattr(settings, 'CLOUDFLARE_CUSTOM_ORIGIN', '')
        if origin:
            # Cloudflare then connects to this origin with SNI = origin (covered by our Origin CA wildcard
            # certificate, so SSL "Full (strict)" works) while the Host header stays the customer's domain.
            payload['custom_origin_server'] = origin
        body = _call('POST', json=payload)
        return summarize(body.get('result') or {})
    except CloudflareError as e:
        if e.codes & DUPLICATE_CODES or e.status == 409:
            existing = find(hostname)
            if existing:
                return existing
        raise


def get(hostname_id):
    return summarize(_call('GET', f'/{hostname_id}').get('result') or {})


def revalidate(hostname_id):
    """PATCH with the same SSL settings: asks Cloudflare to retry HTTP validation now that DNS is in place."""
    return summarize(_call('PATCH', f'/{hostname_id}', json={'ssl': _ssl_config()}).get('result') or {})


def delete(hostname_id):
    try:
        _call('DELETE', f'/{hostname_id}')
    except CloudflareError as e:
        if e.status == 404:
            return
        raise
