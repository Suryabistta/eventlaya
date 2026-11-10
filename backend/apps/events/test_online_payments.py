"""Online ticket payment: reserve → pay → passes; release on failure/expiry; scanner; organizer orders."""
import base64
import json
from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import PlatformModule, RoleModulePermission
from apps.accounts.modules import clear_cache
from apps.events.models import Event, EventTicket, PromoCode, TicketOrder, TicketType
from apps.payments import services
from apps.payments.models import PaymentIntent
from apps.payments.providers import esewa_signature, esewa_signed_message

User = get_user_model()
T = EventTicket.Status
P = TicketOrder.PaymentStatus

SANDBOX = dict(
    KHALTI_SECRET_KEY='test_secret', KHALTI_BASE_URL='https://dev.khalti.com/api/v2/',
    ESEWA_PRODUCT_CODE='EPAYTEST', ESEWA_SECRET_KEY='8gBm/:&EnhH.1/q',
    ESEWA_FORM_URL='https://rc-epay.esewa.com.np/api/epay/main/v2/form',
    ESEWA_STATUS_URL='https://rc.esewa.com.np/api/epay/transaction/status/',
    PAYMENTS_ENABLED_PROVIDERS=['khalti', 'esewa'], PAYMENTS_TEST_PROVIDER=True,
    PAYMENTS_CALLBACK_BASE_URL='https://api.example.com', FRONTEND_URL='https://eventlaya.example',
)


class FakeResp:
    def __init__(self, status_code, data):
        self.status_code, self._data, self.text = status_code, data, json.dumps(data)

    def json(self):
        return self._data


