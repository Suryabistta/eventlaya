"""Online payments core: providers (mocked HTTP), the exactly-once settle, expiry, endpoints, reports."""
import base64
import json
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import requests
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import PlatformModule
from apps.accounts.modules import clear_cache

from . import services
from .models import PaymentIntent, PaymentLog, PaymentSettings, Payout
from .providers import (
    Esewa, Khalti, LookupResult, available_providers, decode_esewa_response, esewa_amount, esewa_signature,
    esewa_signed_message,
)
from .registry import get_purpose, register_purpose

User = get_user_model()
S = PaymentIntent.Status

SANDBOX = dict(
    KHALTI_SECRET_KEY='test_secret', KHALTI_BASE_URL='https://dev.khalti.com/api/v2/',
    ESEWA_PRODUCT_CODE='EPAYTEST', ESEWA_SECRET_KEY='8gBm/:&EnhH.1/q',
    ESEWA_FORM_URL='https://rc-epay.esewa.com.np/api/epay/main/v2/form',
    ESEWA_STATUS_URL='https://rc.esewa.com.np/api/epay/transaction/status/',
    PAYMENTS_ENABLED_PROVIDERS=['khalti', 'esewa'], PAYMENTS_TEST_PROVIDER=True,
    PAYMENTS_CALLBACK_BASE_URL='https://api.example.com', FRONTEND_URL='https://eventlaya.example',
)


class FakeResp:
    def __init__(self, status_code=200, data=None):
        self.status_code, self._data = status_code, data
        self.text = json.dumps(data) if data is not None else ''

    def json(self):
        if self._data is None:
            raise ValueError('no json')
        return self._data


# A purpose for the generic tests: records calls
CALLS = []


def _paid(intent):
    CALLS.append(('paid', str(intent.id)))


def _failed(intent):
    CALLS.append(('failed', str(intent.id), intent.status))


def _refunded(intent):
    CALLS.append(('refunded', str(intent.id)))


def _describe(intent):
    return {'thing': intent.reference}


register_purpose('unit_test', on_paid=_paid, on_failed=_failed, on_refunded=_refunded, describe=_describe)


def esewa_data(intent, status='COMPLETE', total=None, secret='8gBm/:&EnhH.1/q', tamper=None):
    data = {
        'transaction_code': '000AWEO', 'status': status, 'total_amount': total or esewa_amount(intent.amount),
        'transaction_uuid': intent.provider_ref, 'product_code': 'EPAYTEST',
        'signed_field_names': 'transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names',
    }
    data['signature'] = esewa_signature(esewa_signed_message(data, data['signed_field_names']), secret)
    if tamper:
        data.update(tamper)
    return base64.b64encode(json.dumps(data).encode()).decode()


@override_settings(**SANDBOX)
class Base(APITestCase):
    def setUp(self):
        CALLS.clear()
        clear_cache()
        self.org = User.objects.create_user(username='org', email='org@test.com', password='x', role='organizer')

    def intent(self, amount='500', **kw):
        kw.setdefault('organizer', self.org)
        return services.create_intent(purpose='unit_test', amount=amount, description='2 tickets · Fest', reference='R1',
                                      payer_name='Asha', payer_email='asha@test.com', payer_phone='9800000001',
                                      return_url='https://eventlaya.example/e/fest/register', **kw)


