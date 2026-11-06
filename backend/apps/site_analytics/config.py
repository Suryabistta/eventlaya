"""What the website should load: the effective analytics settings, input clean-up and the public config.

Effective settings (docs/analytics.md):
  • no row saved yet  → GA_MEASUREMENT_ID from the environment, switched on, public pages only;
  • a row saved       → its switch and options; an empty Measurement ID still falls back to the environment.
White-label tenant hosts never get any of it: those are the client's sites (public_config() and the verification
tags in apps/seo check the host).
"""
import re
from dataclasses import asdict, dataclass

from django.conf import settings
from django.core.cache import cache

CACHE_KEY = 'site-analytics:v1'
CACHE_SECONDS = 60

MEASUREMENT_ID_RE = re.compile(r'^G-[A-Z0-9]{6,12}$')
# Values end up inside HTML attributes / a JSON attribute, so only these characters are accepted.
GOOGLE_VERIFICATION_RE = re.compile(r'^[A-Za-z0-9_-]{20,100}$')
BING_VERIFICATION_RE = re.compile(r'^[A-Za-z0-9]{16,64}$')
CLOUDFLARE_TOKEN_RE = re.compile(r'^[A-Za-z0-9]{16,64}$')

FIELDS = ['enabled', 'measurement_id', 'track_app_pages', 'google_site_verification', 'bing_site_verification',
          'cloudflare_token']


# ---------------------------------------------------------------------------
# Input clean-up: the superadmin may paste the whole snippet Google / Bing / Cloudflare show.
# Each returns the cleaned value ('' for empty) or raises ValueError with a message for the form.
# ---------------------------------------------------------------------------

def clean_measurement_id(value):
    text = (value or '').strip()
    if not text:
        return ''
    upper = text.upper()
    if MEASUREMENT_ID_RE.match(upper):
        return upper
    # A pasted gtag snippet: exactly one G- ID inside it
    found = set(re.findall(r'\bG-[A-Z0-9]{6,12}\b', upper)) if len(text) > 14 else set()
    if len(found) == 1:
        return found.pop()
    raise ValueError('Enter the GA4 Measurement ID, e.g. G-ABC123XYZ9 (Admin → Data streams → your web stream).')


def _meta_content(text, name):
    m = re.search(rf'name\s*=\s*["\']{re.escape(name)}["\'][^>]*content\s*=\s*["\']([^"\']*)["\']', text, re.I) or \
        re.search(rf'content\s*=\s*["\']([^"\']*)["\'][^>]*name\s*=\s*["\']{re.escape(name)}["\']', text, re.I)
    return m.group(1).strip() if m else None


def clean_google_verification(value):
    text = (value or '').strip()
    if not text:
        return ''
    text = _meta_content(text, 'google-site-verification') or text
    if text.lower().startswith('google-site-verification='):  # the DNS TXT form
        text = text.split('=', 1)[1].strip()
    if not GOOGLE_VERIFICATION_RE.match(text):
        raise ValueError('Paste the content of Google’s meta tag (letters, digits, - and _ only), or the whole tag.')
    return text


def clean_bing_verification(value):
    text = (value or '').strip()
    if not text:
        return ''
    text = _meta_content(text, 'msvalidate.01') or text
    if not BING_VERIFICATION_RE.match(text):
        raise ValueError('Paste the content of Bing’s msvalidate.01 meta tag (letters and digits), or the whole tag.')
    return text


def clean_cloudflare_token(value):
    text = (value or '').strip()
    if not text:
        return ''
    m = re.search(r'["\']?token["\']?\s*:\s*["\']([^"\']+)["\']', text)
    if m:
        text = m.group(1).strip()
    if not CLOUDFLARE_TOKEN_RE.match(text):
        raise ValueError('Paste the Cloudflare Web Analytics token (letters and digits), or the whole JS snippet.')
    return text


