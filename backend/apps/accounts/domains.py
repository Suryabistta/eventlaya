"""Custom-domain verification and certificate status for white-label sites.

A domain is verified when public DNS shows BOTH
  1. <domain> CNAME → WHITELABEL_CNAME_TARGET (tenants.eventlaya.com) — traffic reaches us, and
  2. TXT  _eventlaya.<domain> = "eventlaya-verify=<token>" — the domain's owner chose *this* organization.

Why the TXT record: every tenant points at the same CNAME target, so a CNAME alone can't say which
organization the owner meant. Without it, whoever claims a domain first on Eventlaya would get the site as
soon as the real owner (perhaps setting it up for a different organization) adds the CNAME. The token is
per organization, so only someone who controls the domain's DNS can bind it to an account.
(WHITELABEL_REQUIRE_TXT=0 turns the TXT requirement off, e.g. for a migration.)

Then the certificate: with Cloudflare for SaaS configured (apps.accounts.cloudflare) we create the custom
hostname and read its status; in manual mode we probe https://<domain>/ ourselves.
"""
import logging

import requests
from django.conf import settings
from django.utils import timezone

from . import cloudflare, tenancy
from .models import TenantBranding

logger = logging.getLogger(__name__)

TXT_PREFIX = '_eventlaya'
TXT_VALUE_PREFIX = 'eventlaya-verify='
DNS_TIMEOUT = 5.0
PROPAGATION = 'DNS changes can take up to an hour to show up.'


def require_txt():
    return bool(getattr(settings, 'WHITELABEL_REQUIRE_TXT', True))


def txt_name(domain):
    return f'{TXT_PREFIX}.{domain}'


def txt_value(branding):
    return f'{TXT_VALUE_PREFIX}{branding.verification_token}'


def dns_records(branding):
    """What the client adds at their DNS provider (shown in the organizer and superadmin UIs)."""
    domain = branding.custom_domain
    if not domain:
        return []
    records = [{'type': 'CNAME', 'name': domain, 'host': _host_label(domain), 'value': tenancy.cname_target(),
                'purpose': 'Sends visitors to your Eventlaya site'}]
    if require_txt():
        records.append({'type': 'TXT', 'name': txt_name(domain), 'host': _host_label(txt_name(domain)),
                        'value': txt_value(branding), 'purpose': 'Proves the domain is yours'})
    return records


def _host_label(name):
    """What most DNS panels want in the "Name" box: everything left of the registered domain (best effort)."""
    parts = name.split('.')
    # Two-label public suffixes common in Nepal and elsewhere (org.np, com.np, co.uk ...)
    keep = 3 if len(parts) >= 3 and len(parts[-1]) == 2 and parts[-2] in ('com', 'org', 'edu', 'gov', 'net', 'co', 'ac') else 2
    return '.'.join(parts[:-keep]) or '@'


# ---------------------------------------------------------------------------
# DNS
# ---------------------------------------------------------------------------

class DnsLookupError(Exception):
    pass


def _resolver():
    import dns.resolver
    r = dns.resolver.Resolver()
    r.lifetime = DNS_TIMEOUT
    r.timeout = DNS_TIMEOUT
    nameservers = getattr(settings, 'WHITELABEL_DNS_SERVERS', None)
    if nameservers:
        r.nameservers = list(nameservers)
    return r


def _query(name, rdtype):
    """Answers as strings ([] when the name or record type doesn't exist). Raises DnsLookupError on timeouts."""
    import dns.exception
    import dns.resolver
    try:
        answer = _resolver().resolve(name, rdtype, raise_on_no_answer=False)
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return []
    except (dns.exception.Timeout, dns.resolver.NoNameservers, dns.resolver.LifetimeTimeout) as e:
        raise DnsLookupError(str(e)) from e
    except dns.exception.DNSException as e:
        raise DnsLookupError(str(e)) from e
    if answer.rrset is None:
        return []
    out = []
    for rdata in answer.rrset:
        if rdtype == 'TXT':
            out.append(b''.join(rdata.strings).decode('utf-8', 'replace'))
        else:
            out.append(rdata.to_text().rstrip('.').lower())
    return out


DNS_UNREACHABLE = 'We couldn’t reach DNS just now. Try again in a minute.'