class SignatureTests(TestCase):
    def test_esewa_signature(self):
        # The docs' input string with the UAT key. (The result printed in the docs, 4Ov7…, doesn't match their
        # current UAT key; this value was checked against the live rc-epay sandbox, which accepts it and answers
        # ES104 "Invalid payload signature" for a wrong one.)
        msg = esewa_signed_message({'total_amount': '100', 'transaction_uuid': '11-201-13', 'product_code': 'EPAYTEST'},
                                   'total_amount,transaction_uuid,product_code')
        self.assertEqual(msg, 'total_amount=100,transaction_uuid=11-201-13,product_code=EPAYTEST')
        self.assertEqual(esewa_signature(msg, '8gBm/:&EnhH.1/q'), '5DZywcrTKD0gia/rsSMcrRHmJl+4Tbol6S+lWgdJ94E=')

    def test_esewa_amount_format(self):
        self.assertEqual(esewa_amount(Decimal('500.00')), '500')
        self.assertEqual(esewa_amount(Decimal('99.5')), '99.50')

    @override_settings(ESEWA_SECRET_KEY='8gBm/:&EnhH.1/q')
    def test_decode_docs_response_detects_foreign_signature(self):
        # The docs' sample response was signed with another merchant's key: decodes, but the signature fails
        sample = ('eyJ0cmFuc2FjdGlvbl9jb2RlIjoiMExENUNFSCIsInN0YXR1cyI6IkNPTVBMRVRFIiwidG90YWxfYW1vdW50IjoiMSwwMDAuMCIsInRy'
                  'YW5zYWN0aW9uX3V1aWQiOiIyNDA2MTMtMTM0MjMxIiwicHJvZHVjdF9jb2RlIjoiTlAtRVMtQUJISVNIRUstRVBBWSIsInNpZ25lZF9m'
                  'aWVsZF9uYW1lcyI6InRyYW5zYWN0aW9uX2NvZGUsc3RhdHVzLHRvdGFsX2Ftb3VudCx0cmFuc2FjdGlvbl91dWlkLHByb2R1Y3RfY29k'
                  'ZSxzaWduZWRfZmllbGRfbmFtZXMiLCJzaWduYXR1cmUiOiJNcHd5MFRGbEhxcEpqRlVER2ljKzIybWRvZW5JVFQrQ2N6MUxDNjFxTUFj'
                  'PSJ9')
        data, ok = decode_esewa_response(sample)
        self.assertEqual(data['transaction_code'], '0LD5CEH')
        self.assertEqual(data['total_amount'], '1,000.0')
        self.assertFalse(ok)
        self.assertEqual(decode_esewa_response('not base64!!'), ({}, False))


class ProviderAvailabilityTests(TestCase):
    @override_settings(**{**SANDBOX, 'KHALTI_SECRET_KEY': '', 'PAYMENTS_TEST_PROVIDER': False})
    def test_provider_without_keys_is_not_offered(self):
        self.assertEqual([p.id for p in available_providers()], ['esewa'])

    @override_settings(**{**SANDBOX, 'PAYMENTS_TEST_PROVIDER': False, 'PAYMENTS_ENABLED_PROVIDERS': ['khalti', 'test']})
    def test_test_provider_needs_its_flag(self):
        self.assertEqual([p.id for p in available_providers()], ['khalti'])

    @override_settings(**SANDBOX)
    def test_all_sandbox(self):
        self.assertEqual([p.id for p in available_providers()], ['khalti', 'esewa', 'test'])
        self.assertTrue(all(p.sandbox() for p in available_providers()))


