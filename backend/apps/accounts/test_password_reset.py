import re
import time

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()


class PasswordResetTests(APITestCase):
    def setUp(self):
        cache.clear()  # reset throttle counters between tests
        self.user = User.objects.create_user(username='r', email='reset@x.com', password='OldPassword1')

    def request_link(self, email='reset@x.com'):
        return self.client.post('/api/auth/password-reset/', {'email': email}, format='json')

    def link_params(self):
        body = mail.outbox[-1].body
        return dict(re.findall(r'(uid|token)=([^&\s]+)', body))

    def test_same_answer_for_known_and_unknown_emails(self):
        known = self.request_link()
        unknown = self.request_link('nobody@x.com')
        self.assertEqual(known.status_code, 200)
        self.assertEqual(known.data, unknown.data)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('/reset-password?uid=', mail.outbox[0].body)

    def test_link_resets_password_once(self):
        self.request_link()
        p = self.link_params()
        self.assertTrue(self.client.get('/api/auth/password-reset/confirm/', p).data['valid'])

        res = self.client.post('/api/auth/password-reset/confirm/', {**p, 'new_password': 'BrandNew#2026'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('BrandNew#2026'))

        # The same link can't be used again
        again = self.client.post('/api/auth/password-reset/confirm/', {**p, 'new_password': 'Another#2026'}, format='json')
        self.assertEqual(again.status_code, 400)

    def test_rejects_bad_token_and_weak_password(self):
        self.request_link()
        p = self.link_params()
        bad = self.client.post('/api/auth/password-reset/confirm/', {**p, 'token': 'nope', 'new_password': 'BrandNew#2026'}, format='json')
        self.assertEqual(bad.status_code, 400)
        weak = self.client.post('/api/auth/password-reset/confirm/', {**p, 'new_password': '123'}, format='json')
        self.assertEqual(weak.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('OldPassword1'))

    def test_throttled_after_five_requests(self):
        codes = [self.request_link('nobody@x.com').status_code for _ in range(6)]
        self.assertEqual(codes[-1], 429)

    def test_using_a_link_is_not_blocked_by_the_request_limit(self):
        self.request_link()
        p = self.link_params()
        for _ in range(5):
            self.request_link('nobody@x.com')
        self.assertEqual(self.client.get('/api/auth/password-reset/confirm/', p).status_code, 200)


class RememberMeTests(APITestCase):
    def setUp(self):
        User.objects.create_user(username='m', email='m@x.com', password='password123')

    def login(self, **extra):
        return self.client.post('/api/auth/login/', {'email': 'm@x.com', 'password': 'password123', **extra}, format='json')

    def test_remember_me_gets_long_session(self):
        refresh = RefreshToken(self.login(remember=True).data['refresh'])
        self.assertGreater(refresh['exp'] - time.time(), 20 * 86400)
        self.assertNotIn('session_end', refresh.payload)

    def test_without_remember_session_is_short_and_rotation_does_not_extend_it(self):
        first = RefreshToken(self.login(remember=False).data['refresh'])
        self.assertLess(first['exp'] - time.time(), 13 * 3600)

        res = self.client.post('/api/auth/refresh/', {'refresh': str(first)}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        rotated = RefreshToken(res.data['refresh'])
        self.assertEqual(rotated['exp'], first['exp'])
