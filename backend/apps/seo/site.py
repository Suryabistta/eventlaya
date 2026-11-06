"""Site-wide facts used in meta tags, structured data, robots.txt and llms.txt."""
import os
from pathlib import Path

from django.conf import settings

from apps.accounts.tenancy import platform_domain

SITE_NAME = 'Eventlaya'
ALTERNATE_NAMES = ['इभेन्टलय']
CONTACT_EMAIL = 'support@eventlaya.com'
TAGLINE = 'Event registration, QR passes and gate check-in for Eastern Nepal'
REGION = 'Koshi Province'
COUNTRY_CODE = 'NP'
# Where we work: Koshi Province (Eastern Nepal). Used for areaServed and city detection in addresses.
KOSHI_CITIES = [
    'Biratnagar', 'Itahari', 'Dharan', 'Inaruwa', 'Damak', 'Birtamod', 'Mechinagar', 'Kakarbhitta', 'Bhadrapur',
    'Ilam', 'Dhankuta', 'Urlabari', 'Pathari', 'Belbari', 'Rangeli', 'Gaighat', 'Duhabi', 'Jhumka', 'Triyuga',
]
# TODO(owner): add the official social profile URLs once they exist (Facebook page, Instagram, TikTok, YouTube,
# LinkedIn). They are published as Organization.sameAs; see docs/seo.md.
SAME_AS: list[str] = []

DEFAULT_IMAGE_PATH = '/og-default.png'
DEFAULT_IMAGE_SIZE = (1200, 630)
LOGO_PATH = '/icon-512.png'


def site_url():
    """https://eventlaya.com (no trailing slash). Canonical URLs always use this, also in development."""
    return (getattr(settings, 'SEO_SITE_URL', '') or f'https://{platform_domain()}').rstrip('/')


def frontend_dist_dir():
    """The built web app (index.html, assets, prerender/). Production: /srv/eventlaya/frontend."""
    configured = getattr(settings, 'FRONTEND_DIST_DIR', '') or os.environ.get('FRONTEND_DIST_DIR', '')
    if configured:
        return Path(configured)
    prod = Path('/srv/eventlaya/frontend')
    if prod.is_dir():
        return prod
    return Path(settings.BASE_DIR).parent / 'frontend' / 'dist'


def city_in(text):
    """The Koshi Province city named in a free-text location, or None."""
    low = (text or '').lower()
    for city in KOSHI_CITIES:
        if city.lower() in low:
            return city
    return None
