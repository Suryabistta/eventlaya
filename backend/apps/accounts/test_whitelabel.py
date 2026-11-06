"""White-label sites: tenant resolution, scoped public data, domain verification, provisioning, emails."""
from datetime import timedelta
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts import cloudflare, domains, modules, tenancy
from apps.accounts.models import PlatformModule, RoleModulePermission, TenantBranding
from apps.events.models import Event, EventTicket
from apps.platform.models import WhiteLabelRequest

User = get_user_model()

DFF_DOMAIN = 'event.dharanfilmfestival.org'
TARGET = 'tenants.eventlaya.com'


def make_user(email, role='organizer', **extra):
    return User.objects.create_user(username=email.split('@')[0], email=email, password='pw-12345678', role=role, **extra)


def make_event(org, slug, days=5, **extra):
    today = timezone.localdate()
    return Event.objects.create(
        organizer=org, title=slug.title(), slug=slug, location='Dharan',
        start_date=today + timedelta(days=days), status=extra.pop('status', Event.Status.PUBLISHED), **extra,
    )


def approve(org, **branding):
    WhiteLabelRequest.objects.create(organizer=org, brand_name=branding.get('brand_name', 'Brand'),
                                     status=WhiteLabelRequest.Status.APPROVED, reviewed_at=timezone.now())
    return TenantBranding.objects.create(organizer=org, **branding)


class TenantBase(APITestCase):
    def setUp(self):
        tenancy.clear_cache()
        modules.clear_cache()
        self.addCleanup(tenancy.clear_cache)
        self.addCleanup(modules.clear_cache)
        self.admin = make_user('admin@x.com', 'superadmin')
        self.dff = make_user('dff@x.com', organization_name='Dharan Film Festival')
        self.other = make_user('other@x.com', organization_name='Itahari Hall')
        self.branding = approve(self.dff, subdomain='dff', custom_domain=DFF_DOMAIN, brand_name='Dharan Film Festival',
                                is_domain_verified=True, ssl_active=True, primary_color='#112233')
        self.dff_event = make_event(self.dff, 'dff-opening')
        self.dff_past = make_event(self.dff, 'dff-2025', days=-30)
        self.other_event = make_event(self.other, 'itahari-gig')

    def on(self, host):
        """Requests as if made on `host` (what Nginx forwards)."""
        return {'HTTP_HOST': host}

    def switch_module(self, globally=None, role=None, role_enabled=True):
        module = PlatformModule.objects.get(slug='white_label')
        if globally is not None:
            module.is_globally_enabled = globally
            module.save()
        if role:
            RoleModulePermission.objects.filter(module=module, role=role).update(is_enabled=role_enabled)
            modules.clear_cache()
            tenancy.clear_cache()


