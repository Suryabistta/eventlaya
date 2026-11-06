"""White-label tenants: which organization's site a request is for.

A tenant is an organizer with an approved (not revoked) white-label whose site is served on either
  • their own domain (TenantBranding.custom_domain) once DNS verification passed, or
  • the free address <subdomain>.<PLATFORM_DOMAIN> (e.g. dff.eventlaya.com).

The host comes from the `X-Tenant-Host` header (sent by the web app when it runs in tenant mode, and the
dev override `?tenant=`), else the request's Host. Scoping only ever *narrows* public data to one
organizer, so a client choosing its own header can't see anything it couldn't see on eventlaya.com.

TenantMiddleware also does Django's Host validation for us: ALLOWED_HOSTS is '*' at the Django level so
customer domains work without a redeploy, and this middleware rejects any Host that is not a platform host
(PLATFORM_HOSTS, the old ALLOWED_HOSTS env), a <x>.<PLATFORM_DOMAIN> subdomain or a domain some
organization has claimed.
"""
import re

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponseBadRequest
from django.http.request import split_domain_port, validate_host

CACHE_SECONDS = 30
_CACHE_PREFIX = 'tenant-host:v1:'
_CLAIMED_KEY = 'tenant-claimed-domains:v1'
_GEN_KEY = 'tenant-host-generation:v1'

# Subdomains that belong to the platform itself (or could be confused with it).
RESERVED_SUBDOMAINS = frozenset({
    'www', 'api', 'app', 'apps', 'admin', 'administrator', 'superadmin', 'mail', 'email', 'smtp', 'imap', 'pop',
    'mx', 'ns', 'ns1', 'ns2', 'dns', 'tenants', 'tenant', 'cname', 'proxy', 'fallback', 'origin', 'cdn', 'static',
    'media', 'assets', 'img', 'images', 'files', 'ws', 'wss', 'socket', 'dashboard', 'console', 'account',
    'accounts', 'login', 'signin', 'signup', 'register', 'auth', 'oauth', 'sso', 'id', 'help', 'support', 'docs',
    'status', 'blog', 'news', 'dev', 'staging', 'stage', 'test', 'qa', 'beta', 'demo', 'preview', 'sandbox',
    'localhost', 'eventlaya', 'billing', 'pay', 'payment', 'payments', 'checkout', 'secure', 'security', 'ftp',
    'vpn', 'git', 'internal', 'marketplace', 'events', 'tickets', 'ticket', 'pass', 'passes', 'scanner', 'gate',
    'm', 'mobile', 'web', 'site', 'about', 'legal', 'privacy', 'terms', 'root', 'system', 'platform',
})
SUBDOMAIN_RE = re.compile(r'^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$')
DOMAIN_RE = re.compile(r'^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$')


# ---------------------------------------------------------------------------
# Settings helpers
# ---------------------------------------------------------------------------

def platform_domain():
    return getattr(settings, 'PLATFORM_DOMAIN', 'eventlaya.com').lower()


def cname_target():
    return getattr(settings, 'WHITELABEL_CNAME_TARGET', 'tenants.eventlaya.com').lower().rstrip('.')


def subdomains_enabled():
    """Whether <sub>.<PLATFORM_DOMAIN> is set up (wildcard DNS + origin cert), so we may link to it."""
    return bool(getattr(settings, 'WHITELABEL_SUBDOMAINS_ENABLED', True))


def normalize_host(host):
    """'Event.Example.org:443.' → 'event.example.org' ('' for junk)."""
    host = (host or '').strip().lower()
    if not host:
        return ''
    domain, _port = split_domain_port(host)
    return (domain or '').rstrip('.')


def is_platform_host(host):
    """eventlaya.com itself, its fixed hosts (www, api, tenants...) and local development hosts."""
    host = normalize_host(host)
    if not host:
        return True
    pd = platform_domain()
    if host == pd or host in ('localhost', '127.0.0.1', '[::1]', '::1', 'testserver'):
        return True
    if host.endswith('.' + pd) and host[: -len(pd) - 1] in RESERVED_SUBDOMAINS:
        return True
    if host == cname_target():
        return True
    explicit = [h for h in getattr(settings, 'PLATFORM_HOSTS', []) if h != '*']
    return bool(explicit) and validate_host(host, explicit) and not _is_platform_subdomain(host)


