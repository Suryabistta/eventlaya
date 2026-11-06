"""Analytics settings (Admin → Analytics): permissions, validation, audit trail, the public config and the
search-engine verification tags in server-rendered HTML."""
import os
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts import tenancy
from apps.accounts.models import TenantBranding
from apps.platform.models import WhiteLabelRequest
from apps.seo import html as html_mod

from . import config
from .models import AnalyticsSettings, AnalyticsSettingsChange

User = get_user_model()

SETTINGS_URL = '/api/site/settings/'
CONFIG_URL = '/api/site/config/'
GOOGLE_CODE = 'aBcD-1234_efGH5678ijKLmnOPqrStuvWXyz0123456'
BING_CODE = '0123456789ABCDEF0123456789ABCDEF'
CF_TOKEN = '0123456789abcdef0123456789abcdef'
TENANT_DOMAIN = 'event.dharanfilmfestival.org'


class Base(TestCase):
    def setUp(self):
        config.clear_cache()
        tenancy.clear_cache()
        self.addCleanup(config.clear_cache)
        self.addCleanup(tenancy.clear_cache)
        self.client = APIClient()
        self.admin = User.objects.create_user(username='root', email='root@x.com', password='x', role='superadmin')
        self.org = User.objects.create_user(username='org', email='org@x.com', password='x', role='organizer')

    def public(self, host='eventlaya.com', **extra):
        return self.client.get(CONFIG_URL, HTTP_HOST=host, **extra).json()

    def save(self, user=None, **data):
        self.client.force_authenticate(user or self.admin)
        res = self.client.patch(SETTINGS_URL, data, format='json', HTTP_HOST='eventlaya.com')
        self.client.force_authenticate(None)
        return res

    def make_tenant(self):
        WhiteLabelRequest.objects.create(organizer=self.org, brand_name='Dharan Film Festival',
                                         status=WhiteLabelRequest.Status.APPROVED, reviewed_at=timezone.now())
        TenantBranding.objects.create(organizer=self.org, subdomain='dff', custom_domain=TENANT_DOMAIN,
                                      brand_name='Dharan Film Festival', is_domain_verified=True, ssl_active=True)
        tenancy.clear_cache()


class PermissionTests(Base):
    def test_only_superadmin_reads_and_writes(self):
        self.assertEqual(self.client.get(SETTINGS_URL).status_code, 401)
        self.assertEqual(self.client.patch(SETTINGS_URL, {'enabled': False}, format='json').status_code, 401)
        for role in ['organizer', 'staff', 'attendee', 'vendor']:
            user = User.objects.create_user(username=role, email=f'{role}@y.com', password='x', role=role)
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get(SETTINGS_URL).status_code, 403, role)
            self.assertEqual(self.client.put(SETTINGS_URL, {'measurement_id': 'G-EVIL12345'}, format='json').status_code, 403)
        self.client.force_authenticate(None)
        self.assertFalse(AnalyticsSettings.objects.exists())
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(SETTINGS_URL).status_code, 200)

    def test_public_config_needs_no_login_and_reveals_only_what_the_browser_needs(self):
        self.save(measurement_id='G-TEST123456', google_site_verification=GOOGLE_CODE, bing_site_verification=BING_CODE,
                  cloudflare_token=CF_TOKEN)
        data = self.public()
        self.assertEqual(set(data), {'enabled', 'measurement_id', 'track_app_pages', 'cloudflare_token'})
        self.assertEqual(data['measurement_id'], 'G-TEST123456')
        self.assertNotIn('root@x.com', str(data))


