from unittest import mock

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import Plan, SmsCreditEntry
from .sms_credits import balance, segments, send_paid_sms

User = get_user_model()


def make_user(email, role):
    return User.objects.create_user(username=email.split('@')[0], email=email, password='pw-123456', role=role)


class SmsCreditTests(APITestCase):
    def setUp(self):
        self.admin = make_user('admin@x.com', 'superadmin')
        self.org = make_user('org@x.com', 'organizer')

    def test_segments(self):
        self.assertEqual(segments('a' * 160), 1)
        self.assertEqual(segments('a' * 161), 2)
        self.assertEqual(segments('नमस्ते' * 12), 2)  # Nepali: 70 characters per SMS

    def test_request_approve_and_decline(self):
        self.client.force_authenticate(self.org)
        r = self.client.post('/api/platform/sms/requests/', {'credits': 1000, 'note': 'Paid by eSewa'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(self.client.post('/api/platform/sms/requests/', {'credits': 5}, format='json').status_code, 400)  # one at a time
        self.assertEqual(self.client.post(f'/api/platform/sms/requests/{r.data["id"]}/approve/', {}, format='json').status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get('/api/platform/stats/').data['pending']['sms_credits'], 1)
        ok = self.client.post(f'/api/platform/sms/requests/{r.data["id"]}/approve/', {'credits': 800}, format='json')
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(balance(self.org), 800)  # the admin may grant a different amount
        self.assertEqual(self.client.post(f'/api/platform/sms/requests/{r.data["id"]}/approve/', {}, format='json').status_code, 400)
        self.client.force_authenticate(self.org)
        r2 = self.client.post('/api/platform/sms/requests/', {'credits': 50}, format='json')
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(f'/api/platform/sms/requests/{r2.data["id"]}/decline/', {}, format='json').status_code, 400)
        self.assertEqual(self.client.post(f'/api/platform/sms/requests/{r2.data["id"]}/decline/', {'note': 'Not paid'}, format='json').status_code, 200)
        self.client.force_authenticate(self.org)
        mine = self.client.get('/api/platform/sms/mine/').data
        self.assertEqual(mine['balance'], 800)
        self.assertEqual([x['status'] for x in mine['requests']], ['declined', 'approved'])

    def test_admin_adds_and_takes_back(self):
        self.client.force_authenticate(self.admin)
        url = f'/api/platform/sms/orgs/{self.org.id}/'
        self.assertEqual(self.client.post(url, {'credits': 100, 'note': 'Launch gift'}, format='json').data['balance'], 100)
        self.assertEqual(self.client.post(url, {'credits': -500}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url, {'credits': -40}, format='json').data['balance'], 60)

    def test_plan_payment_includes_sms(self):
        Plan.objects.filter(code='event_pro').update(sms_credits=500)
        self.client.force_authenticate(self.admin)
        r = self.client.post(f'/api/platform/billing/subscriptions/{self.org.id}/record-payment/',
                             {'plan': 'event_pro', 'billing_cycle': 'monthly', 'months': 3, 'amount': 4500, 'method': 'esewa'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(balance(self.org), 1500)
        self.assertEqual(self.client.patch('/api/platform/billing/plans/event_pro/sms/', {'sms_credits': 800}, format='json').data['sms_credits'], 800)

    def test_sending_uses_credits_and_stops_when_empty(self):
        SmsCreditEntry.objects.create(organization=self.org, kind='top_up', credits=2)
        with mock.patch('apps.core.sms.sms_enabled', return_value=True), mock.patch('apps.core.sms.send_sms', return_value=True) as send:
            self.assertTrue(send_paid_sms(self.org, '9812345678', 'Hello'))
            self.assertTrue(send_paid_sms(self.org, '9812345678', 'Hello again'))
            self.assertFalse(send_paid_sms(self.org, '9812345678', 'No credits left'))
        self.assertEqual(send.call_count, 2)
        self.assertEqual(balance(self.org), 0)

    def test_failed_send_refunds(self):
        SmsCreditEntry.objects.create(organization=self.org, kind='top_up', credits=5)
        with mock.patch('apps.core.sms.sms_enabled', return_value=True), mock.patch('apps.core.sms.send_sms', return_value=False):
            self.assertFalse(send_paid_sms(self.org, '9812345678', 'x' * 200))
        self.assertEqual(balance(self.org), 5)