def _is_platform_subdomain(host):
    pd = platform_domain()
    if not host.endswith('.' + pd):
        return False
    label = host[: -len(pd) - 1]
    return '.' not in label and label not in RESERVED_SUBDOMAINS


def subdomain_of(host):
    """'dff' for 'dff.eventlaya.com' (one label, not reserved), else None."""
    host = normalize_host(host)
    return host[: -len(platform_domain()) - 1] if _is_platform_subdomain(host) else None


# ---------------------------------------------------------------------------
# Validation (used by serializers and the approval flow)
# ---------------------------------------------------------------------------

def subdomain_error(value, organizer=None):
    """Human error for an Eventlaya address, or None when it's fine."""
    from .models import TenantBranding
    if not value:
        return 'Choose an address, like dharan-film-festival.'
    if len(value) < 3:
        return 'Use at least 3 characters.'
    if len(value) > 63:
        return 'Use 63 characters or fewer.'
    if not SUBDOMAIN_RE.match(value) or '--' in value:
        return 'Use lowercase letters, numbers and single hyphens (not at the start or end).'
    if value in RESERVED_SUBDOMAINS:
        return f'“{value}” is reserved by Eventlaya. Try your organization’s name.'
    qs = TenantBranding.objects.filter(subdomain__iexact=value)
    if organizer is not None:
        qs = qs.exclude(organizer=organizer)
    if qs.exists():
        return 'That address is taken. Try another one.'
    return None


def custom_domain_error(value, organizer=None):
    from .models import TenantBranding
    if not value:
        return None
    if value.startswith(('http://', 'https://')) or '/' in value:
        return 'Enter just the domain, like event.yourfestival.org'
    if not DOMAIN_RE.match(value):
        return 'That doesn’t look like a domain. Use something like event.yourfestival.org'
    pd = platform_domain()
    if value == pd or value.endswith('.' + pd) or value == cname_target():
        return 'Eventlaya addresses can’t be used as a custom domain.'
    qs = TenantBranding.objects.filter(custom_domain__iexact=value)
    if organizer is not None:
        qs = qs.exclude(organizer=organizer)
    if qs.exists():
        return 'This domain is already connected to another organization.'
    return None


def unique_subdomain(organizer, base=None):
    from django.utils.text import slugify
    from .models import TenantBranding
    base = slugify(base or organizer.organization_name or organizer.username or organizer.email.split('@')[0])
    base = re.sub(r'-{2,}', '-', base).strip('-')[:50] or 'org'
    if len(base) < 3:
        base = f'{base}-events'
    if base in RESERVED_SUBDOMAINS:
        base = f'{base}-org'
    candidate, n = base, 2
    while TenantBranding.objects.filter(subdomain__iexact=candidate).exclude(organizer=organizer).exists():
        candidate, n = f'{base}-{n}', n + 1
    return candidate


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------

def white_label_active(branding):
    """Approved, not revoked, organizer account active, and the white_label module on for organizers."""
    from apps.platform.models import WhiteLabelRequest
    from .modules import module_enabled
    org = branding.organizer
    if not org.is_active:
        return False
    if not module_enabled('white_label', org):
        return False
    return WhiteLabelRequest.objects.filter(organizer=org, status=WhiteLabelRequest.Status.APPROVED).exists()


def lookup(host):
    """(branding_or_None, state) for a host. state: 'platform' | 'live' | 'not_set_up' | 'unavailable'.

    'not_set_up'  — nobody claimed it, or the domain hasn't passed DNS verification yet
    'unavailable' — it belongs to an organization, but white-label is revoked / switched off
    """
    from .models import TenantBranding
    host = normalize_host(host)
    if is_platform_host(host):
        return None, 'platform'
    sub = subdomain_of(host)
    if sub is not None:
        if not subdomains_enabled():  # free <name>.eventlaya.com addresses are switched off: not a site
            return None, 'not_set_up'
        branding = TenantBranding.objects.select_related('organizer').filter(subdomain__iexact=sub).first()
        if branding is None:
            return None, 'not_set_up'
    else:
        branding = TenantBranding.objects.select_related('organizer').filter(custom_domain__iexact=host).first()
        if branding is None:
            return None, 'not_set_up'
    if not white_label_active(branding):
        return branding, 'unavailable'
    if sub is None and not branding.is_domain_verified:
        return branding, 'not_set_up'
    return branding, 'live'