def check_dns(domain, token):
    """(ok, message). Message is written for the organizer."""
    target = tenancy.cname_target()
    try:
        cnames = _query(domain, 'CNAME')
        points_at_us = target in cnames
        if not points_at_us:
            if cnames:
                return False, (f'{domain} points to {cnames[0]}, not {target}. '
                               f'Change the CNAME record’s value to {target}. {PROPAGATION}')
            # No CNAME visible: flattened apex / provider-proxied record. Accept when it lands on the same addresses.
            addresses = set(_query(domain, 'A')) | set(_query(domain, 'AAAA'))
            if not addresses:
                return False, f'We can’t see the CNAME for {domain} yet. Add it at your DNS provider. {PROPAGATION}'
            ours = set(_query(target, 'A')) | set(_query(target, 'AAAA'))
            if not (addresses & ours):
                return False, (f'{domain} has an address (A) record instead of a CNAME to {target}. '
                               f'Remove it and add the CNAME record. {PROPAGATION}')
        if require_txt():
            expected = f'{TXT_VALUE_PREFIX}{token}'
            values = _query(txt_name(domain), 'TXT')
            if not values:
                return False, (f'The CNAME is in place. We can’t see the TXT record {txt_name(domain)} yet. {PROPAGATION}')
            if expected not in [v.strip() for v in values]:
                return False, (f'The TXT record {txt_name(domain)} has a different value. Set it to {expected} '
                               f'(this proves the domain is yours).')
    except DnsLookupError:
        return False, DNS_UNREACHABLE
    return True, f'{domain} points to Eventlaya and the ownership record matches.'


# ---------------------------------------------------------------------------
# Certificates
# ---------------------------------------------------------------------------

def https_live(domain):
    """Manual mode: is https://<domain> answering with our API (valid certificate, reaches the droplet)?"""
    try:
        res = requests.get(f'https://{domain}/api/auth/tenant-branding/resolve/', timeout=8, allow_redirects=False)
    except requests.RequestException:
        return False
    return res.status_code == 200 and 'application/json' in res.headers.get('Content-Type', '')


def _apply_provider(branding, info):
    branding.provider_hostname_id = info.get('id') or branding.provider_hostname_id
    branding.provider_status = info.get('status', '')
    branding.provider_ssl_status = info.get('ssl_status', '')
    branding.ssl_active = info.get('status') == 'active' and info.get('ssl_status') == 'active'
    errors = info.get('errors') or []
    if branding.ssl_active:
        branding.provider_message = 'Certificate active. Cloudflare renews it automatically.'
    elif errors:
        branding.provider_message = errors[0]
    else:
        branding.provider_message = 'Cloudflare is issuing the certificate. This usually takes a few minutes.'


def sync_certificate(branding):
    """Create / refresh the certificate for a verified domain. Never raises."""
    branding.ssl_provider = cloudflare.mode()
    branding.provider_synced_at = timezone.now()
    domain = branding.custom_domain
    if not cloudflare.enabled():
        branding.ssl_active = https_live(domain)
        branding.provider_status = 'active' if branding.ssl_active else 'manual'
        branding.provider_ssl_status = 'active' if branding.ssl_active else ''
        branding.provider_message = (
            'HTTPS is working.' if branding.ssl_active else
            'Waiting for the Eventlaya team to switch on HTTPS for this domain (manual setup).'
        )
        return
    try:
        if branding.provider_hostname_id:
            info = cloudflare.get(branding.provider_hostname_id)
            if info.get('ssl_status') == 'pending_validation':
                info = cloudflare.revalidate(branding.provider_hostname_id)
        else:
            info = cloudflare.create(domain)
        _apply_provider(branding, info)
    except cloudflare.CloudflareError as e:
        if e.status == 404 and branding.provider_hostname_id:
            branding.provider_hostname_id = ''  # deleted on Cloudflare's side: create again next time
        branding.ssl_active = False
        branding.provider_message = f'Cloudflare: {e}'
        logger.warning('Cloudflare custom hostname for %s failed: %s', domain, e)


def deprovision(branding_or_id, hostname=''):
    """Delete the Cloudflare custom hostname (on revoke / domain change). Never raises."""
    hostname_id = branding_or_id if isinstance(branding_or_id, str) else branding_or_id.provider_hostname_id
    if not hostname_id or not cloudflare.enabled():
        return
    try:
        cloudflare.delete(hostname_id)
    except cloudflare.CloudflareError as e:
        logger.warning('Could not delete Cloudflare custom hostname %s (%s): %s', hostname_id, hostname, e)