class ResolutionTests(TenantBase):
    def test_custom_domain(self):
        self.assertEqual(tenancy.resolve_tenant(DFF_DOMAIN), self.branding)
        self.assertEqual(tenancy.resolve_tenant(DFF_DOMAIN.upper() + ':443'), self.branding)
        self.assertEqual(tenancy.lookup(DFF_DOMAIN)[1], 'live')

    def test_subdomain(self):
        self.assertEqual(tenancy.resolve_tenant('dff.eventlaya.com'), self.branding)

    @override_settings(WHITELABEL_SUBDOMAINS_ENABLED=False)
    def test_subdomain_not_live_when_free_subdomains_are_off(self):
        # Production keeps <name>.eventlaya.com off; the custom domain still works
        tenancy.clear_cache()
        self.assertIsNone(tenancy.resolve_tenant('dff.eventlaya.com'))
        self.assertEqual(tenancy.lookup('dff.eventlaya.com')[1], 'not_set_up')
        self.assertEqual(tenancy.resolve_tenant(DFF_DOMAIN), self.branding)

    def test_platform_hosts_are_not_tenants(self):
        for host in ('eventlaya.com', 'www.eventlaya.com', 'api.eventlaya.com', 'tenants.eventlaya.com', 'localhost', ''):
            self.assertIsNone(tenancy.resolve_tenant(host), host)
            self.assertEqual(tenancy.lookup(host)[1], 'platform', host)

    def test_unknown(self):
        self.assertIsNone(tenancy.resolve_tenant('random.example.com'))
        self.assertEqual(tenancy.lookup('random.example.com')[1], 'not_set_up')
        self.assertEqual(tenancy.lookup('nobody.eventlaya.com')[1], 'not_set_up')

    def test_unverified_domain_not_live_but_subdomain_is(self):
        self.branding.is_domain_verified = False
        self.branding.save()
        self.assertIsNone(tenancy.resolve_tenant(DFF_DOMAIN))
        self.assertEqual(tenancy.lookup(DFF_DOMAIN)[1], 'not_set_up')
        self.assertEqual(tenancy.resolve_tenant('dff.eventlaya.com'), self.branding)

    def test_revoked(self):
        WhiteLabelRequest.objects.filter(organizer=self.dff).update(status=WhiteLabelRequest.Status.REVOKED)
        tenancy.clear_cache()
        self.assertIsNone(tenancy.resolve_tenant(DFF_DOMAIN))
        self.assertIsNone(tenancy.resolve_tenant('dff.eventlaya.com'))
        self.assertEqual(tenancy.lookup(DFF_DOMAIN)[1], 'unavailable')

    def test_never_approved(self):
        TenantBranding.objects.create(organizer=self.other, subdomain='itahari')
        self.assertIsNone(tenancy.resolve_tenant('itahari.eventlaya.com'))
        self.assertEqual(tenancy.lookup('itahari.eventlaya.com')[1], 'unavailable')

    def test_suspended_organizer(self):
        self.dff.is_active = False
        self.dff.save()
        tenancy.clear_cache()
        self.assertIsNone(tenancy.resolve_tenant(DFF_DOMAIN))

    def test_module_off_globally_stops_sites(self):
        self.switch_module(globally=False)
        self.assertIsNone(tenancy.resolve_tenant(DFF_DOMAIN))
        res = self.client.get('/api/auth/tenant-branding/resolve/', **self.on(DFF_DOMAIN))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['state'], 'unavailable')

    def test_module_off_for_organizers_stops_sites(self):
        self.switch_module(role='organizer', role_enabled=False)
        self.assertIsNone(tenancy.resolve_tenant(DFF_DOMAIN))

    def test_cache_is_invalidated_on_change(self):
        self.assertIsNotNone(tenancy.resolve_tenant(DFF_DOMAIN))
        self.branding.is_domain_verified = False
        self.branding.save()  # signal bumps the cache generation
        self.assertIsNone(tenancy.resolve_tenant(DFF_DOMAIN))


class ResolveEndpointTests(TenantBase):
    URL = '/api/auth/tenant-branding/resolve/'

    def test_by_host_header(self):
        res = self.client.get(self.URL, **self.on(DFF_DOMAIN))
        self.assertTrue(res.data['is_whitelabel'])
        self.assertEqual(res.data['state'], 'live')
        self.assertEqual(res.data['brand_name'], 'Dharan Film Festival')
        self.assertEqual(res.data['primary_color'], '#112233')
        self.assertEqual(res.data['counts'], {'live': 0, 'upcoming': 1, 'past': 1})
        self.assertNotIn('organizer_email', res.data)
        self.assertNotIn('verification_token', res.data)

    def test_by_x_tenant_host_and_query(self):
        self.assertTrue(self.client.get(self.URL, HTTP_X_TENANT_HOST='dff.eventlaya.com').data['is_whitelabel'])
        self.assertTrue(self.client.get(self.URL + f'?host={DFF_DOMAIN}').data['is_whitelabel'])

    def test_platform_and_unknown(self):
        self.assertEqual(self.client.get(self.URL, **self.on('eventlaya.com')).data['state'], 'platform')
        res = self.client.get(self.URL + '?host=nope.example.org')
        self.assertFalse(res.data['is_whitelabel'])
        self.assertEqual(res.data['state'], 'not_set_up')