def resolve_tenant(host):
    """The live TenantBranding for a host, or None. Cached briefly (per process)."""
    from .models import TenantBranding
    host = normalize_host(host)
    if not host or is_platform_host(host):
        return None
    key = f'{_CACHE_PREFIX}{_generation()}:{host}'
    cached = cache.get(key)
    if cached is None:
        branding, state = lookup(host)
        cached = str(branding.pk) if (branding is not None and state == 'live') else ''
        cache.set(key, cached, CACHE_SECONDS)
    if not cached:
        return None
    return TenantBranding.objects.select_related('organizer').filter(pk=cached).first()


def _generation():
    gen = cache.get(_GEN_KEY)
    if gen is None:
        gen = 1
        cache.set(_GEN_KEY, gen, None)
    return gen


def clear_cache():
    """Forget every cached host lookup in this process (others catch up within CACHE_SECONDS)."""
    try:
        cache.incr(_GEN_KEY)
    except ValueError:
        cache.set(_GEN_KEY, 2, None)
    cache.delete(_CLAIMED_KEY)


def request_host(request):
    """The host the visitor is on: X-Tenant-Host (web app in tenant mode / dev override) or Host."""
    header = request.META.get('HTTP_X_TENANT_HOST', '')
    if header:
        return normalize_host(header)
    return normalize_host(request.META.get('HTTP_HOST', '') or request.META.get('SERVER_NAME', ''))


_UNSET = object()


def tenant_for_request(request):
    """The request's live tenant (TenantBranding) or None; resolved once per request."""
    django_request = getattr(request, '_request', request)
    tenant = getattr(django_request, '_eventlaya_tenant', _UNSET)
    if tenant is _UNSET:
        tenant = resolve_tenant(request_host(django_request))
        try:
            django_request._eventlaya_tenant = tenant
        except AttributeError:
            pass
    return tenant


def scope_events(queryset, request, field='organizer'):
    """Narrow an Event queryset (or anything with an organizer path) to the request's tenant."""
    tenant = tenant_for_request(request)
    if tenant is None:
        return queryset
    return queryset.filter(**{f'{field}_id': tenant.organizer_id})


def live_branding_for_organizer(organizer):
    """The organizer's live white-label (for email links), or None."""
    branding = getattr(organizer, 'tenant_branding', None) if organizer is not None else None
    if branding is None:
        from .models import TenantBranding
        branding = TenantBranding.objects.filter(organizer=organizer).first() if organizer is not None else None
    if branding is None or not white_label_active(branding):
        return None
    return branding


def public_host(branding):
    """Where the organizer's site lives right now: verified + SSL custom domain, else the free subdomain."""
    if branding.custom_domain and branding.is_domain_verified and branding.ssl_active:
        return branding.custom_domain
    if subdomains_enabled() and branding.subdomain:
        return f'{branding.subdomain}.{platform_domain()}'
    return None


def site_url_for_organizer(organizer):
    """Base URL for links about this organizer's events ('' → use FRONTEND_URL)."""
    branding = live_branding_for_organizer(organizer)
    host = public_host(branding) if branding else None
    return f'https://{host}' if host else ''


# ---------------------------------------------------------------------------
# Host validation + request.tenant
# ---------------------------------------------------------------------------

def _claimed_domains():
    from .models import TenantBranding
    claimed = cache.get(_CLAIMED_KEY)
    if claimed is None:
        claimed = set(
            d.lower() for d in TenantBranding.objects.exclude(custom_domain__isnull=True)
            .exclude(custom_domain='').values_list('custom_domain', flat=True)
        )
        cache.set(_CLAIMED_KEY, claimed, CACHE_SECONDS)
    return claimed


def host_allowed(host):
    host = normalize_host(host)
    if not host:
        return False
    platform_hosts = getattr(settings, 'PLATFORM_HOSTS', ['*'])
    if '*' in platform_hosts:
        return True
    if validate_host(host, platform_hosts) or is_platform_host(host) or _is_platform_subdomain(host):
        return True
    return host in _claimed_domains()


class TenantMiddleware:
    """Rejects unknown Hosts with 400 (Django's ALLOWED_HOSTS is '*'; see the module docstring).

    The tenant itself is resolved lazily by tenant_for_request() only on endpoints that scope data."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        raw = request.META.get('HTTP_HOST', '') or request.META.get('SERVER_NAME', '')
        if not host_allowed(raw):
            return HttpResponseBadRequest('Unknown host.', content_type='text/plain')
        return self.get_response(request)