def reset_domain_state(branding):
    """Fields for a new / removed custom domain (call before save)."""
    branding.is_domain_verified = False
    branding.ssl_active = False
    branding.dns_status = TenantBranding.DnsStatus.PENDING if branding.custom_domain else TenantBranding.DnsStatus.NONE
    branding.dns_message = ''
    branding.dns_checked_at = None
    branding.verified_at = None
    branding.provider_hostname_id = ''
    branding.provider_status = ''
    branding.provider_ssl_status = ''
    branding.provider_message = ''


# ---------------------------------------------------------------------------
# The whole check ("Check now", management command)
# ---------------------------------------------------------------------------

STATUS_FIELDS = [
    'is_domain_verified', 'ssl_active', 'dns_status', 'dns_message', 'dns_checked_at', 'verified_at', 'ssl_provider',
    'provider_hostname_id', 'provider_status', 'provider_ssl_status', 'provider_message', 'provider_synced_at',
]


def check_domain(branding, recheck_verified=True):
    """Run DNS verification, then certificate sync. Saves and returns the branding.

    A domain that was verified only loses that status on a definite DNS answer (not on timeouts), so a
    flaky resolver can't take a live site down.
    """
    if not branding.custom_domain:
        reset_domain_state(branding)
        branding.save(update_fields=STATUS_FIELDS)
        return branding

    now = timezone.now()
    if recheck_verified or not branding.is_domain_verified:
        ok, message = check_dns(branding.custom_domain, branding.verification_token)
        branding.dns_checked_at = now
        branding.dns_message = message
        transient = message == DNS_UNREACHABLE
        if ok:
            if not branding.is_domain_verified:
                branding.verified_at = now
            branding.is_domain_verified = True
            branding.dns_status = TenantBranding.DnsStatus.VERIFIED
        elif not (transient and branding.is_domain_verified):
            branding.is_domain_verified = False
            branding.ssl_active = False
            branding.dns_status = TenantBranding.DnsStatus.FAILED if transient else TenantBranding.DnsStatus.PENDING

    if branding.is_domain_verified:
        sync_certificate(branding)
    branding.save(update_fields=STATUS_FIELDS)
    tenancy.clear_cache()
    return branding


def domain_status(branding, approved=True):
    """Everything the UIs show about a tenant's addresses, DNS, certificate and whether it's live."""
    from .modules import module_enabled
    module_on = module_enabled('white_label', branding.organizer)
    active = approved and module_on and branding.organizer.is_active
    sub_host = f'{branding.subdomain}.{tenancy.platform_domain()}' if branding.subdomain else None
    custom = branding.custom_domain or None
    custom_live = bool(active and custom and branding.is_domain_verified and branding.ssl_active)
    if not custom:
        stage = 'none'
    elif not branding.is_domain_verified:
        stage = 'dns'
    elif not branding.ssl_active:
        stage = 'ssl'
    else:
        stage = 'live'
    return {
        'active': active,
        'module_enabled': module_on,
        'mode': cloudflare.mode(),
        'subdomain': {
            'host': sub_host,
            'url': f'https://{sub_host}' if sub_host else None,
            'available': tenancy.subdomains_enabled(),
            'live': bool(active and sub_host and tenancy.subdomains_enabled()),
        },
        'custom_domain': {
            'host': custom,
            'url': f'https://{custom}' if custom else None,
            'stage': stage,
            'live': custom_live,
            'dns_status': branding.dns_status,
            'dns_verified': branding.is_domain_verified,
            'dns_message': branding.dns_message,
            'dns_checked_at': branding.dns_checked_at,
            'verified_at': branding.verified_at,
            'ssl_active': branding.ssl_active,
            'ssl_provider': branding.ssl_provider or cloudflare.mode(),
            'provider_hostname_id': branding.provider_hostname_id,
            'provider_status': branding.provider_status,
            'provider_ssl_status': branding.provider_ssl_status,
            'provider_message': branding.provider_message,
            'provider_synced_at': branding.provider_synced_at,
            'records': dns_records(branding),
        } if custom else None,
        'site_url': (f'https://{custom}' if custom_live else
                     (f'https://{sub_host}' if active and sub_host and tenancy.subdomains_enabled() else None)),
    }