class ValidationTests(Base):
    def test_measurement_id_is_normalised_and_validated(self):
        res = self.save(measurement_id='  g-test123456 ')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data['settings']['measurement_id'], 'G-TEST123456')
        for bad in ['UA-12345-1', 'G-123', 'G-ABCDEFGHIJKLMN', 'GTM-ABC1234', 'G-ABC 1234', '<script>', 'G-TEST12345"']:
            res = self.save(measurement_id=bad)
            self.assertEqual(res.status_code, 400, bad)
            self.assertIn('measurement_id', res.data)
        self.assertEqual(AnalyticsSettings.objects.get().measurement_id, 'G-TEST123456')

    def test_pasted_snippets_are_reduced_to_the_value(self):
        snippet = ('<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST123456"></script><script>'
                   "gtag('config', 'G-TEST123456');</script>")
        res = self.save(
            measurement_id=snippet,
            google_site_verification=f'<meta name="google-site-verification" content="{GOOGLE_CODE}" />',
            bing_site_verification=f'<meta name="msvalidate.01" content="{BING_CODE}" />',
            cloudflare_token=f"<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{{\"token\": \"{CF_TOKEN}\"}}'></script>",
        )
        self.assertEqual(res.status_code, 200, res.content)
        s = res.data['settings']
        self.assertEqual((s['measurement_id'], s['google_site_verification'], s['bing_site_verification'], s['cloudflare_token']),
                         ('G-TEST123456', GOOGLE_CODE, BING_CODE, CF_TOKEN))
        # Search Console's DNS TXT form works too
        self.assertEqual(self.save(google_site_verification=f'google-site-verification={GOOGLE_CODE}').status_code, 200)

    def test_markup_cannot_be_smuggled_into_verification_tags(self):
        for field in ['google_site_verification', 'bing_site_verification', 'cloudflare_token']:
            res = self.save(**{field: '"><script>alert(1)</script>'})
            self.assertEqual(res.status_code, 400, field)
        self.assertFalse(AnalyticsSettings.objects.exists())

    def test_empty_values_are_allowed(self):
        self.save(measurement_id='G-TEST123456', google_site_verification=GOOGLE_CODE)
        res = self.save(measurement_id='', google_site_verification='')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(AnalyticsSettings.objects.get().measurement_id, '')


class AuditTests(Base):
    def test_changes_are_logged_with_who_and_what(self):
        self.save(measurement_id='G-TEST123456')
        self.save(enabled=False)
        self.save(enabled=False)  # no change → no entry
        log = list(AnalyticsSettingsChange.objects.order_by('changed_at', 'id'))
        self.assertEqual(len(log), 2)
        self.assertEqual(log[0].changed_by, self.admin)
        self.assertEqual(log[0].changed_by_email, 'root@x.com')
        self.assertEqual(log[0].changes['measurement_id'], ['', 'G-TEST123456'])
        self.assertEqual(log[1].changes, {'enabled': [True, False]})
        row = AnalyticsSettings.objects.get()
        self.assertEqual(row.updated_by, self.admin)
        self.client.force_authenticate(self.admin)
        data = self.client.get(SETTINGS_URL).data
        self.assertEqual(data['updated_by_email'], 'root@x.com')
        self.assertEqual(len(data['history']), 2)
        self.assertEqual(data['history'][0]['changes'], {'enabled': [True, False]})  # newest first

    def test_singleton(self):
        self.save(measurement_id='G-TEST123456')
        self.save(track_app_pages=True)
        self.assertEqual(AnalyticsSettings.objects.count(), 1)