class KhaltiTests(Base):
    @mock.patch('apps.payments.providers.requests.post')
    def test_initiate_sends_paisa_and_key(self, post):
        post.return_value = FakeResp(200, {'pidx': 'PIDX1', 'payment_url': 'https://test-pay.khalti.com/?pidx=PIDX1',
                                           'expires_at': '2026-10-28T12:00:00+05:45', 'expires_in': 1800})
        intent = self.intent('512.50')
        checkout = services.start_checkout(intent, 'khalti')
        self.assertEqual(checkout['redirect_url'], 'https://test-pay.khalti.com/?pidx=PIDX1')
        url = post.call_args.args[0]
        body, headers = post.call_args.kwargs['json'], post.call_args.kwargs['headers']
        self.assertEqual(url, 'https://dev.khalti.com/api/v2/epayment/initiate/')
        self.assertEqual(headers['Authorization'], 'Key test_secret')
        self.assertEqual(body['amount'], 51250)
        self.assertEqual(body['purchase_order_id'], str(intent.id))
        self.assertEqual(body['return_url'], f'https://api.example.com/api/payments/return/khalti/{intent.id}/')
        self.assertEqual(body['website_url'], 'https://eventlaya.example/')
        self.assertEqual(body['customer_info'], {'name': 'Asha', 'email': 'asha@test.com', 'phone': '9800000001'})
        intent.refresh_from_db()
        self.assertEqual((intent.status, intent.provider, intent.provider_ref), (S.PENDING, 'khalti', 'PIDX1'))
        # The key never lands in the audit log
        self.assertNotIn('test_secret', json.dumps(list(PaymentLog.objects.values_list('data', flat=True))))

    @mock.patch('apps.payments.providers.requests.post')
    def test_initiate_error_is_shown(self, post):
        post.return_value = FakeResp(400, {'amount': ['Amount should be greater than Rs. 10, that is 1000 paisa.'],
                                           'error_key': 'validation_error'})
        intent = self.intent('50')
        with self.assertRaises(services.PaymentError) as ctx:
            services.start_checkout(intent, 'khalti')
        self.assertIn('Rs. 10', ctx.exception.message)
        self.assertEqual(PaymentIntent.objects.get(pk=intent.pk).status, S.CREATED)
        # The provider's answer survives the rollback, so support can see why checkout failed
        error_log = PaymentLog.objects.get(intent=intent, kind='checkout_error')
        self.assertIn('Rs. 10', error_log.message)
        self.assertEqual(error_log.data['http_status'], 400)
        self.assertIn('Rs. 10', error_log.data['response']['amount'][0])

    @mock.patch('apps.payments.providers.requests.post', side_effect=requests.ConnectionError('down'))
    def test_initiate_network_error(self, post):
        with self.assertRaises(services.PaymentError) as ctx:
            services.start_checkout(self.intent(), 'khalti')
        self.assertEqual(ctx.exception.code, 502)

    def test_khalti_minimum(self):
        with self.assertRaises(services.PaymentError):
            services.start_checkout(self.intent('9'), 'khalti')

    def _pending(self, amount='500'):
        intent = self.intent(amount)
        PaymentIntent.objects.filter(pk=intent.pk).update(provider='khalti', provider_ref='PIDX1', status=S.PENDING)
        return PaymentIntent.objects.get(pk=intent.pk)

    def lookup(self, post, status, code=200, amount=50000, txn='TXN1', refunded=False):
        post.return_value = FakeResp(code, {'pidx': 'PIDX1', 'total_amount': amount, 'status': status,
                                            'transaction_id': txn, 'fee': 300, 'refunded': refunded})

    @mock.patch('apps.payments.providers.requests.post')
    def test_lookup_states(self, post):
        cases = [
            ('Completed', 200, S.PAID), ('Pending', 200, S.PENDING), ('Initiated', 200, S.PENDING),
            ('Expired', 400, S.EXPIRED), ('User canceled', 400, S.CANCELLED), ('Refunded', 200, S.FAILED),
            ('Partially Refunded', 200, S.FAILED),
        ]
        for khalti_status, code, expected in cases:
            with self.subTest(khalti_status):
                CALLS.clear()
                intent = self._pending()
                self.lookup(post, khalti_status, code, txn=None if expected != S.PAID else 'TXN1')
                intent = services.verify(intent)
                self.assertEqual(intent.status, expected)
                if expected == S.PAID:
                    self.assertEqual(intent.provider_txn_id, 'TXN1')
                    self.assertEqual(intent.provider_fee, Decimal('3'))
                    self.assertEqual(CALLS, [('paid', str(intent.id))])
                elif expected == S.PENDING:
                    self.assertEqual(CALLS, [])
                else:
                    self.assertEqual(CALLS, [('failed', str(intent.id), expected)])

    @mock.patch('apps.payments.providers.requests.post')
    def test_refunded_after_paid(self, post):
        intent = self._pending()
        self.lookup(post, 'Completed')
        services.verify(intent)
        self.lookup(post, 'Refunded', refunded=True)
        intent = services.verify(PaymentIntent.objects.get(pk=intent.pk))
        self.assertEqual(intent.status, S.REFUNDED)
        self.assertEqual([c[0] for c in CALLS], ['paid', 'refunded'])

    @mock.patch('apps.payments.providers.requests.post')
    def test_amount_mismatch_is_not_accepted(self, post):
        intent = self._pending('500')
        self.lookup(post, 'Completed', amount=1000)  # Rs 10 instead of Rs 500
        intent = services.verify(intent)
        self.assertEqual(intent.status, S.PENDING)
        self.assertEqual(CALLS, [])
        self.assertTrue(intent.logs.filter(kind='tamper').exists())

    @mock.patch('apps.payments.providers.requests.post')
    def test_not_found_and_network_errors_change_nothing(self, post):
        intent = self._pending()
        post.return_value = FakeResp(404, {'detail': 'Not found.', 'error_key': 'validation_error'})
        self.assertEqual(services.verify(intent).status, S.PENDING)
        post.side_effect = requests.Timeout('slow')
        self.assertEqual(services.verify(intent).status, S.PENDING)
        self.assertTrue(intent.logs.filter(kind='verify_error').exists())

    @mock.patch('apps.payments.providers.requests.post')
    def test_double_return_settles_once(self, post):
        intent = self._pending()
        self.lookup(post, 'Completed')
        url = f'/api/payments/return/khalti/{intent.id}/?pidx=PIDX1&status=Completed&purchase_order_id={intent.id}'
        r1 = self.client.get(url)
        r2 = self.client.get(url)
        for r in (r1, r2):
            self.assertEqual(r.status_code, 302)
            self.assertEqual(r['Location'], f'https://eventlaya.example/e/fest/register?payment={intent.id}&status=paid')
        self.assertEqual(CALLS, [('paid', str(intent.id))])
        # Polling afterwards doesn't re-run it either
        self.client.get(f'/api/payments/intents/{intent.id}/')
        self.assertEqual(len(CALLS), 1)

    @mock.patch('apps.payments.providers.requests.post')
    def test_return_url_status_is_not_trusted(self, post):
        intent = self._pending()
        self.lookup(post, 'Pending', txn=None)
        r = self.client.get(f'/api/payments/return/khalti/{intent.id}/?pidx=PIDX1&status=Completed')
        self.assertTrue(r['Location'].endswith('status=pending'))
        self.assertEqual(CALLS, [])

    @mock.patch('apps.payments.providers.requests.post')
    def test_wrong_pidx_in_return_is_logged(self, post):
        intent = self._pending()
        self.lookup(post, 'Pending', txn=None)
        self.client.get(f'/api/payments/return/khalti/{intent.id}/?pidx=OTHER&status=Completed')
        self.assertTrue(intent.logs.filter(kind='tamper').exists())


