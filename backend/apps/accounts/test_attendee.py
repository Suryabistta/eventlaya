from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import EmailVerificationCode, SocialAccount
from apps.accounts.social import Identity, SocialAuthError
from apps.events.models import Event, EventTicket
from apps.marketplace.models import VenueInquiry, VenueListing

User = get_user_model()


def make_user(email, role='attendee', password='pw-12345678', **kw):
    return User.objects.create_user(username=email, email=email, password=password, role=role, **kw)


def make_event(organizer, slug='fest', days=3, **kw):
    return Event.objects.create(organizer=organizer, title=slug.title(), slug=slug, location='Dharan',
                                start_date=timezone.localdate() + timedelta(days=days),
                                status=Event.Status.PUBLISHED, **kw)


def code_from_outbox():
    return mail.outbox[-1].subject.split()[0]


class AttendeeSignupTests(APITestCase):
    def test_attendee_signup_gets_attendee_role_and_a_code(self):
        res = self.client.post('/api/auth/register/', {
            'email': 'Asha@x.com', 'password': 'password123', 'account_type': 'attendee',
            'first_name': 'Asha', 'last_name': 'Rai', 'terms': True,
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        user = User.objects.get(email='Asha@x.com')
        self.assertEqual((user.role, user.marketplace_access, user.first_name), ('attendee', 'none', 'Asha'))
        self.assertFalse(res.json()['email_verified'])
        self.assertEqual(len(mail.outbox), 1)
        self.assertRegex(code_from_outbox(), r'^\d{6}$')

    def test_default_is_still_organizer(self):
        self.client.post('/api/auth/register/', {'email': 'o@x.com', 'password': 'password123', 'terms': True}, format='json')
        self.assertEqual(User.objects.get(email='o@x.com').role, 'organizer')

    def test_cannot_sign_up_as_staff_or_superadmin(self):
        res = self.client.post('/api/auth/register/', {'email': 'o@x.com', 'password': 'password123',
                                                       'account_type': 'superadmin', 'terms': True}, format='json')
        self.assertEqual(res.status_code, 400)


class EmailVerificationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = make_user('asha@x.com')
        self.client.force_authenticate(self.user)

    def send(self):
        return self.client.post('/api/auth/email/send-code/')

    def test_verify_links_guest_tickets_case_insensitively(self):
        org = make_user('org@x.com', 'organizer')
        guest = EventTicket.generate_ticket(make_event(org), 'Asha', 'ASHA@x.com')
        other = EventTicket.generate_ticket(make_event(org, 'other'), 'B', 'b@x.com')
        venue = VenueListing.objects.create(owner=org, name='Hall', slug='hall', address='x', contact_person='x',
                                            contact_phone='1', description='x')
        inquiry = VenueInquiry.objects.create(venue=venue, sender_name='A', sender_email='asha@X.com',
                                              sender_phone='1', event_date='2030-01-01', message='hi')
        self.assertEqual(self.send().status_code, 200)
        res = self.client.post('/api/auth/email/verify/', {'code': code_from_outbox()}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data['linked_tickets'], 1)
        self.assertTrue(res.data['user']['email_verified'])
        self.user.refresh_from_db()
        self.assertTrue(self.user.email_verified)
        self.assertIsNotNone(self.user.email_verified_at)
        guest.refresh_from_db(); other.refresh_from_db(); inquiry.refresh_from_db()
        self.assertEqual(guest.user, self.user)
        self.assertIsNone(other.user)
        self.assertEqual(inquiry.user, self.user)
        self.assertTrue(self.client.get('/api/auth/me/').data['email_verified'])

    def test_wrong_code_counts_attempts_then_locks(self):
        self.send()
        real = code_from_outbox()
        wrong = '000000' if real != '000000' else '111111'
        for left in (4, 3, 2, 1, 0):
            res = self.client.post('/api/auth/email/verify/', {'code': wrong}, format='json')
            self.assertEqual(res.status_code, 400)
            self.assertEqual(res.data['attempts_left'], left)
        res = self.client.post('/api/auth/email/verify/', {'code': real}, format='json')
        self.assertEqual(res.status_code, 429)
        self.user.refresh_from_db()
        self.assertFalse(self.user.email_verified)

    def test_expired_and_replaced_codes_fail(self):
        self.send()
        first = code_from_outbox()
        EmailVerificationCode.objects.update(created_at=timezone.now() - timedelta(minutes=2))
        self.send()
        res = self.client.post('/api/auth/email/verify/', {'code': first}, format='json')
        self.assertEqual(res.status_code, 400)  # superseded by the second code (unless identical by chance)
        EmailVerificationCode.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        res = self.client.post('/api/auth/email/verify/', {'code': code_from_outbox()}, format='json')
        self.assertEqual(res.data['code'], 'code_expired')

    def test_rate_limits(self):
        self.assertEqual(self.send().status_code, 200)
        res = self.send()
        self.assertEqual(res.status_code, 429)
        self.assertGreater(res.data['retry_after'], 0)
        # Five per hour, even when spaced a minute apart
        for i in range(4):
            EmailVerificationCode.objects.update(created_at=timezone.now() - timedelta(minutes=2 + i))
            self.assertEqual(self.send().status_code, 200)
        EmailVerificationCode.objects.filter(pk=EmailVerificationCode.objects.first().pk).update(
            created_at=timezone.now() - timedelta(minutes=2))
        self.assertEqual(self.send().status_code, 429)

    def test_already_verified(self):
        self.user.email_verified = True
        self.user.save()
        self.assertEqual(self.send().data['code'], 'already_verified')

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.send().status_code, 401)


class ProfileTests(APITestCase):
    def setUp(self):
        self.user = make_user('asha@x.com', first_name='Asha')
        self.client.force_authenticate(self.user)

    def test_me_shape(self):
        data = self.client.get('/api/auth/me/').data
        for key in ('email_verified', 'email_verified_at', 'has_password', 'social_providers', 'first_name',
                    'last_name', 'full_name', 'avatar', 'city', 'phone', 'role'):
            self.assertIn(key, data)
        self.assertTrue(data['has_password'])

    def test_patch_profile_and_avatar(self):
        path = f'/media/uploads/avatar/{self.user.id}/abc.jpg'
        res = self.client.patch('/api/auth/me/', {'first_name': ' Asha ', 'last_name': 'Rai', 'phone': '98000',
                                                  'city': 'Itahari', 'avatar_url': path,
                                                  'role': 'superadmin', 'email': 'evil@x.com'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.user.refresh_from_db()
        self.assertEqual((self.user.first_name, self.user.last_name, self.user.city), ('Asha', 'Rai', 'Itahari'))
        self.assertEqual((self.user.role, self.user.email), ('attendee', 'asha@x.com'))
        self.assertEqual(self.user.avatar.name, f'uploads/avatar/{self.user.id}/abc.jpg')
        self.assertEqual(res.data['avatar'], path)
        self.client.patch('/api/auth/me/', {'avatar_url': ''}, format='json')
        self.user.refresh_from_db()
        self.assertFalse(self.user.avatar)

    def test_avatar_must_be_own_upload(self):
        other = make_user('b@x.com')
        for bad in (f'/media/uploads/avatar/{other.id}/a.jpg', 'https://evil.com/a.jpg', f'/media/uploads/../{self.user.id}/x'):
            res = self.client.patch('/api/auth/me/', {'avatar_url': bad}, format='json')
            self.assertEqual(res.status_code, 400, bad)


class PasswordTests(APITestCase):
    def setUp(self):
        self.user = make_user('asha@x.com')
        self.client.force_authenticate(self.user)

    def test_change_password(self):
        res = self.client.post('/api/auth/password/', {'current_password': 'nope', 'new_password': 'N3w-pass-word'}, format='json')
        self.assertEqual(res.data['code'], 'wrong_password')
        res = self.client.post('/api/auth/password/', {'current_password': 'pw-12345678', 'new_password': '123'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('new_password', res.data)
        res = self.client.post('/api/auth/password/', {'current_password': 'pw-12345678', 'new_password': 'N3w-pass-word'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('N3w-pass-word'))

    def test_social_only_account_can_set_password(self):
        self.user.set_unusable_password()
        self.user.save()
        res = self.client.post('/api/auth/password/', {'new_password': 'N3w-pass-word'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['message'], 'Password set.')


class AccountDeletionTests(APITestCase):
    def setUp(self):
        self.user = make_user('asha@x.com')
        self.client.force_authenticate(self.user)

    def delete(self, **body):
        return self.client.delete('/api/auth/me/', body, format='json')

    def test_attendee_delete_keeps_tickets(self):
        org = make_user('org@x.com', 'organizer')
        ticket = EventTicket.generate_ticket(make_event(org), 'Asha', 'asha@x.com', user=self.user)
        self.assertEqual(self.delete(password='wrong').data['code'], 'wrong_password')
        self.assertEqual(self.delete(password='pw-12345678').status_code, 204)
        self.assertFalse(User.objects.filter(email='asha@x.com').exists())
        ticket.refresh_from_db()
        self.assertIsNone(ticket.user)
        self.assertEqual(ticket.attendee_email, 'asha@x.com')

    def test_social_only_needs_confirm_flag(self):
        self.user.set_unusable_password()
        self.user.save()
        self.assertEqual(self.delete().data['code'], 'confirmation_required')
        self.assertEqual(self.delete(confirm=True).status_code, 204)

    def test_organizer_with_registrations_is_blocked(self):
        org = make_user('org@x.com', 'organizer')
        event = make_event(org)
        self.client.force_authenticate(org)
        EventTicket.generate_ticket(event, 'A', 'a@x.com')
        res = self.delete(password='pw-12345678')
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['code'], 'organizer_has_registrations')
        self.assertTrue(Event.objects.filter(pk=event.pk).exists())

    def test_organizer_without_registrations_can_delete(self):
        org = make_user('org@x.com', 'organizer')
        make_event(org)
        self.client.force_authenticate(org)
        self.assertEqual(self.delete(password='pw-12345678').status_code, 204)

    def test_listing_owner_with_inquiries_is_blocked(self):
        vendor = make_user('v@x.com', 'vendor')
        venue = VenueListing.objects.create(owner=vendor, name='Hall', slug='hall', address='x', contact_person='x',
                                            contact_phone='1', description='x')
        VenueInquiry.objects.create(venue=venue, sender_name='A', sender_email='a@x.com', sender_phone='1',
                                    event_date='2030-01-01', message='hi', user=self.user)
        self.client.force_authenticate(vendor)
        self.assertEqual(self.delete(password='pw-12345678').data['code'], 'listings_have_inquiries')
        # The person who sent the inquiry can delete; the inquiry stays with the venue
        self.client.force_authenticate(self.user)
        self.assertEqual(self.delete(password='pw-12345678').status_code, 204)
        self.assertIsNone(VenueInquiry.objects.get().user)

    def test_superadmin_cannot_delete_in_app(self):
        admin = make_user('ad@x.com', 'superadmin')
        self.client.force_authenticate(admin)
        self.assertEqual(self.delete(password='pw-12345678').status_code, 403)


GOOGLE = {'GOOGLE_CLIENT_IDS': ['web-id', 'android-id'], 'FACEBOOK_APP_ID': '', 'FACEBOOK_APP_SECRET': ''}
FACEBOOK = {'GOOGLE_CLIENT_IDS': [], 'FACEBOOK_APP_ID': '123', 'FACEBOOK_APP_SECRET': 'shh'}


def google_identity(email='asha@x.com', uid='g-1', verified=True):
    return Identity(provider='google', uid=uid, email=email, email_verified=verified, first_name='Asha', last_name='Rai')


@override_settings(**GOOGLE)
class SocialLoginTests(APITestCase):
    url = '/api/auth/social/google/'

    def setUp(self):
        cache.clear()

    def login(self, identity=None, **body):
        with mock.patch('apps.accounts.social.verify_google_token', return_value=identity or google_identity()) as m:
            res = self.client.post(self.url, {'id_token': 'tok', **body}, format='json')
        return res, m

    def test_config(self):
        data = self.client.get('/api/auth/social/config/').data
        self.assertEqual(data['enabled'], ['google'])
        self.assertEqual(data['google']['client_ids'], ['web-id', 'android-id'])
        self.assertFalse(data['facebook']['enabled'])
        self.assertNotIn('apple', data)

    @override_settings(GOOGLE_CLIENT_IDS=[])
    def test_not_configured(self):
        res = self.client.post(self.url, {'id_token': 'x'}, format='json')
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data['code'], 'provider_not_configured')

    def test_new_user_becomes_verified_attendee_and_gets_tickets(self):
        org = make_user('org@x.com', 'organizer')
        ticket = EventTicket.generate_ticket(make_event(org), 'Asha', 'Asha@x.com')
        res, m = self.login()
        self.assertEqual(res.status_code, 201, res.content)
        m.assert_called_once_with('tok')
        self.assertTrue(res.data['created'])
        self.assertEqual(res.data['linked_tickets'], 1)
        for key in ('access', 'refresh', 'user'):
            self.assertIn(key, res.data)
        user = User.objects.get(email='asha@x.com')
        self.assertEqual((user.role, user.first_name), ('attendee', 'Asha'))
        self.assertTrue(user.email_verified)
        self.assertFalse(user.has_usable_password())
        self.assertEqual(res.data['user']['social_providers'], ['google'])
        ticket.refresh_from_db()
        self.assertEqual(ticket.user, user)
        # Second login reuses the link
        res, _ = self.login()
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['created'])
        self.assertEqual(SocialAccount.objects.count(), 1)
        # Token works
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        self.assertEqual(self.client.get('/api/auth/me/').data['email'], 'asha@x.com')

    def test_web_credential_field_accepted(self):
        with mock.patch('apps.accounts.social.verify_google_token', return_value=google_identity()) as m:
            res = self.client.post(self.url, {'credential': 'cred'}, format='json')
        self.assertEqual(res.status_code, 201)
        m.assert_called_once_with('cred')

    def test_links_existing_verified_account_keeping_password(self):
        user = make_user('asha@x.com', 'organizer', email_verified=True)
        res, _ = self.login(google_identity(email='ASHA@x.com'))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['user']['id'], str(user.id))
        user.refresh_from_db()
        self.assertEqual(user.role, 'organizer')
        self.assertTrue(user.check_password('pw-12345678'))

    def test_unverified_existing_account_loses_password(self):
        user = make_user('asha@x.com')  # could have been created by someone squatting the address
        res, _ = self.login()
        self.assertEqual(res.status_code, 200)
        user.refresh_from_db()
        self.assertFalse(user.has_usable_password())
        self.assertTrue(user.email_verified)

    def test_admin_and_staff_accounts_are_never_linked(self):
        for role in ('superadmin', 'staff'):
            make_user(f'{role}@x.com', role)
            res, _ = self.login(google_identity(email=f'{role}@x.com', uid=role))
            self.assertEqual(res.status_code, 403, role)
            self.assertEqual(res.data['code'], 'password_login_required')
        self.assertEqual(SocialAccount.objects.count(), 0)

    def test_unverified_or_missing_email(self):
        res, _ = self.login(google_identity(verified=False))
        self.assertEqual(res.data['code'], 'email_not_verified')
        res, _ = self.login(google_identity(email=''))
        self.assertEqual(res.data['code'], 'email_required')

    def test_invalid_token(self):
        err = SocialAuthError('bad', 'invalid_token', 401)
        with mock.patch('apps.accounts.social.verify_google_token', side_effect=err):
            res = self.client.post(self.url, {'id_token': 'x'}, format='json')
        self.assertEqual(res.status_code, 401)
        self.assertEqual(self.client.post(self.url, {}, format='json').data['code'], 'token_required')

    def test_inactive_account(self):
        make_user('asha@x.com', email_verified=True, is_active=False)
        res, _ = self.login()
        self.assertEqual(res.data['code'], 'account_disabled')

    def test_short_session(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        res, _ = self.login(remember=False)
        self.assertIn('session_end', RefreshToken(res.data['refresh']).payload)

    def test_google_verifier_checks_audience(self):
        from apps.accounts.social import verify_google_token
        claims = {'iss': 'https://accounts.google.com', 'aud': 'someone-else', 'sub': '1', 'email': 'a@x.com',
                  'email_verified': True}
        with mock.patch('google.oauth2.id_token.verify_oauth2_token', return_value=claims):
            with self.assertRaises(SocialAuthError):
                verify_google_token('t')
            claims['aud'] = 'android-id'
            identity = verify_google_token('t')
        self.assertEqual((identity.uid, identity.email, identity.email_verified), ('1', 'a@x.com', True))


class FakeResponse:
    def __init__(self, data):
        self.data = data

    def json(self):
        return self.data


@override_settings(**FACEBOOK)
class FacebookLoginTests(APITestCase):
    url = '/api/auth/social/facebook/'

    def setUp(self):
        cache.clear()

    def fb(self, debug, me):
        def fake_get(url, params=None, timeout=None):
            self.assertIsNotNone(timeout)
            return FakeResponse({'data': debug} if url.endswith('debug_token') else me)
        return mock.patch('apps.accounts.social.requests.get', side_effect=fake_get)

    def test_login_creates_account(self):
        with self.fb({'is_valid': True, 'app_id': '123', 'user_id': '55'}, {'id': '55', 'email': 'f@x.com', 'first_name': 'F'}):
            res = self.client.post(self.url, {'access_token': 'tok'}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(SocialAccount.objects.get().provider_uid, '55')

    def test_token_for_another_app_is_rejected(self):
        with self.fb({'is_valid': True, 'app_id': '999', 'user_id': '55'}, {'id': '55', 'email': 'f@x.com'}):
            res = self.client.post(self.url, {'access_token': 'tok'}, format='json')
        self.assertEqual(res.status_code, 401)

    def test_missing_email(self):
        with self.fb({'is_valid': True, 'app_id': '123', 'user_id': '55'}, {'id': '55'}):
            res = self.client.post(self.url, {'access_token': 'tok'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'email_required')

    def test_network_failure_is_503(self):
        import requests
        with mock.patch('apps.accounts.social.requests.get', side_effect=requests.Timeout()):
            res = self.client.post(self.url, {'access_token': 'tok'}, format='json')
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data['code'], 'provider_unavailable')


@override_settings(TERMS_VERSION='2026-10-28', **GOOGLE)
class TermsConsentTests(APITestCase):
    """Sign-up records consent to the Terms of Service + Privacy Policy (terms_accepted_at / terms_version)."""

    def setUp(self):
        cache.clear()

    def register(self, **extra):
        body = {'email': 'new@x.com', 'password': 'password123', 'account_type': 'attendee', 'first_name': 'Asha'}
        body.update(extra)
        return self.client.post('/api/auth/register/', body, format='json')

    def test_email_signup_records_consent(self):
        before = timezone.now()
        res = self.register(terms=True)
        self.assertEqual(res.status_code, 201, res.content)
        self.assertNotIn('terms', res.data)  # write-only
        user = User.objects.get(email='new@x.com')
        self.assertEqual(user.terms_version, '2026-10-28')
        self.assertGreaterEqual(user.terms_accepted_at, before)
        self.client.force_authenticate(user)
        me = self.client.get('/api/auth/me/').data
        self.assertEqual(me['terms_version'], '2026-10-28')
        self.assertIsNotNone(me['terms_accepted_at'])

    def test_signup_without_consent_is_refused(self):
        for extra in ({}, {'terms': False}):
            res = self.register(**extra)
            self.assertEqual(res.status_code, 400, extra)
            self.assertIn('Terms of Service', str(res.data['terms'][0]))
        self.assertFalse(User.objects.filter(email='new@x.com').exists())
        self.assertEqual(len(mail.outbox), 0)

    def test_consent_fields_are_read_only(self):
        user = make_user('asha@x.com')
        self.client.force_authenticate(user)
        self.client.patch('/api/auth/me/', {'terms_version': 'hacked', 'terms_accepted_at': '2020-01-01T00:00:00Z'},
                          format='json')
        user.refresh_from_db()
        self.assertEqual((user.terms_version, user.terms_accepted_at), ('', None))

    def social_login(self, identity):
        with mock.patch('apps.accounts.social.verify_google_token', return_value=identity):
            return self.client.post('/api/auth/social/google/', {'id_token': 'tok'}, format='json')

    def test_first_social_sign_in_records_consent(self):
        res = self.social_login(google_identity())
        self.assertEqual(res.status_code, 201, res.content)
        user = User.objects.get(email='asha@x.com')
        self.assertEqual(user.terms_version, '2026-10-28')
        self.assertEqual(res.data['user']['terms_version'], '2026-10-28')
        first = user.terms_accepted_at
        self.assertIsNotNone(first)
        # Later sign-ins keep the original consent time
        with override_settings(TERMS_VERSION='2027-01-01'):
            self.social_login(google_identity())
        user.refresh_from_db()
        self.assertEqual((user.terms_accepted_at, user.terms_version), (first, '2026-10-28'))

    def test_existing_account_linking_social_records_consent_once(self):
        user = make_user('asha@x.com', email_verified=True)
        self.assertEqual(self.social_login(google_identity()).status_code, 200)
        user.refresh_from_db()
        self.assertEqual(user.terms_version, '2026-10-28')

    def test_refused_social_sign_in_records_nothing(self):
        staff = make_user('asha@x.com', 'staff', email_verified=True)
        self.assertEqual(self.social_login(google_identity()).status_code, 403)
        staff.refresh_from_db()
        self.assertIsNone(staff.terms_accepted_at)

    def test_config_exposes_terms_version(self):
        self.assertEqual(self.client.get('/api/auth/social/config/').data['terms_version'], '2026-10-28')
