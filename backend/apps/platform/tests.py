from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import TenantBranding
from apps.events.models import Event, EventTicket
from .models import WhiteLabelRequest

User = get_user_model()

WL = '/api/platform/white-label/requests/'


def make_user(email, role, **extra):
    return User.objects.create_user(username=email.split('@')[0], email=email, password='pw-123456', role=role, **extra)


class PlatformTestBase(APITestCase):
    def setUp(self):
        self.admin = make_user('admin@x.com', 'superadmin')
        self.org = make_user('org@x.com', 'organizer', organization_name='Dharan Club')
        self.org2 = make_user('org2@x.com', 'organizer', organization_name='Itahari Hall')
        self.staff = make_user('staff@x.com', 'staff')

    def as_(self, user):
        self.client.force_authenticate(user=user)

    def wl_payload(self, **kw):
        data = {
            'requested_domain': 'events.dharanclub.org.np',
            'brand_name': 'Dharan Club',
            'logo_url': 'https://dharanclub.org.np/logo.png',
            'primary_color': '#112233',
            'accent_color': '#445566',
            'remove_watermark': True,
            'note': 'For our annual fest',
        }
        data.update(kw)
        return data


class WhiteLabelRequestTests(PlatformTestBase):
    def test_organizer_can_request(self):
        self.as_(self.org)
        res = self.client.post(WL, self.wl_payload(), format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertEqual(res.data['status'], 'pending')
        self.assertEqual(res.data['primary_color'], '#112233')
        mine = self.client.get(WL + 'mine/')
        self.assertEqual(len(mine.data), 1)

    def test_only_organizers_can_request(self):
        for user in (self.staff, self.admin):
            self.as_(user)
            res = self.client.post(WL, self.wl_payload(), format='json')
            self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.post(WL, self.wl_payload(), format='json').status_code, 401)

    def test_one_pending_request_at_a_time(self):
        self.as_(self.org)
        self.client.post(WL, self.wl_payload(), format='json')
        res = self.client.post(WL, self.wl_payload(), format='json')
        self.assertEqual(res.status_code, 400)

    def test_validation(self):
        self.as_(self.org)
        for bad in (
            {'requested_domain': 'https://foo.com/x'},
            {'requested_domain': 'notadomain'},
            {'requested_domain': 'mine.eventlaya.com'},
            {'primary_color': 'red'},
            {'brand_name': '  '},
        ):
            res = self.client.post(WL, self.wl_payload(**bad), format='json')
            self.assertEqual(res.status_code, 400, bad)

    def test_domain_taken_by_another_org(self):
        TenantBranding.objects.create(organizer=self.org2, subdomain='itahari', custom_domain='events.dharanclub.org.np')
        self.as_(self.org)
        res = self.client.post(WL, self.wl_payload(), format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('requested_domain', res.data)

    def test_mine_only_returns_own(self):
        WhiteLabelRequest.objects.create(organizer=self.org2, brand_name='Other')
        self.as_(self.org)
        self.assertEqual(self.client.get(WL + 'mine/').data, [])

    def test_admin_list_and_permissions(self):
        WhiteLabelRequest.objects.create(organizer=self.org, brand_name='A')
        WhiteLabelRequest.objects.create(organizer=self.org2, brand_name='B', status='rejected')
        self.as_(self.org)
        self.assertEqual(self.client.get(WL).status_code, 403)
        self.as_(self.admin)
        self.assertEqual(len(self.client.get(WL).data), 1)  # pending by default
        self.assertEqual(len(self.client.get(WL + '?status=all').data), 2)
        self.assertEqual(len(self.client.get(WL + '?status=rejected').data), 1)

    def test_approve_copies_onto_branding(self):
        req = WhiteLabelRequest.objects.create(organizer=self.org, **{
            k: v for k, v in self.wl_payload().items()
        })
        self.as_(self.org)
        self.assertEqual(self.client.post(f'{WL}{req.id}/approve/').status_code, 403)
        self.as_(self.admin)
        res = self.client.post(f'{WL}{req.id}/approve/', {'note': 'Looks good'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        req.refresh_from_db()
        self.assertEqual(req.status, 'approved')
        self.assertEqual(req.reviewed_by, self.admin)
        self.assertIsNotNone(req.reviewed_at)
        b = TenantBranding.objects.get(organizer=self.org)
        self.assertEqual(b.custom_domain, 'events.dharanclub.org.np')
        self.assertEqual(b.brand_name, 'Dharan Club')
        self.assertEqual(b.brand_logo, 'https://dharanclub.org.np/logo.png')
        self.assertTrue(b.remove_watermark)
        self.assertFalse(b.is_domain_verified)
        # Can't review twice
        self.assertEqual(self.client.post(f'{WL}{req.id}/approve/').status_code, 400)
        self.assertEqual(self.client.post(f'{WL}{req.id}/reject/', {'note': 'x'}, format='json').status_code, 400)

    def test_approve_creates_unique_subdomain(self):
        TenantBranding.objects.create(organizer=self.org2, subdomain='dharan-club')
        req = WhiteLabelRequest.objects.create(organizer=self.org, brand_name='Dharan Club')
        self.as_(self.admin)
        self.assertEqual(self.client.post(f'{WL}{req.id}/approve/').status_code, 200)
        self.assertEqual(TenantBranding.objects.get(organizer=self.org).subdomain, 'dharan-club-2')

    def test_approve_refuses_domain_now_taken(self):
        req = WhiteLabelRequest.objects.create(organizer=self.org, brand_name='A', requested_domain='a.example.com')
        TenantBranding.objects.create(organizer=self.org2, subdomain='x', custom_domain='a.example.com')
        self.as_(self.admin)
        self.assertEqual(self.client.post(f'{WL}{req.id}/approve/').status_code, 400)
        req.refresh_from_db()
        self.assertEqual(req.status, 'pending')

    def test_reject_requires_note(self):
        req = WhiteLabelRequest.objects.create(organizer=self.org, brand_name='A')
        self.as_(self.org)
        self.assertEqual(self.client.post(f'{WL}{req.id}/reject/', {'note': 'x'}, format='json').status_code, 403)
        self.as_(self.admin)
        self.assertEqual(self.client.post(f'{WL}{req.id}/reject/', {}, format='json').status_code, 400)
        res = self.client.post(f'{WL}{req.id}/reject/', {'note': 'Domain is not yours'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['review_note'], 'Domain is not yours')
        self.assertFalse(TenantBranding.objects.filter(organizer=self.org, custom_domain__isnull=False).exists())


class BrandingLockdownTests(PlatformTestBase):
    VERIFY = '/api/auth/tenant-branding/verify-domain/'
    BRANDING = '/api/auth/tenant-branding/'

    def test_verify_refused_without_approval(self):
        TenantBranding.objects.create(organizer=self.org, subdomain='dc', custom_domain='events.dc.com')
        self.as_(self.org)
        self.assertEqual(self.client.post(self.VERIFY).status_code, 403)

    def test_verify_allowed_after_approval(self):
        req = WhiteLabelRequest.objects.create(organizer=self.org, brand_name='DC', requested_domain='events.dc.com')
        self.as_(self.admin)
        self.client.post(f'{WL}{req.id}/approve/')
        self.as_(self.org)
        from unittest import mock
        with mock.patch('apps.accounts.domains.check_dns', return_value=(True, 'ok')), \
                mock.patch('apps.accounts.domains.https_live', return_value=False):
            res = self.client.post(self.VERIFY)
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(TenantBranding.objects.get(organizer=self.org).is_domain_verified)

    def test_cannot_self_grant_domain_or_watermark(self):
        self.as_(self.org)
        res = self.client.post(self.BRANDING, {
            'brand_name': 'Mine', 'custom_domain': 'sneaky.com', 'remove_watermark': True,
            'is_domain_verified': True, 'ssl_active': True,
        }, format='json')
        self.assertEqual(res.status_code, 200)
        b = TenantBranding.objects.get(organizer=self.org)
        self.assertEqual(b.brand_name, 'Mine')
        self.assertIsNone(b.custom_domain)
        self.assertFalse(b.remove_watermark)
        self.assertFalse(b.is_domain_verified)

    def test_watermark_toggle_allowed_when_approved(self):
        req = WhiteLabelRequest.objects.create(organizer=self.org, brand_name='DC', remove_watermark=True)
        self.as_(self.admin)
        self.client.post(f'{WL}{req.id}/approve/')
        self.as_(self.org)
        self.client.post(self.BRANDING, {'remove_watermark': False}, format='json')
        self.assertFalse(TenantBranding.objects.get(organizer=self.org).remove_watermark)
        self.client.post(self.BRANDING, {'remove_watermark': True}, format='json')
        self.assertTrue(TenantBranding.objects.get(organizer=self.org).remove_watermark)


class StatsOrgsActivityTests(PlatformTestBase):
    def setUp(self):
        super().setUp()
        self.vendor = make_user('vendor@x.com', 'vendor', organization_name='Sound Co')
        today = timezone.localdate()
        self.event = Event.objects.create(
            organizer=self.org, title='Fest', slug='fest', location='Dharan',
            start_date=today + timedelta(days=5), status=Event.Status.PUBLISHED,
        )
        Event.objects.create(organizer=self.org2, title='Draft', slug='draft', location='X', start_date=today)
        t1 = EventTicket.generate_ticket(self.event, 'A', 'a@x.com')
        EventTicket.generate_ticket(self.event, 'B', 'b@x.com')
        t1.first_check_in = timezone.now()
        t1.save()
        WhiteLabelRequest.objects.create(organizer=self.org, brand_name='DC')

    def test_stats_permissions(self):
        for user in (self.org, self.staff, self.vendor):
            self.as_(user)
            self.assertEqual(self.client.get('/api/platform/stats/').status_code, 403)

    def test_stats(self):
        self.as_(self.admin)
        d = self.client.get('/api/platform/stats/').data
        self.assertEqual(d['organizations'], 2)
        self.assertEqual(d['vendors'], 1)
        self.assertEqual(d['events_total'], 2)
        self.assertEqual(d['events_published'], 1)
        self.assertEqual(d['events_upcoming'], 1)
        self.assertEqual(d['registrations_total'], 2)
        self.assertEqual(d['checkins_total'], 1)
        self.assertEqual(d['pending']['white_label'], 1)
        self.assertIn('marketplace_access', d['pending'])
        self.assertIn('listings', d['pending'])
        self.assertEqual(len(d['signups_by_day']), 30)
        self.assertEqual(sum(x['organizers'] for x in d['signups_by_day']), 2)
        self.assertEqual(sum(x['vendors'] for x in d['signups_by_day']), 1)
        self.assertEqual(sum(x['count'] for x in d['registrations_by_day']), 2)
        self.assertEqual(d['top_organizations'][0]['name'], 'Dharan Club')
        self.assertEqual(d['top_organizations'][0]['registrations'], 2)

    def test_organizations_filters(self):
        url = '/api/platform/organizations/'
        self.as_(self.org)
        self.assertEqual(self.client.get(url).status_code, 403)
        self.as_(self.admin)
        rows = self.client.get(url).data
        self.assertEqual({r['email'] for r in rows}, {'org@x.com', 'org2@x.com', 'vendor@x.com'})
        dc = next(r for r in rows if r['email'] == 'org@x.com')
        self.assertEqual((dc['events'], dc['registrations']), (1, 2))
        self.assertEqual(len(self.client.get(url + '?type=vendor').data), 1)
        self.assertEqual(len(self.client.get(url + '?search=itahari').data), 1)
        self.vendor.is_active = False
        self.vendor.save()
        self.assertEqual([r['email'] for r in self.client.get(url + '?status=suspended').data], ['vendor@x.com'])
        self.assertEqual(len(self.client.get(url + '?status=active').data), 2)

    def test_organization_detail(self):
        self.as_(self.admin)
        res = self.client.get(f'/api/platform/organizations/{self.org.id}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['events_list']), 1)
        self.assertEqual(res.data['checkins'], 1)
        self.assertEqual(res.data['white_label']['status'], 'pending')
        self.assertEqual(self.client.get(f'/api/platform/organizations/{self.staff.id}/').status_code, 404)

    def test_suspend_activate(self):
        url = f'/api/platform/organizations/{self.org.id}/'
        self.as_(self.org2)
        self.assertEqual(self.client.post(url + 'suspend/').status_code, 403)
        self.as_(self.admin)
        res = self.client.post(url + 'suspend/')
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['is_active'])
        self.org.refresh_from_db()
        self.assertFalse(self.org.is_active)
        self.assertTrue(self.client.post(url + 'activate/').data['is_active'])
        # Never on superadmins or non-organization accounts
        self.assertEqual(self.client.post(f'/api/platform/organizations/{self.admin.id}/suspend/').status_code, 400)
        self.assertEqual(self.client.post(f'/api/platform/organizations/{self.staff.id}/suspend/').status_code, 400)

    def test_activity(self):
        self.as_(self.org)
        self.assertEqual(self.client.get('/api/platform/activity/').status_code, 403)
        self.as_(self.admin)
        items = self.client.get('/api/platform/activity/').data
        kinds = {i['kind'] for i in items}
        self.assertTrue({'signup', 'event_published', 'white_label_requested'} <= kinds)
        self.assertLessEqual(len(items), 50)
        ats = [i['at'] for i in items]
        self.assertEqual(ats, sorted(ats, reverse=True))