class EsewaTests(Base):
    def test_checkout_form_is_signed(self):
        intent = self.intent('1500')
        checkout = services.start_checkout(intent, 'esewa')
        f = checkout['fields']
        self.assertEqual(checkout['form_action'], 'https://rc-epay.esewa.com.np/api/epay/main/v2/form')
        self.assertEqual((f['amount'], f['total_amount'], f['tax_amount'], f['product_code']), ('1500', '1500', '0', 'EPAYTEST'))
        self.assertRegex(f['transaction_uuid'], r'^[A-Za-z0-9-]+$')
        self.assertEqual(f['success_url'], f'https://api.example.com/api/payments/return/esewa/{intent.id}/success/')
        self.assertEqual(f['failure_url'], f'https://api.example.com/api/payments/return/esewa/{intent.id}/failure/')
        msg = f"total_amount=1500,transaction_uuid={f['transaction_uuid']},product_code=EPAYTEST"
        self.assertEqual(f['signature'], esewa_signature(msg, '8gBm/:&EnhH.1/q'))
        # A reload re-uses the same checkout
        self.assertEqual(services.start_checkout(intent, 'esewa'), checkout)
        with self.assertRaises(services.PaymentError):
            services.start_checkout(intent, 'khalti')  # can't switch mid-way

    def started(self, amount='1500'):
        intent = self.intent(amount)
        services.start_checkout(intent, 'esewa')
        return PaymentIntent.objects.get(pk=intent.pk)

    def status_api(self, get, intent, status, ref='0007G36', total=None):
        get.return_value = FakeResp(200, {'product_code': 'EPAYTEST', 'transaction_uuid': intent.provider_ref,
                                          'total_amount': total if total is not None else float(intent.amount),
                                          'status': status, 'ref_id': ref})

    @mock.patch('apps.payments.providers.requests.get')
    def test_success_return_verifies_signature_and_status(self, get):
        intent = self.started()
        self.status_api(get, intent, 'COMPLETE')
        r = self.client.get(f'/api/payments/return/esewa/{intent.id}/success/?data={esewa_data(intent)}')
        self.assertTrue(r['Location'].endswith(f'payment={intent.id}&status=paid'))
        params = get.call_args.kwargs['params']
        self.assertEqual(params, {'product_code': 'EPAYTEST', 'total_amount': '1500', 'transaction_uuid': intent.provider_ref})
        intent.refresh_from_db()
        self.assertEqual((intent.status, intent.provider_txn_id), (S.PAID, '0007G36'))
        self.assertFalse(intent.logs.filter(kind='tamper').exists())
        self.assertEqual(len(CALLS), 1)

    @mock.patch('apps.payments.providers.requests.get')
    def test_forged_success_data_does_not_pay(self, get):
        intent = self.started()
        self.status_api(get, intent, 'PENDING', ref=None)
        forged = esewa_data(intent, secret='wrong-secret')
        r = self.client.get(f'/api/payments/return/esewa/{intent.id}/success/?data={forged}')
        self.assertTrue(r['Location'].endswith('status=pending'))
        self.assertTrue(intent.logs.filter(kind='tamper', message__contains='bad signature').exists())
        self.assertEqual(CALLS, [])
        # Signed by us but with a changed amount: rejected too (and the status API still decides)
        bad_amount = esewa_data(intent, total='15')
        self.client.get(f'/api/payments/return/esewa/{intent.id}/success/?data={bad_amount}')
        self.assertTrue(intent.logs.filter(kind='tamper', message__contains='amount').exists())
        self.assertEqual(PaymentIntent.objects.get(pk=intent.pk).status, S.PENDING)

    @mock.patch('apps.payments.providers.requests.get')
    def test_status_api_amount_mismatch(self, get):
        intent = self.started()
        self.status_api(get, intent, 'COMPLETE', total=15.0)
        self.assertEqual(services.verify(intent).status, S.PENDING)
        self.assertEqual(CALLS, [])

    @mock.patch('apps.payments.providers.requests.get')
    def test_status_values(self, get):
        for esewa_status, expected in (('COMPLETE', S.PAID), ('PENDING', S.PENDING), ('AMBIGUOUS', S.PENDING),
                                       ('NOT_FOUND', S.PENDING), ('CANCELED', S.CANCELLED), ('FULL_REFUND', S.FAILED),
                                       ('PARTIAL_REFUND', S.FAILED)):
            with self.subTest(esewa_status):
                intent = self.started()
                self.status_api(get, intent, esewa_status)
                self.assertEqual(services.verify(intent).status, expected)

    @mock.patch('apps.payments.providers.requests.get')
    def test_failure_return_cancels_when_esewa_has_nothing(self, get):
        intent = self.started()
        get.return_value = FakeResp(200, {'product_code': 'EPAYTEST', 'transaction_uuid': intent.provider_ref,
                                          'total_amount': 1500.0, 'status': 'NOT_FOUND', 'ref_id': None})
        r = self.client.get(f'/api/payments/return/esewa/{intent.id}/failure/')
        self.assertTrue(r['Location'].endswith('status=cancelled'))
        self.assertEqual(CALLS, [('failed', str(intent.id), S.CANCELLED)])

    @mock.patch('apps.payments.providers.requests.get')
    def test_failure_return_keeps_pending_payment_open(self, get):
        intent = self.started()
        self.status_api(get, intent, 'PENDING', ref=None)
        r = self.client.get(f'/api/payments/return/esewa/{intent.id}/failure/')
        self.assertTrue(r['Location'].endswith('status=pending'))

    @mock.patch('apps.payments.providers.requests.get')
    def test_service_unavailable(self, get):
        intent = self.started()
        get.return_value = FakeResp(200, {'code': 0, 'error_message': 'Service is currently unavailable'})
        self.assertEqual(services.verify(intent).status, S.PENDING)
        self.assertTrue(intent.logs.filter(kind='verify_error', message__contains='unavailable').exists())