class ScopingTests(TenantBase):
    def test_public_list(self):
        on_tenant = self.client.get('/api/events/public/?when=all', **self.on(DFF_DOMAIN)).data
        self.assertEqual({e['slug'] for e in on_tenant}, {'dff-opening', 'dff-2025'})
        via_header = self.client.get('/api/events/public/?when=upcoming', HTTP_X_TENANT_HOST='dff.eventlaya.com').data
        self.assertEqual([e['slug'] for e in via_header], ['dff-opening'])
        on_platform = self.client.get('/api/events/public/?when=all', **self.on('eventlaya.com')).data
        self.assertEqual({e['slug'] for e in on_platform}, {'dff-opening', 'dff-2025', 'itahari-gig'})

    def test_detail(self):
        self.assertEqual(self.client.get('/api/events/public/dff-opening/', **self.on(DFF_DOMAIN)).status_code, 200)
        self.assertEqual(self.client.get('/api/events/public/itahari-gig/', **self.on(DFF_DOMAIN)).status_code, 404)
        self.assertEqual(self.client.get('/api/events/public/itahari-gig/', **self.on('eventlaya.com')).status_code, 200)

    def test_register(self):
        body = {'name': 'Asha', 'email': 'asha@x.com'}
        res = self.client.post('/api/forms/events/itahari-gig/register/', body, format='json', **self.on(DFF_DOMAIN))
        self.assertEqual(res.status_code, 404)
        res = self.client.post('/api/forms/events/dff-opening/register/', body, format='json', **self.on(DFF_DOMAIN))
        self.assertEqual(res.status_code, 201, res.content)

    def test_promo_check(self):
        res = self.client.post('/api/events/public/itahari-gig/promo/', {'code': 'X'}, format='json', **self.on(DFF_DOMAIN))
        self.assertEqual(res.status_code, 404)

    def test_pass(self):
        mine = EventTicket.generate_ticket(self.dff_event, 'A', 'a@x.com')
        theirs = EventTicket.generate_ticket(self.other_event, 'B', 'b@x.com')
        self.assertEqual(self.client.get(f'/api/events/passes/{mine.qr_token}/', **self.on(DFF_DOMAIN)).status_code, 200)
        self.assertEqual(self.client.get(f'/api/events/passes/{theirs.qr_token}/', **self.on(DFF_DOMAIN)).status_code, 404)
        self.assertEqual(self.client.get(f'/api/events/passes/{theirs.qr_token}/', **self.on('eventlaya.com')).status_code, 200)

    def test_my_tickets(self):
        user = make_user('asha@x.com', 'attendee')
        EventTicket.generate_ticket(self.dff_event, 'Asha', 'asha@x.com', user=user)
        EventTicket.generate_ticket(self.other_event, 'Asha', 'asha@x.com', user=user)
        self.client.force_authenticate(user)
        self.assertEqual(self.client.get('/api/me/tickets/', **self.on(DFF_DOMAIN)).data['count'], 1)
        self.assertEqual(self.client.get('/api/me/tickets/', **self.on('eventlaya.com')).data['count'], 2)

    def test_voting_page(self):
        self.assertEqual(self.client.get('/api/voting/public/itahari-gig/', **self.on(DFF_DOMAIN)).status_code, 404)

    def test_revoked_tenant_host_is_not_scoped(self):
        WhiteLabelRequest.objects.filter(organizer=self.dff).update(status=WhiteLabelRequest.Status.REVOKED)
        tenancy.clear_cache()
        res = self.client.get('/api/events/public/?when=all', HTTP_X_TENANT_HOST=DFF_DOMAIN)
        self.assertEqual(len(res.data), 3)


@override_settings(PLATFORM_HOSTS=['eventlaya.com', 'www.eventlaya.com', 'api.eventlaya.com'])
class HostValidationTests(TenantBase):
    def test_hosts(self):
        url = '/api/events/public/'
        for host in ('eventlaya.com', 'api.eventlaya.com', 'dff.eventlaya.com', 'whatever.eventlaya.com', DFF_DOMAIN,
                     'tenants.eventlaya.com'):
            self.assertEqual(self.client.get(url, **self.on(host)).status_code, 200, host)
        self.assertEqual(self.client.get(url, **self.on('evil.example.com')).status_code, 400)
        # A claimed-but-unverified domain still reaches Django (it shows "not set up yet" instead of an error).
        TenantBranding.objects.create(organizer=self.other, subdomain='itahari', custom_domain='events.itahari.org')
        self.assertEqual(self.client.get(url, **self.on('events.itahari.org')).status_code, 200)