@override_settings(**SANDBOX)
class OnlineTicketTests(APITestCase):
    def setUp(self):
        clear_cache()
        self.org = User.objects.create_user(username='org', email='org@test.com', password='x', role='organizer')
        self.event = Event.objects.create(
            organizer=self.org, title='Dharan Film Festival', slug='dff', location='Dharan', start_date=date.today(),
            start_time=None, status=Event.Status.PUBLISHED, payment_mode=Event.PaymentMode.BOTH, capacity=10,
        )
        self.general = TicketType.objects.create(event=self.event, name='General', price=Decimal('500'), order=1)
        self.vip = TicketType.objects.create(event=self.event, name='VIP', price=Decimal('1500'), quantity=2, order=2)

    # ---- helpers ----
    def register(self, items=None, method='online', provider='test', email='buyer@test.com', **extra):
        body = {'name': 'Asha Rai', 'email': email, 'phone': '9800000001',
                'items': items or [{'ticket_type_id': str(self.general.id), 'quantity': 2}],
                'payment_method': method, 'provider': provider,
                'return_url': 'https://eventlaya.example/e/dff/register?step=4', **extra}
        return self.client.post(f'/api/forms/events/{self.event.slug}/register/', body, format='json')

    def pay_test(self, intent_id, outcome='paid'):
        self.client.post(f'/api/payments/test/{intent_id}/', {'outcome': outcome})
        with self.captureOnCommitCallbacks(execute=True):  # the order email is sent after commit
            return self.client.get(f'/api/payments/return/test/{intent_id}/')

    def scan(self, ticket):
        self.client.force_authenticate(self.org)
        r = self.client.post(f'/api/events/{self.event.id}/gate/scan/', {'qr_token': ticket.qr_token, 'scan_type': 'gate_in'}, format='json')
        self.client.force_authenticate(None)
        return r

    # ---- tests ----
    def test_public_event_offers_options(self):
        opts = self.client.get('/api/events/public/dff/').data['event']['payment_options']
        self.assertEqual((opts['venue'], opts['online'], opts['mode']), (True, True, 'both'))
        self.assertEqual([p['id'] for p in opts['providers']], ['khalti', 'esewa', 'test'])
        self.assertEqual(opts['hold_minutes'], 15)
        self.event.online_providers = ['esewa']
        self.event.save()
        opts = self.client.get('/api/events/public/dff/').data['event']['payment_options']
        self.assertEqual([p['id'] for p in opts['providers']], ['esewa'])

    def test_online_order_is_reserved_until_paid(self):
        r = self.register()
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(r.data['payment_required'])
        self.assertNotIn('tickets', r.data)  # no passes before payment
        self.assertEqual(r.data['checkout']['redirect_url'], f"https://api.example.com/api/payments/test/{r.data['payment']['id']}/")
        order = TicketOrder.objects.get()
        tickets = list(order.tickets.all())
        self.assertEqual((order.payment_method, order.payment_status, order.total), ('online', P.PENDING, Decimal('1000')))
        self.assertEqual({t.status for t in tickets}, {T.RESERVED})
        self.assertIsNotNone(order.reserved_until)
        self.assertEqual(len(mail.outbox), 0)
        # Holds stock and capacity
        self.assertEqual(self.event.registered_count, 2)
        self.assertEqual(self.general.sold_count, 2)
        # Not valid at the gate
        r = self.scan(tickets[0])
        self.assertEqual((r.status_code, r.data['result'], r.data['status']), (400, 'unpaid', 'cancelled'))
        self.assertIn('payment not completed', r.data['message'].lower())

        intent_id = r_id = order.payment_intent_id
        r = self.pay_test(r_id)
        self.assertEqual(r['Location'], f'https://eventlaya.example/e/dff/register?step=4&payment={intent_id}&status=paid')
        order.refresh_from_db()
        self.assertEqual((order.payment_status, order.paid_via, order.paid_amount), (P.PAID, 'test', Decimal('1000')))
        self.assertEqual(set(order.tickets.values_list('status', flat=True)), {T.VALID})
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('online with Test payment', mail.outbox[0].body)
        self.assertIn(order.payment_reference, mail.outbox[0].body)

        status = self.client.get(f'/api/payments/intents/{intent_id}/').data
        self.assertEqual(status['status'], 'paid')
        self.assertEqual(len(status['result']['tickets']), 2)
        self.assertTrue(status['result']['order']['payment']['label'].startswith('Paid online · Test payment · ref'))
        self.assertEqual(self.scan(tickets[0]).data['result'], 'success')

        # A second return / poll doesn't send another email or change anything
        self.client.get(f'/api/payments/return/test/{intent_id}/')
        self.client.get(f'/api/payments/intents/{intent_id}/')
        self.assertEqual(len(mail.outbox), 1)

    def test_cancelled_payment_releases_tickets_and_allows_retry(self):
        r = self.register(items=[{'ticket_type_id': str(self.vip.id), 'quantity': 2}])
        intent_id = r.data['payment']['id']
        self.assertEqual(self.vip.sold_count, 2)
        r = self.pay_test(intent_id, 'cancelled')
        self.assertTrue(r['Location'].endswith('status=cancelled'))
        order = TicketOrder.objects.get()
        self.assertEqual(order.payment_status, P.FAILED)
        self.assertEqual(set(order.tickets.values_list('status', flat=True)), {T.CANCELLED})
        self.assertEqual(self.vip.sold_count, 0)
        self.assertIn('released', self.scan(order.tickets.first()).data['message'])
        # Retry: not "already registered", and the VIP stock is back
        r = self.register(items=[{'ticket_type_id': str(self.vip.id), 'quantity': 2}])
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(r.data['payment_required'])

    def test_failed_provider_start_releases(self):
        with mock.patch('apps.payments.providers.requests.post', return_value=FakeResp(401, {'detail': 'Invalid token.', 'status_code': 401})):
            r = self.register(provider='khalti')
        self.assertEqual(r.status_code, 502)
        self.assertIn('Invalid token', r.data['error'])
        order = TicketOrder.objects.get()
        self.assertEqual(order.payment_status, P.FAILED)
        self.assertEqual(self.general.sold_count, 0)

    def test_expired_hold_frees_stock(self):
        r = self.register(items=[{'ticket_type_id': str(self.vip.id), 'quantity': 2}])
        order = TicketOrder.objects.get()
        # Sold out while held
        r2 = self.register(items=[{'ticket_type_id': str(self.vip.id), 'quantity': 1}], email='other@test.com')
        self.assertEqual(r2.status_code, 409)
        TicketOrder.objects.filter(pk=order.pk).update(reserved_until=timezone.now() - timedelta(minutes=5))
        PaymentIntent.objects.filter(pk=order.payment_intent_id).update(expires_at=timezone.now() - timedelta(minutes=5))
        # Lazily released on the next registration (the cron does it too)
        r2 = self.register(items=[{'ticket_type_id': str(self.vip.id), 'quantity': 1}], email='other@test.com', method='venue', provider='')
        self.assertEqual(r2.status_code, 201, r2.data)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, P.FAILED)
        self.assertEqual(PaymentIntent.objects.get(pk=order.payment_intent_id).status, 'expired')
        self.assertEqual(self.vip.sold_count, 1)

    def test_expire_command_releases(self):
        self.register()
        order = TicketOrder.objects.get()
        PaymentIntent.objects.filter(pk=order.payment_intent_id).update(expires_at=timezone.now() - timedelta(minutes=1))
        services.expire_stale()  # test provider: still pending → expired
        order.refresh_from_db()
        self.assertEqual(order.payment_status, P.FAILED)
        self.assertEqual(self.event.registered_count, 0)

    def test_late_payment_revives_or_flags(self):
        self.register(items=[{'ticket_type_id': str(self.vip.id), 'quantity': 2}])
        order = TicketOrder.objects.get()
        intent = order.payment_intent
        services.close(intent, 'expired', 'hold ran out')
        # Paid later and there's still room: tickets come back
        services.mark_paid(intent, 'LATE1')
        order.refresh_from_db()
        self.assertEqual((order.payment_status, order.needs_attention), (P.PAID, ''))
        self.assertEqual(set(order.tickets.values_list('status', flat=True)), {T.VALID})

    def test_late_payment_without_room_needs_refund(self):
        self.register(items=[{'ticket_type_id': str(self.vip.id), 'quantity': 2}])
        first = TicketOrder.objects.get()
        services.close(first.payment_intent, 'expired', 'hold ran out')
        r = self.register(items=[{'ticket_type_id': str(self.vip.id), 'quantity': 2}], email='b2@test.com', method='venue', provider='')
        self.assertEqual(r.status_code, 201)
        services.mark_paid(first.payment_intent, 'LATE2')
        first.refresh_from_db()
        self.assertEqual(first.payment_status, P.PAID)
        self.assertIn('sold out', first.needs_attention)
        self.assertEqual(set(first.tickets.values_list('status', flat=True)), {T.CANCELLED})
        self.assertEqual(self.client.get(f'/api/payments/intents/{first.payment_intent_id}/').data['result']['tickets'], [])
        # Organizer refunds it
        self.client.force_authenticate(self.org)
        r = self.client.post(f'/api/events/{self.event.id}/orders/{first.id}/refund/', {'note': 'Refunded via Khalti merchant'})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['payment']['status'], 'refunded')
        self.assertEqual(PaymentIntent.objects.get(pk=first.payment_intent_id).status, 'refunded')

    def test_khalti_end_to_end_with_mocked_api(self):
        with mock.patch('apps.payments.providers.requests.post') as post:
            post.return_value = FakeResp(200, {'pidx': 'PX1', 'payment_url': 'https://test-pay.khalti.com/?pidx=PX1',
                                               'expires_at': '2026-10-28T12:00:00+05:45', 'expires_in': 1800})
            r = self.register(provider='khalti')
            self.assertEqual(r.data['checkout']['redirect_url'], 'https://test-pay.khalti.com/?pidx=PX1')
            self.assertEqual(post.call_args.kwargs['json']['amount'], 100000)
            intent_id = r.data['payment']['id']
            post.return_value = FakeResp(200, {'pidx': 'PX1', 'total_amount': 100000, 'status': 'Completed',
                                               'transaction_id': 'GFq9PFS7b2iYvL8Lir9oXe', 'fee': 0, 'refunded': False})
            with self.captureOnCommitCallbacks(execute=True):
                r = self.client.get(f'/api/payments/return/khalti/{intent_id}/?pidx=PX1&status=Completed&purchase_order_id={intent_id}')
            r2 = self.client.get(f'/api/payments/return/khalti/{intent_id}/?pidx=PX1&status=Completed&purchase_order_id={intent_id}')
        self.assertTrue(r['Location'].endswith('status=paid') and r2['Location'].endswith('status=paid'))
        order = TicketOrder.objects.get()
        self.assertEqual((order.paid_via, order.payment_reference), ('khalti', 'GFq9PFS7b2iYvL8Lir9oXe'))
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('Khalti', mail.outbox[0].body)

    def test_esewa_end_to_end_with_mocked_status(self):
        r = self.register(provider='esewa')
        fields = r.data['checkout']['fields']
        self.assertEqual(fields['total_amount'], '1000')
        intent = PaymentIntent.objects.get(pk=r.data['payment']['id'])
        data = {'transaction_code': '000AWEO', 'status': 'COMPLETE', 'total_amount': '1,000.0',
                'transaction_uuid': intent.provider_ref, 'product_code': 'EPAYTEST',
                'signed_field_names': 'transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names'}
        data['signature'] = esewa_signature(esewa_signed_message(data, data['signed_field_names']))
        encoded = base64.b64encode(json.dumps(data).encode()).decode()
        with mock.patch('apps.payments.providers.requests.get', return_value=FakeResp(200, {
                'product_code': 'EPAYTEST', 'transaction_uuid': intent.provider_ref, 'total_amount': 1000.0,
                'status': 'COMPLETE', 'ref_id': '000AWEO'})):
            r = self.client.get(f'/api/payments/return/esewa/{intent.id}/success/?data={encoded}')
        self.assertTrue(r['Location'].endswith('status=paid'))
        self.assertFalse(intent.logs.filter(kind='tamper').exists())
        order = TicketOrder.objects.get()
        self.assertEqual((order.payment_status, order.paid_via, order.payment_reference), (P.PAID, 'esewa', '000AWEO'))

    def test_promo_applies_before_payment(self):
        PromoCode.objects.create(event=self.event, code='HALF', discount_type='percent', discount_value=Decimal('50'))
        r = self.register(promo_code='HALF')
        self.assertEqual(r.data['payment']['amount'], '500.00')

    def test_free_order_skips_payment(self):
        free = TicketType.objects.create(event=self.event, name='Free entry', price=0, order=3)
        r = self.register(items=[{'ticket_type_id': str(free.id), 'quantity': 1}])
        self.assertEqual(r.status_code, 201)
        self.assertNotIn('payment_required', r.data)
        self.assertEqual(r.data['ticket']['payment']['status'], 'free')
        self.assertEqual(r.data['ticket']['status'], 'valid')

    def test_pay_at_venue_still_works(self):
        r = self.register(method='venue', provider='')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['ticket']['payment']['label'], 'Pay Rs 1,000 at the venue')
        self.assertIn('to pay at the venue', mail.outbox[0].body)
        # Older clients send no payment_method: venue
        r = self.client.post('/api/forms/events/dff/register/', {'name': 'Old', 'email': 'old@test.com',
                                                                 'ticket_type_id': str(self.general.id)}, format='json')
        self.assertEqual(r.status_code, 201)

    def test_online_only_event_and_ticket_type(self):
        self.event.payment_mode = Event.PaymentMode.ONLINE
        self.event.save()
        r = self.register(method='venue', provider='')
        self.assertEqual(r.status_code, 400)
        self.assertIn('online payment only', r.data['error'])
        self.event.payment_mode = Event.PaymentMode.BOTH
        self.event.save()
        self.vip.online_only = True
        self.vip.save()
        r = self.register(items=[{'ticket_type_id': str(self.vip.id), 'quantity': 1}], method='venue', provider='')
        self.assertEqual(r.status_code, 400)
        self.assertIn('VIP tickets must be paid online', r.data['error'])
        self.assertEqual(TicketOrder.objects.count(), 0)

    def test_venue_only_event_refuses_online(self):
        self.event.payment_mode = Event.PaymentMode.VENUE
        self.event.save()
        r = self.register()
        self.assertEqual(r.status_code, 400)
        self.assertIn('not available', r.data['error'])
        self.assertFalse(self.client.get('/api/events/public/dff/').data['event']['payment_options']['online'])

    def test_khalti_minimum_amount(self):
        cheap = TicketType.objects.create(event=self.event, name='Cheap', price=Decimal('5'), order=3)
        r = self.register(items=[{'ticket_type_id': str(cheap.id), 'quantity': 1}], provider='khalti')
        self.assertEqual(r.status_code, 400)
        self.assertIn('Rs 10', r.data['error'])

    def test_module_off_hides_online_but_venue_works(self):
        PlatformModule.objects.filter(slug='payments').update(is_globally_enabled=False)
        clear_cache()
        self.event.payment_mode = Event.PaymentMode.ONLINE
        self.event.save()
        opts = self.client.get('/api/events/public/dff/').data['event']['payment_options']
        self.assertEqual((opts['online'], opts['venue'], opts['providers']), (False, True, []))
        self.assertEqual(self.register().status_code, 400)
        self.assertEqual(self.register(method='venue', provider='').status_code, 201)
        self.client.force_authenticate(self.org)
        self.assertEqual(self.client.get(f'/api/payments/events/{self.event.id}/settings/').status_code, 403)

    def test_module_off_for_organizer_role(self):
        module = PlatformModule.objects.get(slug='payments')
        RoleModulePermission.objects.filter(module=module, role='organizer').update(is_enabled=False)
        clear_cache()
        self.assertFalse(self.client.get('/api/events/public/dff/').data['event']['payment_options']['online'])

    def test_rebuying_drops_unfinished_checkout(self):
        self.register()
        first = TicketOrder.objects.get()
        r = self.register()
        self.assertEqual(r.status_code, 201)
        first.refresh_from_db()
        self.assertEqual(first.payment_status, P.FAILED)
        self.assertEqual(PaymentIntent.objects.get(pk=first.payment_intent_id).status, 'cancelled')
        self.assertEqual(self.event.registered_count, 2)

    def test_signed_in_buyer_is_the_payer_and_sees_it_in_my_payments(self):
        buyer = User.objects.create_user(username='sita', email='sita@test.com', password='x', role='attendee')
        self.client.force_authenticate(buyer)
        r = self.register(email='friend@test.com')  # tickets for someone else's email: the buyer still paid
        self.assertEqual(r.status_code, 201, r.data)
        intent_id = r.data['payment']['id']
        self.assertEqual(PaymentIntent.objects.get(pk=intent_id).user, buyer)
        self.pay_test(intent_id)
        self.client.force_authenticate(buyer)
        mine = self.client.get('/api/payments/mine/').data
        self.assertEqual([x['id'] for x in mine['results']], [intent_id])
        row = mine['results'][0]
        self.assertEqual((row['status'], row['event']['slug'], row['summary']['type'], row['summary']['ticket_count']),
                         ('paid', 'dff', 'ticket_order', 2))

    def test_my_tickets_show_payment(self):
        buyer = User.objects.create_user(username='b', email='buyer@test.com', password='x', role='attendee', email_verified=True)
        self.client.force_authenticate(buyer)
        r = self.register()
        intent_id = r.data['payment']['id']
        self.assertEqual(self.client.get('/api/me/tickets/').data['count'], 0)  # nothing until paid
        self.client.force_authenticate(None)
        self.pay_test(intent_id)
        self.client.force_authenticate(buyer)
        data = self.client.get('/api/me/tickets/').data
        self.assertEqual(data['count'], 2)
        self.assertEqual(data['results'][0]['payment']['provider'], 'test')
        self.assertTrue(data['results'][0]['payment']['label'].startswith('Paid online'))

    def test_organizer_settings_orders_and_actions(self):
        self.client.force_authenticate(self.org)
        r = self.client.put(f'/api/payments/events/{self.event.id}/settings/',
                            {'payment_mode': 'online', 'online_providers': ['khalti']}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual([p['id'] for p in r.data['effective']['providers']], ['khalti'])
        self.assertEqual(self.client.put(f'/api/payments/events/{self.event.id}/settings/',
                                         {'online_providers': ['paypal']}, format='json').status_code, 400)
        self.client.put(f'/api/payments/events/{self.event.id}/settings/', {'payment_mode': 'both', 'online_providers': []}, format='json')
        self.client.force_authenticate(None)
        r = self.register()
        self.pay_test(r.data['payment']['id'])
        venue = self.register(method='venue', provider='', email='v@test.com')
        self.assertEqual(venue.status_code, 201)
        self.client.force_authenticate(self.org)
        data = self.client.get(f'/api/events/{self.event.id}/orders/').data
        self.assertEqual(data['totals']['online_collected'], '1000.00')
        self.assertEqual(data['totals']['venue_due'], '1000.00')
        venue_order = TicketOrder.objects.get(buyer_email='v@test.com')
        r = self.client.post(f'/api/events/{self.event.id}/orders/{venue_order.id}/mark-paid/', {})
        self.assertEqual(r.data['payment']['label'], 'Paid Rs 1,000 at the venue')
        self.assertEqual(self.client.post(f'/api/events/{self.event.id}/orders/{venue_order.id}/mark-paid/', {}).status_code, 409)
        data = self.client.get(f'/api/events/{self.event.id}/orders/?status=paid').data
        self.assertEqual(data['totals']['venue_collected'], '1000.00')
        self.assertEqual(data['count'], 2)
        csv_text = self.client.get(f'/api/events/{self.event.id}/orders/?export=csv').content.decode()
        self.assertIn('Paid via', csv_text)
        self.assertIn('Marked paid at the venue', csv_text)
        r = self.client.post(f'/api/events/{self.event.id}/orders/{venue_order.id}/refund/', {'note': 'Cash back at desk'})
        self.assertEqual(r.data['payment']['status'], 'refunded')
        self.assertEqual({t['status'] for t in r.data['tickets']}, {'cancelled'})
        stranger = User.objects.create_user(username='s', email='s@test.com', password='x', role='organizer')
        self.client.force_authenticate(stranger)
        self.assertEqual(self.client.get(f'/api/events/{self.event.id}/orders/').status_code, 403)
        # Organizer-wide online payments report
        self.client.force_authenticate(self.org)
        rep = self.client.get('/api/payments/organizer/summary/').data
        self.assertEqual(rep['events'][0]['collected'], '1000.00')


class AuditFixTests(OnlineTicketTests):
    """Fixes from the 2026-11 review: bibs for online payers, emails on release/refund/cancel, gate hardening."""

    def test_online_payers_get_bibs_and_released_holds_are_emailed(self):
        Event.objects.filter(pk=self.event.pk).update(bib_numbers=True, bib_start=50)
        r = self.register()
        self.pay_test(r.data['payment']['id'])
        self.assertEqual(sorted(EventTicket.objects.values_list('bib_number', flat=True)), [50, 51])
        r = self.register(email='late@test.com')
        with self.captureOnCommitCallbacks(execute=True):
            self.pay_test(r.data['payment']['id'], outcome='cancelled')
        self.assertTrue(any('tickets were released' in m.subject for m in mail.outbox))

    def test_cancelling_the_event_emails_ticket_holders(self):
        self.register(method='venue')
        self.client.force_authenticate(self.org)
        with self.captureOnCommitCallbacks(execute=True):
            self.client.patch(f'/api/events/{self.event.id}/', {'status': 'cancelled'}, format='json')
        self.assertTrue(any('Event cancelled' in m.subject for m in mail.outbox))

    def test_gate_ignores_future_client_time_and_hides_other_events_guests(self):
        self.register(method='venue')
        t = EventTicket.objects.first()
        self.client.force_authenticate(self.org)
        future = '2099-01-01T10:00:00+05:45'
        r = self.client.post(f'/api/events/{self.event.id}/gate/scan/', {'qr_token': t.qr_token, 'scan_type': 'gate_in', 'scanned_at_client': future}, format='json')
        self.assertEqual(r.status_code, 200, r.data)  # server time is used, so the date check passes
        other_org = User.objects.create_user(username='o2', email='o2@test.com', password='x', role='organizer')
        other = Event.objects.create(organizer=other_org, title='Other', slug='other', location='Dharan', start_date=date.today(), status='published')
        self.client.force_authenticate(other_org)
        r = self.client.post(f'/api/events/{other.id}/gate/scan/', {'qr_token': t.qr_token, 'scan_type': 'gate_in'}, format='json')
        self.assertEqual(r.data['result'], 'wrong_event')
        self.assertNotIn('ticket', r.data)
        self.assertNotIn('Asha', str(r.data))

    def test_registration_only_events_have_no_gate(self):
        Event.objects.filter(pk=self.event.pk).update(registration_mode='form')
        self.client.force_authenticate(self.org)
        r = self.client.post(f'/api/events/{self.event.id}/gate/scan/', {'qr_token': 'TKT-ANY-0001', 'scan_type': 'gate_in'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('registration only', r.data['message'])