class SettleTests(Base):
    def test_mark_paid_is_idempotent_and_records_fee(self):
        PaymentSettings.objects.update_or_create(pk=1, defaults={'platform_fee_percent': Decimal('2.5')})
        intent = self.intent('400')
        services.mark_paid(intent, 'T1')
        services.mark_paid(intent, 'T1')
        intent.refresh_from_db()
        self.assertEqual(CALLS, [('paid', str(intent.id))])
        self.assertEqual((intent.platform_fee_percent, intent.platform_fee, intent.net_amount),
                         (Decimal('2.50'), Decimal('10.00'), Decimal('390.00')))
        self.assertIsNotNone(intent.fulfilled_at)

    def test_failing_handler_is_retried(self):
        boom = {'n': 0}

        def flaky(intent):
            boom['n'] += 1
            if boom['n'] == 1:
                raise RuntimeError('mail server down')
        register_purpose('flaky', on_paid=flaky)
        intent = services.create_intent(purpose='flaky', amount='100', description='x')
        services.mark_paid(intent)
        intent.refresh_from_db()
        self.assertEqual(intent.status, S.PAID)
        self.assertIsNone(intent.fulfilled_at)
        self.assertEqual(services.expire_stale(check_provider=False)['fulfilled'], 1)
        self.assertEqual(boom['n'], 2)
        self.assertEqual(services.expire_stale(check_provider=False)['fulfilled'], 0)

    def test_close_runs_on_failed_once_and_not_after_paid(self):
        intent = self.intent()
        services.close(intent, S.CANCELLED)
        services.close(intent, S.EXPIRED)
        self.assertEqual(CALLS, [('failed', str(intent.id), S.CANCELLED)])
        paid = self.intent()
        services.mark_paid(paid)
        services.close(paid, S.EXPIRED)
        self.assertEqual(PaymentIntent.objects.get(pk=paid.pk).status, S.PAID)

    def test_late_payment_after_expiry_still_settles(self):
        intent = self.intent()
        services.close(intent, S.EXPIRED, 'Not paid in time')
        services.apply_result(intent, LookupResult('paid', 'Completed', 'T9', Decimal('500')))
        intent.refresh_from_db()
        self.assertEqual(intent.status, S.PAID)
        self.assertTrue(intent.logs.filter(kind='late_payment').exists())
        self.assertEqual([c[0] for c in CALLS], ['failed', 'paid'])

    @mock.patch('apps.payments.providers.requests.post')
    def test_expire_stale_asks_the_provider_first(self, post):
        paid, unpaid = self.intent(), self.intent()
        past = timezone.now() - timedelta(minutes=1)
        PaymentIntent.objects.filter(pk=paid.pk).update(provider='khalti', provider_ref='PAID1', status=S.PENDING, expires_at=past)
        PaymentIntent.objects.filter(pk=unpaid.pk).update(provider='khalti', provider_ref='OPEN1', status=S.PENDING, expires_at=past)

        def lookup(url, json, headers, timeout):
            done = json['pidx'] == 'PAID1'
            return FakeResp(200 if done else 400, {'pidx': json['pidx'], 'total_amount': 50000,
                                                   'status': 'Completed' if done else 'Expired', 'transaction_id': 'T',
                                                   'fee': 0, 'refunded': False})
        post.side_effect = lookup
        counts = services.expire_stale()
        self.assertEqual(PaymentIntent.objects.get(pk=paid.pk).status, S.PAID)
        self.assertEqual(PaymentIntent.objects.get(pk=unpaid.pk).status, S.EXPIRED)
        self.assertEqual((counts['paid'], counts['expired']), (1, 1))

    def test_expire_without_provider_and_command(self):
        from django.core.management import call_command
        from io import StringIO
        intent = self.intent()
        PaymentIntent.objects.filter(pk=intent.pk).update(expires_at=timezone.now() - timedelta(seconds=5))
        out = StringIO()
        call_command('expire_payments', '--no-provider-check', stdout=out)
        self.assertIn('expired: 1', out.getvalue())
        self.assertEqual(PaymentIntent.objects.get(pk=intent.pk).status, S.EXPIRED)

    def test_refund_only_when_paid(self):
        intent = self.intent()
        with self.assertRaises(services.PaymentError):
            services.mark_refunded(intent, note='x')
        services.mark_paid(intent)
        services.mark_refunded(intent, self.org, 'Returned via Khalti dashboard on 28 Oct')
        intent.refresh_from_db()
        self.assertEqual((intent.status, intent.refund_note), (S.REFUNDED, 'Returned via Khalti dashboard on 28 Oct'))
        self.assertEqual(intent.logs.get(kind='refunded').actor, self.org)

    def test_registry(self):
        self.assertIsNotNone(get_purpose('ticket_order'))  # registered by the events app
        with self.assertRaises(ValueError):
            services.create_intent(purpose='nope', amount='1', description='x')
        with self.assertRaises(ValueError):
            services.create_intent(purpose='unit_test', amount='0', description='x')

    def test_safe_return_url(self):
        self.assertEqual(services.safe_return_url('https://eventlaya.example/e/x/register?step=4&payment=old'),
                         'https://eventlaya.example/e/x/register?step=4')
        self.assertEqual(services.safe_return_url('javascript:alert(1)'), '')
        with override_settings(PLATFORM_HOSTS=['eventlaya.com']):
            self.assertEqual(services.safe_return_url('https://evil.example/steal'), '')