# ---------------------------------------------------------------------------
# Effective settings
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Effective:
    # Analytics scripts may load at all (master switch)
    enabled: bool
    # GA4 ID in use ('' → GA does not load) and where it comes from: 'settings' | 'environment' | ''
    measurement_id: str
    measurement_id_source: str
    track_app_pages: bool
    google_site_verification: str
    bing_site_verification: str
    cloudflare_token: str
    # A row exists (False → environment defaults)
    saved: bool

    @property
    def ga_active(self):
        return self.enabled and bool(self.measurement_id)

    def as_dict(self):
        return {**asdict(self), 'ga_active': self.ga_active}


def env_measurement_id():
    """GA_MEASUREMENT_ID from the environment, if it is a valid ID."""
    try:
        return clean_measurement_id(getattr(settings, 'GA_MEASUREMENT_ID', '') or '')
    except ValueError:
        return ''


def stored():
    from .models import AnalyticsSettings
    return AnalyticsSettings.objects.filter(pk=1).select_related('updated_by').first()


def compute(row=None):
    env_id = env_measurement_id()
    if row is None:
        return Effective(enabled=bool(env_id), measurement_id=env_id, measurement_id_source='environment' if env_id else '',
                         track_app_pages=False, google_site_verification='', bing_site_verification='',
                         cloudflare_token='', saved=False)
    own_id = row.measurement_id if MEASUREMENT_ID_RE.match(row.measurement_id or '') else ''
    measurement_id = own_id or env_id
    return Effective(
        enabled=row.enabled, measurement_id=measurement_id,
        measurement_id_source='settings' if own_id else ('environment' if env_id else ''),
        track_app_pages=row.track_app_pages,
        google_site_verification=row.google_site_verification if GOOGLE_VERIFICATION_RE.match(row.google_site_verification or '') else '',
        bing_site_verification=row.bing_site_verification if BING_VERIFICATION_RE.match(row.bing_site_verification or '') else '',
        cloudflare_token=row.cloudflare_token if CLOUDFLARE_TOKEN_RE.match(row.cloudflare_token or '') else '',
        saved=True,
    )


def effective():
    """The settings in force, cached briefly (cleared on save)."""
    value = cache.get(CACHE_KEY)
    if value is None:
        try:
            value = compute(stored())
        except Exception:  # table missing (migrations not run yet): behave as if nothing were saved
            value = compute(None)
        cache.set(CACHE_KEY, value, CACHE_SECONDS)
    return value


def clear_cache():
    cache.delete(CACHE_KEY)


def is_platform_request(request):
    """eventlaya.com (not a white-label tenant, not an unclaimed host)."""
    from apps.accounts.tenancy import is_platform_host, request_host, tenant_for_request
    if tenant_for_request(request) is not None:
        return False
    return is_platform_host(request_host(request))


DISABLED = {'enabled': False, 'measurement_id': '', 'track_app_pages': False, 'cloudflare_token': ''}


def public_config(request):
    """Only what the browser needs to load the scripts. Never on white-label sites."""
    if not is_platform_request(request):
        return dict(DISABLED)
    eff = effective()
    if not eff.enabled or not (eff.measurement_id or eff.cloudflare_token):
        return dict(DISABLED)
    return {'enabled': True, 'measurement_id': eff.measurement_id, 'track_app_pages': eff.track_app_pages,
            'cloudflare_token': eff.cloudflare_token}


def verification_tags(request):
    """<meta> tags for Search Console and Bing Webmaster Tools (eventlaya.com only). Values are validated
    against strict patterns on save and again here, so they are safe inside the attribute."""
    if not is_platform_request(request):
        return []
    eff = effective()
    tags = []
    if eff.google_site_verification:
        tags.append(f'<meta name="google-site-verification" content="{eff.google_site_verification}">')
    if eff.bing_site_verification:
        tags.append(f'<meta name="msvalidate.01" content="{eff.bing_site_verification}">')
    return tags
