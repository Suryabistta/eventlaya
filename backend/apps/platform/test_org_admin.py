from django.core import mail
from rest_framework import status

from apps.marketplace.models import VendorCategory, VendorProfile
from .models import AdminAction
from .tests import PlatformTestBase, User, make_user

ORGS = '/api/platform/organizations/'


class CreateOrganizationTests(PlatformTestBase):
    def test_superadmin_creates_org_and_welcome_email_sent(self):
        self.as_(self.admin)
        r = self.client.post(ORGS, {'organization_name': 'Dharan Film Festival', 'email': 'DFF@x.com', 'city': 'Dharan', 'is_verified': True})
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.assertTrue(r.data['email_sent'])
        self.assertNotIn('set_password_link', r.data)
        user = User.objects.get(email='dff@x.com')
        self.assertEqual(user.role, 'organizer')
        self.assertTrue(user.is_verified)
        self.assertFalse(user.has_usable_password())
        self.assertIn('/reset-password?uid=', mail.outbox[-1].body)
        self.assertEqual(set(AdminAction.objects.filter(target=user).values_list('kind', flat=True)), {'created', 'verified'})

    def test_vendor_gets_marketplace_access(self):
        self.as_(self.admin)
        self.client.post(ORGS, {'organization_name': 'Boom Sound', 'email': 'boom@x.com', 'role': 'vendor'})
        self.assertTrue(User.objects.get(email='boom@x.com').has_marketplace_access)

    def test_duplicate_email_and_bad_role_rejected(self):
        self.as_(self.admin)
        self.assertEqual(self.client.post(ORGS, {'organization_name': 'X', 'email': 'ORG@x.com'}).status_code, 400)
        self.assertEqual(self.client.post(ORGS, {'organization_name': 'X', 'email': 'new@x.com', 'role': 'superadmin'}).status_code, 400)

    def test_non_admin_forbidden(self):
        self.as_(self.org)
        self.assertEqual(self.client.post(ORGS, {'organization_name': 'X', 'email': 'n@x.com'}).status_code, 403)


class ResetPasswordTests(PlatformTestBase):
    def login(self, email='org@x.com', password='pw-123456'):
        return self.client.post('/api/auth/login/', {'email': email, 'password': password}, format='json')

    def test_temporary_password_signs_out_and_must_change(self):
        # Tokens from an earlier sign-in (iat has one-second precision, so make them clearly older)
        from rest_framework_simplejwt.tokens import RefreshToken
        old = RefreshToken.for_user(self.org)
        old['iat'] -= 60
        access = old.access_token
        access['iat'] -= 60
        tokens = {'refresh': str(old), 'access': str(access)}
        self.as_(self.admin)
        r = self.client.post(f'{ORGS}{self.org.id}/reset-password/', {'mode': 'temporary'})
        self.assertEqual(r.status_code, 200)
        temp = r.data['temporary_password']

        self.client.force_authenticate(None)
        # Old access and refresh tokens no longer work
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)
        self.client.credentials()
        self.assertEqual(self.client.post('/api/auth/refresh/', {'refresh': tokens['refresh']}, format='json').status_code, 401)

        # New sign-in works and flags the forced change
        r = self.login(password=temp)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['user']['must_change_password'])
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.data['access']}")
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 200)
        self.client.post('/api/auth/password/', {'current_password': temp, 'new_password': 'brand-New-pass-42'}, format='json')
        self.org.refresh_from_db()
        self.assertFalse(self.org.must_change_password)
        self.assertTrue(AdminAction.objects.filter(target=self.org, kind='password_temporary', actor=self.admin).exists())

    def test_email_mode_sends_link(self):
        self.as_(self.admin)
        r = self.client.post(f'{ORGS}{self.org.id}/reset-password/', {'mode': 'email'})
        self.assertTrue(r.data['email_sent'])
        self.assertEqual(mail.outbox[-1].to, ['org@x.com'])
        self.org.refresh_from_db()
        self.assertIsNotNone(self.org.sessions_valid_after)

    def test_cannot_reset_superadmin_or_staff(self):
        self.as_(self.admin)
        other_admin = make_user('admin2@x.com', 'superadmin')
        self.assertEqual(self.client.post(f'{ORGS}{other_admin.id}/reset-password/', {'mode': 'email'}).status_code, 400)
        self.assertEqual(self.client.post(f'{ORGS}{self.staff.id}/reset-password/', {'mode': 'email'}).status_code, 400)

    def test_non_admin_forbidden(self):
        self.as_(self.org2)
        self.assertEqual(self.client.post(f'{ORGS}{self.org.id}/reset-password/', {'mode': 'temporary'}).status_code, 403)


class VerifyTests(PlatformTestBase):
    def test_verify_org_shows_on_public_event_and_detail(self):
        from apps.events.models import Event
        Event.objects.create(organizer=self.org, title='Fest', slug='fest', location='Dharan', start_date='2030-01-01', status='published')
        self.as_(self.admin)
        r = self.client.post(f'{ORGS}{self.org.id}/verify/', {'is_verified': True})
        self.assertTrue(r.data['is_verified'])
        detail = self.client.get(f'{ORGS}{self.org.id}/').data
        self.assertTrue(detail['is_verified'])
        self.assertEqual(detail['admin_actions'][0]['kind'], 'verified')
        self.client.force_authenticate(None)
        ev = self.client.get('/api/events/public/fest/').data['event']
        self.assertTrue(ev['organizer_verified'])
        self.assertTrue(ev['organizer_info']['verified'])

    def test_superadmin_can_verify_a_vendor_listing(self):
        cat = VendorCategory.objects.create(name='Sound', slug='sound')
        v = VendorProfile.objects.create(user=self.org, business_name='Boom', category=cat, phone='1', description='d')
        self.as_(self.admin)
        r = self.client.patch(f'/api/marketplace/vendors/{v.id}/', {'is_verified': True}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        v.refresh_from_db()
        self.assertTrue(v.is_verified)
        self.assertEqual(self.client.get(f'{ORGS}{self.org.id}/').data['listings'][0]['is_verified'], True)

    def test_owner_cannot_verify_self(self):
        self.as_(self.org)
        self.assertEqual(self.client.post(f'{ORGS}{self.org.id}/verify/', {'is_verified': True}).status_code, 403)
        self.client.patch('/api/auth/me/', {'is_verified': True}, format='json')
        self.org.refresh_from_db()
        self.assertFalse(self.org.is_verified)