class EndpointTests(Base):
    def test_test_provider_flow(self):
        intent = self.intent()
        r = self.client.post(f'/api/payments/intents/{intent.id}/checkout/', {'provider': 'test'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        page = r.data['checkout']['redirect_url']
        self.assertEqual(page, f'https://api.example.com/api/payments/test/{intent.id}/')
        self.assertContains(self.client.get(f'/api/payments/test/{intent.id}/'), 'TEST MODE')
        r = self.client.post(f'/api/payments/test/{intent.id}/', {'outcome': 'paid'})
        self.assertEqual(r['Location'], f'/api/payments/return/test/{intent.id}/')
        r = self.client.get(r['Location'])
        self.assertTrue(r['Location'].endswith('status=paid'))
        status = self.client.get(f'/api/payments/intents/{intent.id}/').data
        self.assertEqual((status['status'], status['result']), ('paid', {'thing': 'R1'}))

    @override_settings(PAYMENTS_TEST_PROVIDER=False)
    def test_test_provider_off_in_production(self):
        intent = self.intent()
        r = self.client.post(f'/api/payments/intents/{intent.id}/checkout/', {'provider': 'test'}, format='json')
        self.assertEqual(r.status_code, 400)
        PaymentIntent.objects.filter(pk=intent.pk).update(provider='test', status=S.PENDING)
        self.assertEqual(self.client.get(f'/api/payments/test/{intent.id}/').status_code, 404)

    def test_status_poll_expires_old_intents(self):
        intent = self.intent()
        PaymentIntent.objects.filter(pk=intent.pk).update(expires_at=timezone.now() - timedelta(minutes=5))
        self.assertEqual(self.client.get(f'/api/payments/intents/{intent.id}/').data['status'], 'expired')

    def test_providers_and_module_switch(self):
        self.assertEqual([p['id'] for p in self.client.get('/api/payments/providers/').data['providers']], ['khalti', 'esewa', 'test'])
        PlatformModule.objects.filter(slug='payments').update(is_globally_enabled=False)
        clear_cache()
        r = self.client.get('/api/payments/providers/')
        self.assertEqual((r.status_code, r.json()['code']), (403, 'module_disabled'))
        # Money already in flight still settles: returns and status polls stay open
        intent = self.intent()
        self.assertEqual(self.client.get(f'/api/payments/intents/{intent.id}/').status_code, 200)
        self.assertEqual(self.client.post(f'/api/payments/intents/{intent.id}/checkout/', {'provider': 'test'}).status_code, 403)

    def test_organizer_list_csv_and_refund(self):
        other = User.objects.create_user(username='o2', email='o2@test.com', password='x', role='organizer')
        mine, theirs = self.intent('300'), self.intent('700', organizer=other)
        services.mark_paid(mine, 'TX1')
        services.mark_paid(theirs, 'TX2')
        self.client.force_authenticate(self.org)
        data = self.client.get('/api/payments/organizer/payments/').data
        self.assertEqual([r['id'] for r in data['results']], [str(mine.id)])
        self.assertEqual(data['totals']['collected'], '300.00')
        csv_text = self.client.get('/api/payments/organizer/payments/?export=csv').content.decode()
        self.assertIn('TX1', csv_text)
        self.assertNotIn('TX2', csv_text)
        summary = self.client.get('/api/payments/organizer/summary/').data
        self.assertEqual(summary['totals']['owed'], '300.00')
        self.assertEqual(self.client.post(f'/api/payments/intents/{theirs.id}/refund/', {'note': 'x'}).status_code, 403)
        self.assertEqual(self.client.post(f'/api/payments/intents/{mine.id}/refund/', {}).status_code, 400)
        r = self.client.post(f'/api/payments/intents/{mine.id}/refund/', {'note': 'Back to Khalti wallet'})
        self.assertEqual(r.data['status'], 'refunded')
        attendee = User.objects.create_user(username='a', email='a@test.com', password='x', role='attendee')
        self.client.force_authenticate(attendee)
        self.assertEqual(self.client.get('/api/payments/organizer/payments/').status_code, 403)

    def test_superadmin_overview_settings_payouts(self):
        admin = User.objects.create_user(username='sa', email='sa@test.com', password='x', role='superadmin')
        intent = self.intent('1000')
        services.mark_paid(intent)
        self.client.force_authenticate(self.org)
        self.assertEqual(self.client.get('/api/payments/admin/overview/').status_code, 403)
        self.client.force_authenticate(admin)
        r = self.client.put('/api/payments/admin/settings/', {'platform_fee_percent': '3', 'reservation_minutes': 20}, format='json')
        self.assertEqual(r.data, {'platform_fee_percent': '3.00', 'reservation_minutes': 20})
        self.assertEqual(self.client.put('/api/payments/admin/settings/', {'platform_fee_percent': '90'}, format='json').status_code, 400)
        r = self.client.post('/api/payments/admin/payouts/', {'organizer': self.org.id, 'amount': '400', 'method': 'bank',
                                                              'reference': 'NIC-123', 'paid_on': '2026-10-28'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        o = self.client.get('/api/payments/admin/overview/').data
        self.assertEqual(o['totals']['collected'], '1000.00')
        self.assertEqual(o['organizers'][0]['owed'], '600.00')
        self.assertEqual({p['id'] for p in o['providers']}, {'khalti', 'esewa', 'test'})
        self.assertIn('Organizer', self.client.get('/api/payments/admin/payments/?export=csv').content.decode())
        detail = self.client.get(f'/api/payments/admin/payments/{intent.id}/').data
        self.assertEqual([l['kind'] for l in detail['logs']][:2], ['created', 'paid'])
        self.assertEqual(Payout.objects.count(), 1)


class MyPaymentsTests(Base):
    """GET /api/payments/mine/ — the signed-in payer's own payments, on every device."""

    def setUp(self):
        super().setUp()
        self.asha = User.objects.create_user(username='asha', email='asha@test.com', password='x', role='attendee')
        self.bob = User.objects.create_user(username='bob', email='bob@test.com', password='x', role='attendee')

    def mine(self, user=None):
        if user is not None:
            self.client.force_authenticate(user=user)
        return self.client.get('/api/payments/mine/')

    def test_own_payments_only_newest_first_and_payer_safe(self):
        first = self.intent('300', user=self.asha)
        services.start_checkout(first, 'test')
        services.mark_paid(first, 'TX-ASHA')
        second = self.intent('150', user=self.asha)
        services.start_checkout(second, 'test')
        self.intent('999', user=self.asha)  # abandoned before checkout (created): left out
        theirs = services.create_intent(purpose='unit_test', amount='700', description='Bob', reference='R2',
                                        payer_email='bob@test.com', user=self.bob, organizer=self.org)
        services.start_checkout(theirs, 'test')
        r = self.mine(self.asha)
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['count'], 2)
        self.assertEqual([x['id'] for x in r.data['results']], [str(second.id), str(first.id)])
        row = r.data['results'][1]
        self.assertEqual((row['status'], row['amount'], row['provider'], row['provider_txn_id']), ('paid', '300.00', 'test', 'TX-ASHA'))
        self.assertEqual(row['purpose_label'], 'Unit test')
        for secret in ('payer_phone', 'payer_email', 'metadata', 'checkout', 'organizer', 'platform_fee', 'logs'):
            self.assertNotIn(secret, row)
        self.assertNotIn(str(theirs.id), [x['id'] for x in r.data['results']])
        self.assertEqual(self.mine(self.bob).data['count'], 1)

    def test_signed_out_payments_by_verified_email(self):
        signed_out = self.intent('200')  # payer_email asha@test.com, no user
        services.start_checkout(signed_out, 'test')
        self.assertEqual(self.mine(self.asha).data['count'], 0)  # email not verified yet: not hers
        User.objects.filter(pk=self.asha.pk).update(email_verified=True)
        self.asha.refresh_from_db()
        self.assertEqual([x['id'] for x in self.mine(self.asha).data['results']], [str(signed_out.id)])

    def test_anonymous_is_401(self):
        self.assertEqual(self.client.get('/api/payments/mine/').status_code, 401)

    def test_module_off_is_403(self):
        PlatformModule.objects.filter(slug='payments').update(is_globally_enabled=False)
        clear_cache()
        r = self.mine(self.asha)
        self.assertEqual((r.status_code, r.json()['code']), (403, 'module_disabled'))

    def test_pagination(self):
        for _ in range(3):
            services.start_checkout(self.intent('100', user=self.asha), 'test')
        self.client.force_authenticate(user=self.asha)
        r = self.client.get('/api/payments/mine/?limit=2&offset=2')
        self.assertEqual((r.data['count'], len(r.data['results'])), (3, 1))