class ValidationTests(TenantBase):
    BRANDING = '/api/auth/tenant-branding/'

    def test_reserved_and_invalid_subdomains(self):
        self.client.force_authenticate(self.dff)
        for bad in ('www', 'api', 'admin', 'tenants', 'cname', 'mail', 'ab', '-dff', 'dff-', 'd_ff', 'a--b', 'x' * 64):
            res = self.client.post(self.BRANDING, {'subdomain': bad}, format='json')
            self.assertEqual(res.status_code, 400, bad)
        TenantBranding.objects.create(organizer=self.other, subdomain='itahari-hall')
        self.assertEqual(self.client.post(self.BRANDING, {'subdomain': 'itahari-hall'}, format='json').status_code, 400)
        res = self.client.post(self.BRANDING, {'subdomain': 'dharan-films'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['subdomain'], 'dharan-films')
        self.assertIn('status', res.data)

    def test_cannot_change_domain_or_verification_or_inject_html(self):
        self.client.force_authenticate(self.dff)
        self.client.post(self.BRANDING, {'custom_domain': 'x.com', 'is_domain_verified': False, 'ssl_active': False},
                         format='json')
        self.branding.refresh_from_db()
        self.assertEqual((self.branding.custom_domain, self.branding.is_domain_verified), (DFF_DOMAIN, True))
        res = self.client.post(self.BRANDING, {'custom_css': '</style><script>alert(1)</script>'}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_requested_domain_rules(self):
        self.client.force_authenticate(self.other)
        for bad in ('eventlaya.com', 'x.eventlaya.com', 'tenants.eventlaya.com', DFF_DOMAIN):
            res = self.client.post('/api/platform/white-label/requests/', {'brand_name': 'X', 'requested_domain': bad},
                                   format='json')
            self.assertEqual(res.status_code, 400, bad)

    def test_unique_subdomain_skips_reserved(self):
        u = make_user('a@x.com', organization_name='Admin')
        self.assertEqual(tenancy.unique_subdomain(u), 'admin-org')
        u2 = make_user('b@x.com', organization_name='Dff')
        self.assertEqual(tenancy.unique_subdomain(u2), 'dff-2')


def fake_dns(records):
    """_query replacement: records = {(name, type): [values]} ; ('timeout') raises."""
    def _query(name, rdtype):
        value = records.get((name, rdtype), [])
        if value == 'timeout':
            raise domains.DnsLookupError('timeout')
        return value
    return _query


@override_settings(CLOUDFLARE_API_TOKEN='', CLOUDFLARE_ZONE_ID='')
class VerificationTests(TenantBase):
    VERIFY = '/api/auth/tenant-branding/verify-domain/'

    def setUp(self):
        super().setUp()
        self.branding.is_domain_verified = False
        self.branding.ssl_active = False
        self.branding.save()
        self.txt = f'eventlaya-verify={self.branding.verification_token}'

    def check(self, records, https=False):
        with mock.patch.object(domains, '_query', fake_dns(records)), mock.patch.object(domains, 'https_live', return_value=https):
            return domains.check_domain(self.branding)

    def test_cname_and_txt_verify(self):
        b = self.check({(DFF_DOMAIN, 'CNAME'): [TARGET], (f'_eventlaya.{DFF_DOMAIN}', 'TXT'): [self.txt]}, https=True)
        self.assertTrue(b.is_domain_verified)
        self.assertEqual(b.dns_status, 'verified')
        self.assertTrue(b.ssl_active)  # manual mode: HTTPS probe answered
        self.assertEqual(b.ssl_provider, 'manual')
        self.assertIsNotNone(b.verified_at)

    def test_missing_cname(self):
        b = self.check({})
        self.assertFalse(b.is_domain_verified)
        self.assertIn('can’t see the CNAME', b.dns_message)
        self.assertIn('up to an hour', b.dns_message)

    def test_wrong_cname(self):
        b = self.check({(DFF_DOMAIN, 'CNAME'): ['someone-else.netlify.app']})
        self.assertIn('points to someone-else.netlify.app', b.dns_message)

    def test_a_record_instead_of_cname(self):
        b = self.check({(DFF_DOMAIN, 'A'): ['1.2.3.4'], (TARGET, 'A'): ['104.21.0.1']})
        self.assertIn('address (A) record', b.dns_message)

    def test_flattened_record_on_same_addresses_is_accepted(self):
        b = self.check({(DFF_DOMAIN, 'A'): ['104.21.0.1'], (TARGET, 'A'): ['104.21.0.1', '172.67.0.1'],
                        (f'_eventlaya.{DFF_DOMAIN}', 'TXT'): [self.txt]})
        self.assertTrue(b.is_domain_verified)

    def test_txt_missing_and_wrong(self):
        b = self.check({(DFF_DOMAIN, 'CNAME'): [TARGET]})
        self.assertFalse(b.is_domain_verified)
        self.assertIn('TXT record', b.dns_message)
        b = self.check({(DFF_DOMAIN, 'CNAME'): [TARGET], (f'_eventlaya.{DFF_DOMAIN}', 'TXT'): ['eventlaya-verify=nope']})
        self.assertIn('different value', b.dns_message)

    @override_settings(WHITELABEL_REQUIRE_TXT=False)
    def test_txt_optional_setting(self):
        self.assertTrue(self.check({(DFF_DOMAIN, 'CNAME'): [TARGET]}).is_domain_verified)

    def test_timeout_does_not_take_a_live_domain_down(self):
        self.branding.is_domain_verified = True
        self.branding.save()
        b = self.check({(DFF_DOMAIN, 'CNAME'): 'timeout'})
        self.assertTrue(b.is_domain_verified)
        self.assertIn('couldn’t reach DNS', b.dns_message)
        b = self.check({})  # definite answer: record removed
        self.assertFalse(b.is_domain_verified)

    def test_verify_endpoint(self):
        self.client.force_authenticate(self.dff)
        with mock.patch.object(domains, '_query', fake_dns({(DFF_DOMAIN, 'CNAME'): [TARGET]})):
            res = self.client.post(self.VERIFY)
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['is_domain_verified'])
        self.assertIn('TXT', res.data['message'])
        records = res.data['status']['custom_domain']['records']
        self.assertEqual([r['type'] for r in records], ['CNAME', 'TXT'])
        self.assertEqual(records[0]['value'], TARGET)
        self.assertEqual(records[0]['host'], 'event')
        self.assertEqual(records[1]['host'], '_eventlaya.event')
        self.assertEqual(records[1]['value'], self.txt)

    def test_superadmin_check_endpoint(self):
        req = WhiteLabelRequest.objects.get(organizer=self.dff)
        url = f'/api/platform/white-label/requests/{req.id}/check-domain/'
        self.client.force_authenticate(self.dff)
        self.assertEqual(self.client.post(url).status_code, 403)
        self.client.force_authenticate(self.admin)
        recs = {(DFF_DOMAIN, 'CNAME'): [TARGET], (f'_eventlaya.{DFF_DOMAIN}', 'TXT'): [self.txt]}
        with mock.patch.object(domains, '_query', fake_dns(recs)), mock.patch.object(domains, 'https_live', return_value=False):
            res = self.client.post(url)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['is_domain_verified'])
        self.assertEqual(res.data['status']['custom_domain']['stage'], 'ssl')
        self.assertEqual(res.data['status']['mode'], 'manual')

    def test_management_command(self):
        out = StringIO()
        recs = {(DFF_DOMAIN, 'CNAME'): [TARGET], (f'_eventlaya.{DFF_DOMAIN}', 'TXT'): [self.txt]}
        with mock.patch.object(domains, '_query', fake_dns(recs)), mock.patch.object(domains, 'https_live', return_value=True):
            call_command('check_tenant_domains', stdout=out)
        self.assertIn(f'{DFF_DOMAIN}: live', out.getvalue())
        self.branding.refresh_from_db()
        self.assertTrue(self.branding.ssl_active)


