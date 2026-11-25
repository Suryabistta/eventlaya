import re
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

from apps.voting import sms
from apps.voting.sms import SMSError

User = get_user_model()
SEND = '/api/auth/phone/send-code/'
REGISTER = '/api/auth/register/'


class PhoneCodeSignupTests(APITestCase):
    def setUp(self):
        cache.clear()
        sms.console_outbox.clear()

    def send(self, phone='+977 980-0000000'):
        return self.client.post(SEND, {'phone': phone}, format='json')

    def last_code(self):
        return re.match(r'(\d{6})', sms.console_outbox[-1][1]).group(1)

    def register(self, **extra):
        body = {'email': 'new@x.com', 'password': 'password123', 'account_type': 'attendee', 'first_name': 'Asha',
                'phone': '9800000000', 'terms': True}
        body.update(extra)
        return self.client.post(REGISTER, body, format='json', HTTP_X_EVENTLAYA_CLIENT='app')

    def test_code_is_texted_and_signup_marks_phone_verified(self):
        res = self.send()
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['phone'], '9800000000')
        self.assertEqual(sms.console_outbox[-1][0], '9800000000')
        res = self.register(phone='+977-9800000000', phone_code=self.last_code())
        self.assertEqual(res.status_code, 201, res.data)
        user = User.objects.get(email='new@x.com')
        self.assertTrue(user.phone_verified)
        self.assertEqual(user.phone, '9800000000')
        # the code works once
        res = self.register(email='other@x.com', phone_code=self.last_code())
        self.assertEqual(res.status_code, 400)

    def test_signup_without_or_with_wrong_code_is_refused(self):
        self.send()
        self.assertIn('phone_code', self.register().data)
        res = self.register(phone_code='000000' if self.last_code() != '000000' else '111111')
        self.assertEqual(res.status_code, 400)
        self.assertIn('tries left', str(res.data['phone_code']))
        self.assertFalse(User.objects.filter(email='new@x.com').exists())

    def test_too_many_wrong_codes_needs_a_new_code(self):
        self.send()
        wrong = '000000' if self.last_code() != '000000' else '111111'
        for _ in range(5):
            self.register(phone_code=wrong)
        res = self.register(phone_code=self.last_code())
        self.assertIn('Too many', str(res.data), res.data)

    def test_code_for_another_number_does_not_work(self):
        self.send('9811111111')
        res = self.register(phone_code=self.last_code())
        self.assertEqual(res.status_code, 400)

    def test_invalid_number_and_resend_limit(self):
        self.assertEqual(self.send('12345').status_code, 400)
        self.assertEqual(self.send().status_code, 200)
        res = self.send()
        self.assertEqual(res.status_code, 429)
        self.assertGreater(res.data['retry_after'], 0)

    def test_sms_failure_is_reported(self):
        with mock.patch('apps.accounts.phone_verification.send_sms', side_effect=SMSError('no balance')):
            res = self.send()
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data['code'], 'sms_failed')

    def test_changing_phone_in_profile_clears_verified(self):
        self.send()
        self.register(phone_code=self.last_code())
        user = User.objects.get(email='new@x.com')
        self.client.force_authenticate(user)
        self.client.patch('/api/auth/me/', {'phone': '9822222222'}, format='json')
        user.refresh_from_db()
        self.assertFalse(user.phone_verified)