class EffectiveConfigTests(Base):
    def test_nothing_configured_means_off(self):
        with override_settings(GA_MEASUREMENT_ID=''):
            self.assertEqual(self.public(), config.DISABLED)

    def test_environment_id_is_on_by_default_until_the_console_says_otherwise(self):
        with override_settings(GA_MEASUREMENT_ID='G-ENVID12345'):
            config.clear_cache()
            data = self.public()
            self.assertEqual(data, {'enabled': True, 'measurement_id': 'G-ENVID12345', 'track_app_pages': False,
                                    'cloudflare_token': ''})
            # superadmin page shows where the ID comes from
            self.client.force_authenticate(self.admin)
            page = self.client.get(SETTINGS_URL).data
            self.assertEqual(page['env_measurement_id'], 'G-ENVID12345')
            self.assertEqual(page['effective']['measurement_id_source'], 'environment')
            self.assertFalse(page['saved'])
            self.client.force_authenticate(None)
            # an ID saved in the console wins
            self.save(measurement_id='G-TEST123456', track_app_pages=True)
            self.assertEqual(self.public()['measurement_id'], 'G-TEST123456')
            self.assertTrue(self.public()['track_app_pages'])
            # cleared again → back to the environment's
            self.save(measurement_id='')
            self.assertEqual(self.public()['measurement_id'], 'G-ENVID12345')
            # switched off → nothing loads
            self.save(enabled=False)
            self.assertEqual(self.public(), config.DISABLED)

    def test_invalid_environment_id_is_ignored(self):
        with override_settings(GA_MEASUREMENT_ID='UA-1234-5'):
            config.clear_cache()
            self.assertEqual(self.public(), config.DISABLED)

    def test_cloudflare_alone(self):
        with override_settings(GA_MEASUREMENT_ID=''):
            self.save(cloudflare_token=CF_TOKEN)
            self.assertEqual(self.public(), {'enabled': True, 'measurement_id': '', 'track_app_pages': False,
                                             'cloudflare_token': CF_TOKEN})

    def test_never_on_white_label_sites(self):
        self.make_tenant()
        self.save(measurement_id='G-TEST123456', cloudflare_token=CF_TOKEN)
        self.assertTrue(self.public()['enabled'])
        self.assertEqual(self.public(host=TENANT_DOMAIN), config.DISABLED)
        # the web app in tenant mode (dev override) sends X-Tenant-Host
        self.assertEqual(self.public(HTTP_X_TENANT_HOST=TENANT_DOMAIN), config.DISABLED)
        # hosts nobody has claimed get nothing either
        with override_settings(PLATFORM_HOSTS=['*']):
            self.assertEqual(self.public(host='random-site.example.org'), config.DISABLED)


SHELL = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Eventlaya</title>
  </head>
  <body><div id="root"></div></body>
</html>"""


class VerificationTagTests(Base):
    def setUp(self):
        super().setUp()
        self.dist = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dist, True)
        with open(os.path.join(self.dist, 'index.html'), 'w') as fh:
            fh.write(SHELL)
        os.makedirs(os.path.join(self.dist, 'prerender'))
        with open(os.path.join(self.dist, 'prerender', 'index.html'), 'w') as fh:
            # an older prerendered copy with stale tags
            fh.write(SHELL.replace('<title>', '<meta name="google-site-verification" content="old-old-old-old-old-old-1">\n<title>')
                     .replace('<div id="root"></div>', '<div id="root" data-prerendered><h1>Home</h1></div>'))
        overrides = override_settings(FRONTEND_DIST_DIR=self.dist, SEO_SITE_URL='https://eventlaya.com')
        overrides.enable()
        self.addCleanup(overrides.disable)
        html_mod._cache.clear()

    def test_tags_in_homepage_and_server_rendered_pages(self):
        self.save(google_site_verification=GOOGLE_CODE, bing_site_verification=BING_CODE)
        home = self.client.get('/', HTTP_HOST='eventlaya.com')
        self.assertEqual(home.status_code, 200)
        body = home.content.decode()
        self.assertIn('data-prerendered', body)  # the prerendered copy is served
        self.assertIn(f'<meta name="google-site-verification" content="{GOOGLE_CODE}">', body)
        self.assertIn(f'<meta name="msvalidate.01" content="{BING_CODE}">', body)
        self.assertNotIn('old-old-old', body)
        self.assertEqual(body.count('google-site-verification'), 1)
        # HEAD works too (uptime checks)
        self.assertEqual(self.client.head('/', HTTP_HOST='eventlaya.com').status_code, 200)
        # pages Django renders from the shell (e.g. the blog list, unknown events) carry them as well
        blog = self.client.get('/e/does-not-exist', HTTP_HOST='eventlaya.com').content.decode()
        self.assertIn(GOOGLE_CODE, blog)

    def test_no_tags_when_empty_and_never_on_tenant_sites(self):
        body = self.client.get('/', HTTP_HOST='eventlaya.com').content.decode()
        self.assertNotIn('google-site-verification', body)  # the stale one is removed too
        self.make_tenant()
        self.save(google_site_verification=GOOGLE_CODE)
        body = self.client.get('/', HTTP_HOST=TENANT_DOMAIN).content.decode()
        self.assertNotIn('google-site-verification', body)