def cf_response(status=200, result=None, success=True, errors=()):
    res = mock.Mock()
    res.status_code = status
    res.json.return_value = {'success': success, 'result': result, 'errors': list(errors)}
    return res


def cf_hostname(status='pending', ssl='pending_validation', id='cf-123'):
    return {'id': id, 'hostname': DFF_DOMAIN, 'status': status, 'ssl': {'status': ssl}, 'verification_errors': []}


@override_settings(CLOUDFLARE_API_TOKEN='test-token', CLOUDFLARE_ZONE_ID='zone123')
class CloudflareProvisioningTests(TenantBase):
    def setUp(self):
        super().setUp()
        self.branding.is_domain_verified = False
        self.branding.ssl_active = False
        self.branding.save()
        self.recs = {(DFF_DOMAIN, 'CNAME'): [TARGET],
                     (f'_eventlaya.{DFF_DOMAIN}', 'TXT'): [f'eventlaya-verify={self.branding.verification_token}']}

    def run_check(self, responses):
        with mock.patch.object(domains, '_query', fake_dns(self.recs)), \
                mock.patch('apps.accounts.cloudflare.requests.request', side_effect=responses) as req:
            domains.check_domain(self.branding)
        return req

    def test_creates_custom_hostname_then_syncs_status(self):
        req = self.run_check([cf_response(result=cf_hostname())])
        method, url = req.call_args.args[:2]
        self.assertEqual((method, url), ('POST', 'https://api.cloudflare.com/client/v4/zones/zone123/custom_hostnames'))
        self.assertEqual(req.call_args.kwargs['json']['hostname'], DFF_DOMAIN)
        self.assertEqual(req.call_args.kwargs['json']['ssl']['method'], 'http')
        self.assertEqual(req.call_args.kwargs['headers']['Authorization'], 'Bearer test-token')
        self.assertEqual(self.branding.provider_hostname_id, 'cf-123')
        self.assertEqual(self.branding.ssl_provider, 'cloudflare')
        self.assertFalse(self.branding.ssl_active)
        self.assertTrue(self.branding.is_domain_verified)

        # Next check: still pending validation → GET then PATCH to retry; then active
        req = self.run_check([cf_response(result=cf_hostname()), cf_response(result=cf_hostname('active', 'active'))])
        self.assertEqual([c.args[0] for c in req.call_args_list], ['GET', 'PATCH'])
        self.assertTrue(self.branding.ssl_active)
        self.assertEqual(tenancy.lookup(DFF_DOMAIN)[1], 'live')

    def test_adopts_existing_hostname_on_duplicate(self):
        self.run_check([
            cf_response(400, success=False, errors=[{'code': 1406, 'message': 'Duplicate custom hostname found.'}]),
            cf_response(result=[cf_hostname('active', 'active', id='cf-old')]),
        ])
        self.assertEqual(self.branding.provider_hostname_id, 'cf-old')
        self.assertTrue(self.branding.ssl_active)

    def test_api_error_is_reported_not_raised(self):
        self.run_check([cf_response(403, success=False, errors=[{'code': 10000, 'message': 'Authentication error'}])])
        self.assertFalse(self.branding.ssl_active)
        self.assertIn('Authentication error', self.branding.provider_message)

    def test_revoke_deletes_custom_hostname(self):
        self.branding.provider_hostname_id = 'cf-123'
        self.branding.save()
        req = WhiteLabelRequest.objects.get(organizer=self.dff)
        self.client.force_authenticate(self.admin)
        with mock.patch('apps.accounts.cloudflare.requests.request', return_value=cf_response(result={'id': 'cf-123'})) as call:
            res = self.client.post(f'/api/platform/white-label/requests/{req.id}/revoke/', {'note': 'Plan ended'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(call.call_args.args[:2], ('DELETE', 'https://api.cloudflare.com/client/v4/zones/zone123/custom_hostnames/cf-123'))
        self.branding.refresh_from_db()
        self.assertIsNone(self.branding.custom_domain)
        self.assertEqual(self.branding.provider_hostname_id, '')
        self.assertIsNone(tenancy.resolve_tenant(DFF_DOMAIN))

    def test_domain_change_on_new_approval_deletes_old_hostname(self):
        self.branding.provider_hostname_id = 'cf-123'
        self.branding.save()
        new = WhiteLabelRequest.objects.create(organizer=self.dff, brand_name='DFF', requested_domain='films.dff.org')
        self.client.force_authenticate(self.admin)
        with mock.patch('apps.accounts.cloudflare.requests.request', return_value=cf_response(result={'id': 'cf-123'})) as call:
            self.assertEqual(self.client.post(f'/api/platform/white-label/requests/{new.id}/approve/').status_code, 200)
        self.assertEqual(call.call_args.args[0], 'DELETE')
        self.branding.refresh_from_db()
        self.assertEqual((self.branding.custom_domain, self.branding.is_domain_verified, self.branding.dns_status),
                         ('films.dff.org', False, 'pending'))

    def test_not_configured_means_manual(self):
        with override_settings(CLOUDFLARE_API_TOKEN=''):
            self.assertFalse(cloudflare.enabled())
            self.assertEqual(cloudflare.mode(), 'manual')


class ModuleTests(TenantBase):
    def test_branding_endpoints_follow_module(self):
        # Real JWT: the module middleware runs before DRF's force_authenticate would apply
        token = self.client.post('/api/auth/login/', {'email': 'dff@x.com', 'password': 'pw-12345678'}, format='json').data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(self.client.get('/api/auth/tenant-branding/').status_code, 200)
        self.switch_module(role='organizer', role_enabled=False)
        res = self.client.get('/api/auth/tenant-branding/')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['module'], 'white_label')
        self.assertEqual(self.client.get('/api/platform/white-label/requests/mine/').status_code, 403)
        # Public resolve still answers (the site itself reports "unavailable")
        self.assertEqual(self.client.get('/api/auth/tenant-branding/resolve/', **self.on(DFF_DOMAIN)).status_code, 200)

    def test_seeded_defaults(self):
        module = PlatformModule.objects.get(slug='white_label')
        enabled = dict(RoleModulePermission.objects.filter(module=module).values_list('role', 'is_enabled'))
        self.assertEqual(enabled, {'superadmin': True, 'organizer': True, 'staff': False, 'attendee': False, 'vendor': False})


@override_settings(FRONTEND_URL='https://eventlaya.com', WHITELABEL_SUBDOMAINS_ENABLED=True)
class EmailTests(TenantBase):
    def register(self, slug, **extra):
        body = {'name': 'Asha', 'email': 'asha@x.com', **extra}
        return self.client.post(f'/api/forms/events/{slug}/register/', body, format='json')

    def test_tenant_event_links_to_tenant_domain_with_brand(self):
        self.assertEqual(self.register('dff-opening').status_code, 201)
        msg = mail.outbox[-1]
        token = EventTicket.objects.get(event=self.dff_event).qr_token
        self.assertIn(f'https://{DFF_DOMAIN}/ticket/{token}', msg.body)
        self.assertIn(f'https://{DFF_DOMAIN}/e/dff-opening', msg.body)
        self.assertIn('Dharan Film Festival', msg.body)
        self.assertIn('Powered by Eventlaya', msg.body)
        self.assertTrue(msg.from_email.startswith('Dharan Film Festival via Eventlaya'))
        self.assertIn(f'https://{DFF_DOMAIN}/ticket/{token}', msg.alternatives[0][0])

    def test_order_email_and_watermark(self):
        self.branding.remove_watermark = True
        self.branding.save()
        self.assertEqual(self.register('dff-opening', items=[{'quantity': 2}]).status_code, 201)
        msg = mail.outbox[-1]
        self.assertEqual(msg.body.count(f'https://{DFF_DOMAIN}/ticket/'), 2)
        self.assertNotIn('Powered by Eventlaya', msg.body)

    def test_subdomain_until_domain_is_live(self):
        self.branding.ssl_active = False
        self.branding.save()
        self.register('dff-opening')
        self.assertIn('https://dff.eventlaya.com/ticket/', mail.outbox[-1].body)

    def test_other_events_and_revoked_use_frontend_url(self):
        self.register('itahari-gig')
        self.assertIn('https://eventlaya.com/ticket/', mail.outbox[-1].body)
        self.assertEqual(mail.outbox[-1].from_email, 'Eventlaya Passes <passes@eventlaya.com>')
        WhiteLabelRequest.objects.filter(organizer=self.dff).update(status=WhiteLabelRequest.Status.REVOKED)
        self.register('dff-opening', email='b@x.com')
        self.assertIn('https://eventlaya.com/ticket/', mail.outbox[-1].body)
