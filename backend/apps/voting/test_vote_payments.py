"""Paid vote packs through apps.payments (purpose 'vote_pack')."""
from datetime import datetime, timezone as dt_timezone
from unittest import mock

from django.test import override_settings

from apps.accounts import modules
from apps.accounts.models import PlatformModule
from apps.events.models import EventTicket
from apps.payments import services as pay
from apps.payments.models import PaymentIntent
from .credits import credit_balance
from .models import Candidate, ContestAuditLog, Poll, Vote, VoteCredit, VotePack, VotePurchase, hash_voter
from .otp import make_voter_token
from .test_contests import API, ContestBase, make_user

PAY = dict(PAYMENTS_TEST_PROVIDER=True, PAYMENTS_ENABLED_PROVIDERS=['khalti', 'esewa'],
           KHALTI_SECRET_KEY='test_secret', ESEWA_PRODUCT_CODE='EPAYTEST', ESEWA_SECRET_KEY='8gBm/:&EnhH.1/q',
           FRONTEND_URL='http://localhost:5173')
PHONE, OTHER_PHONE = '9841234567', '9851112222'


@override_settings(**PAY)
class VotePackBase(ContestBase):
    def setUp(self):
        super().setUp()
        modules.clear_cache()
        self.addCleanup(modules.clear_cache)
        self.poll = self.simple_contest(n=3, votes_per_voter=None, votes_per_day=1, paid_votes_enabled=True, max_votes_per_submit=50)
        Poll.objects.filter(pk=self.poll.pk).update(vote_mode='sms_otp')
        self.poll.refresh_from_db()
        self.pack = VotePack.objects.create(poll=self.poll, label='Fan pack', votes=10, bonus_votes=2, price='100.00')
        self.small = VotePack.objects.create(poll=self.poll, label='Single', votes=1, price='5.00', order=1)
        self.base = f'/api/voting/public/{self.event.slug}/contests/{self.poll.slug}/'
        self.token = make_voter_token(self.poll, f'contact:{PHONE}', 'sms_otp')
        self.voter = hash_voter(f'contact:{PHONE}')

    def buy(self, pack=None, provider='test', token=None, **kw):
        body = {'pack': str((pack or self.pack).id), 'provider': provider, 'voter_token': token or self.token, 'device_id': 'dev-1',
                'payer_phone': PHONE, 'return_url': f'http://localhost:5173/e/{self.event.slug}/vote/{self.poll.slug}', **kw}
        if token is False:
            body.pop('voter_token')
        return self.client.post(f'{self.base}buy/', body, format='json')

    def pay_test(self, payment_id, outcome='paid'):
        """What the browser does on the test provider: press the button, follow the return."""
        r = self.client.post(f'/api/payments/test/{payment_id}/', {'outcome': outcome})
        self.assertEqual(r.status_code, 302)
        return self.client.get(r['Location'])

    def bought(self, **kw):
        res = self.buy(**kw)
        self.assertEqual(res.status_code, 201, res.data)
        self.pay_test(res.data['payment']['id'])
        return res.data['payment']['id']

    def vote(self, poll, contestant, device='dev-1', **kw):
        kw.setdefault('voter_token', self.token)
        return super().vote(poll, contestant, device, **kw)


class PurchaseFlowTests(VotePackBase):
    def test_public_paid_block(self):
        paid = self.client.get(self.base).data['paid']
        self.assertTrue(paid['enabled'])
        self.assertTrue(paid['payments_available'])
        self.assertIsNone(paid['unavailable_reason'])
        self.assertEqual({p['id'] for p in paid['providers']}, {'khalti', 'esewa', 'test'})
        self.assertEqual([(p['label'], p['total_votes'], p['price'], p['khalti_ok']) for p in paid['packs']],
                         [('Fan pack', 12, '100.00', True), ('Single', 1, '5.00', False)])
        self.assertEqual(paid['max_packs_per_day'], 10)
        self.assertFalse(paid['buy_and_vote'])

    def test_verification_required_first(self):
        res = self.buy(token=False)
        self.assertEqual((res.status_code, res.data['code']), (401, 'verification_required'))
        self.assertEqual(self.buy(token='forged').status_code, 401)
        self.assertEqual((VotePurchase.objects.count(), PaymentIntent.objects.count()), (0, 0))

    def test_test_provider_end_to_end_and_idempotent(self):
        res = self.buy()
        self.assertEqual(res.status_code, 201, res.data)
        pid = res.data['payment']['id']
        self.assertTrue(res.data['checkout']['redirect_url'].endswith(f'/api/payments/test/{pid}/'))
        self.assertEqual(res.data['purchase']['total_votes'], 12)
        intent = PaymentIntent.objects.get(pk=pid)
        self.assertEqual((intent.purpose, intent.amount, intent.organizer, intent.event), ('vote_pack', 100, self.org, self.event))
        self.assertEqual(intent.description, '12 votes · Contest')
        self.assertEqual(intent.metadata['voter'], self.voter)
        self.assertEqual(intent.payer_phone, PHONE)  # kept: it is the verified phone
        self.assertEqual(intent.payer_name, 'Voter')  # Khalti needs a name whenever customer_info is sent
        back = self.pay_test(pid)
        self.assertEqual(back.status_code, 302)
        self.assertIn(f'payment={pid}', back['Location'])
        self.assertIn('status=paid', back['Location'])
        self.assertEqual(credit_balance(self.poll, self.voter), 12)
        # The return again, a status poll, the cron and a direct mark_paid change nothing
        self.client.get(f'/api/payments/return/test/{pid}/')
        status = self.client.get(f'/api/payments/intents/{pid}/').data
        pay.mark_paid(intent)
        pay.expire_stale()
        self.assertEqual(credit_balance(self.poll, self.voter), 12)
        self.assertEqual(VoteCredit.objects.filter(amount__gt=0).count(), 2)  # 10 paid + 2 bonus, once
        self.assertEqual(status['result']['type'], 'vote_pack')
        self.assertTrue(status['result']['credited'])
        self.assertEqual(status['result']['credits'], 12)
        self.assertEqual(VotePurchase.objects.get().status, 'paid')
        self.assertTrue(ContestAuditLog.objects.filter(action='votes_bought').exists())
        # Spend: 1 free vote today, then 4 paid ones; the vote records which payment they came from
        res = self.vote(self.poll, self.c(self.poll, 2), quantity=5)
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['allowance']['credits'], 8)
        paid_vote = Vote.objects.get(source='paid')
        self.assertEqual((paid_vote.quantity, paid_vote.payment_ref), (4, pid))

    def test_wrong_voter_cant_use_credits(self):
        self.bought()
        other = make_voter_token(self.poll, f'contact:{OTHER_PHONE}', 'sms_otp')
        self.assertEqual(self.vote(self.poll, self.c(self.poll, 1), voter_token=other, device='dev-2').status_code, 201)  # free vote
        res = self.vote(self.poll, self.c(self.poll, 1), voter_token=other, device='dev-2')
        self.assertEqual((res.status_code, res.data['code'], res.data['credits']), (409, 'allowance_used', 0))
        # A token for another contest can't buy here either
        other_poll = Poll.objects.create(event=self.event, kind='contest', title='Other', slug='other', status='open', vote_mode='sms_otp')
        self.assertEqual(self.buy(token=make_voter_token(other_poll, f'contact:{PHONE}', 'sms_otp')).status_code, 401)
        # The payer phone is only stored when it is the verified voter's
        res = self.buy(payer_phone=OTHER_PHONE)
        self.assertEqual(PaymentIntent.objects.get(pk=res.data['payment']['id']).payer_phone, '')

    def test_refund_removes_unspent_credits(self):
        pid = self.bought()
        self.vote(self.poll, self.c(self.poll, 1), quantity=5)  # 1 free + 4 paid
        self.as_(self.org)
        res = self.client.post(f'/api/payments/intents/{pid}/refund/', {'note': 'Buyer asked'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(credit_balance(self.poll, self.voter), 0)
        self.assertEqual(VotePurchase.objects.get().status, 'refunded')
        log = ContestAuditLog.objects.get(action='votes_refunded')
        self.assertEqual((log.detail['removed'], log.detail['already_cast']), (8, 4))
        self.assertIn('4 were already cast', log.summary)
        # Credits from another payment are untouched by that refund
        self.bought()
        self.assertEqual(credit_balance(self.poll, self.voter), 12)

    def test_cancel_failed_and_late_payment(self):
        res = self.buy()
        pid = res.data['payment']['id']
        back = self.pay_test(pid, 'cancelled')
        self.assertIn('status=cancelled', back['Location'])
        self.assertEqual(VotePurchase.objects.get().status, 'failed')
        self.assertEqual(credit_balance(self.poll, self.voter), 0)
        # The money arrives after all (late payment): credits are granted once
        pay.mark_paid(PaymentIntent.objects.get(pk=pid), 'LATE-1')
        self.assertEqual(VotePurchase.objects.get().status, 'paid')
        self.assertEqual(credit_balance(self.poll, self.voter), 12)
        self.assertIn('late payment', ContestAuditLog.objects.get(action='votes_bought').summary)

    def test_custom_votes_and_khalti_minimum(self):
        res = self.buy(pack=self.small, provider='khalti')
        self.assertEqual((res.status_code, res.data['code']), (400, 'provider_unavailable'))
        self.assertIn('Rs 10', res.data['error'])
        self.assertEqual(VotePurchase.objects.count(), 0)
        self.assertEqual(self.client.post(f'{self.base}buy/', {'votes': 3, 'provider': 'test', 'voter_token': self.token}, format='json').status_code, 400)
        Poll.objects.filter(pk=self.poll.pk).update(price_per_vote='4.00')
        res = self.client.post(f'{self.base}buy/', {'votes': 3, 'provider': 'test', 'voter_token': self.token}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['payment']['amount'], '12.00')
        with mock.patch('apps.payments.providers.requests.post') as post:  # eSewa needs no HTTP call to start
            res = self.buy(provider='esewa')
            post.assert_not_called()
        self.assertEqual(res.status_code, 201, res.data)
        self.assertIn('form_action', res.data['checkout'])
        self.assertEqual(float(res.data['checkout']['fields']['total_amount']), 100.0)


class PurchaseRuleTests(VotePackBase):
    def test_payments_module_off_or_no_provider(self):
        PlatformModule.objects.filter(slug='payments').update(is_globally_enabled=False)
        modules.clear_cache()
        paid = self.client.get(self.base).data['paid']
        # Payments off → paid votes are off too (they require it): packs hidden, buying refused
        self.assertEqual((paid['enabled'], paid['payments_available'], paid['unavailable_reason'], paid['packs']),
                         (False, False, 'payments_off', []))
        res = self.buy()
        self.assertEqual((res.status_code, res.data['code'], res.data['reason']), (403, 'module_disabled', 'payments_off'))
        PlatformModule.objects.filter(slug='payments').update(is_globally_enabled=True)
        modules.clear_cache()
        with override_settings(PAYMENTS_TEST_PROVIDER=False, PAYMENTS_ENABLED_PROVIDERS=[]):
            paid = self.client.get(self.base).data['paid']
            self.assertEqual((paid['enabled'], paid['unavailable_reason'], len(paid['packs'])), (True, 'no_provider', 2))  # shown, unavailable
            self.assertEqual(self.buy().data['reason'], 'no_provider')
        Poll.objects.filter(pk=self.poll.pk).update(status='closed')
        self.assertEqual(self.buy().status_code, 409)

    def test_daily_pack_limit_resets_in_nepal_time(self):
        Poll.objects.filter(pk=self.poll.pk).update(max_packs_per_day=2)
        with mock.patch('django.utils.timezone.now', return_value=datetime(2026, 11, 1, 18, 0, tzinfo=dt_timezone.utc)):
            self.assertEqual(self.buy().status_code, 201)
            self.bought()
            res = self.buy()
            self.assertEqual((res.status_code, res.data['code']), (429, 'pack_limit'))
        with mock.patch('django.utils.timezone.now', return_value=datetime(2026, 11, 1, 18, 20, tzinfo=dt_timezone.utc)):
            self.assertEqual(self.buy().status_code, 201)  # 00:05 next day in Nepal

    def test_paid_votes_need_a_verified_mode(self):
        self.as_(self.org)
        res = self.client.patch(f'{API}{self.poll.id}/', {'vote_mode': 'open'}, format='json')
        self.assertIn('paid_votes_enabled', res.data)
        Poll.objects.filter(pk=self.poll.pk).update(vote_mode='contact')
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(self.base).data['paid']['unavailable_reason'], 'unverified_mode')

    def test_ticket_and_account_identities(self):
        Poll.objects.filter(pk=self.poll.pk).update(vote_mode='ticket')
        t = EventTicket.generate_ticket(self.event, 'Asha', 'asha@x.com')
        res = self.client.post(f'{self.base}buy/', {'pack': str(self.pack.id), 'provider': 'test', 'ticket_code': t.ticket_number}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.pay_test(res.data['payment']['id'])
        self.assertEqual(credit_balance(self.poll, hash_voter(f'ticket:{t.id}')), 12)
        self.assertEqual(PaymentIntent.objects.get(pk=res.data['payment']['id']).payer_email, 'asha@x.com')
        Poll.objects.filter(pk=self.poll.pk).update(vote_mode='account')
        res = self.client.post(f'{self.base}buy/', {'pack': str(self.pack.id), 'provider': 'test'}, format='json')
        self.assertEqual(res.data['code'], 'sign_in_required')
        fan = make_user('fan@x.com', 'attendee')
        self.as_(fan)
        res = self.client.post(f'{self.base}buy/', {'pack': str(self.pack.id), 'provider': 'test'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(PaymentIntent.objects.get(pk=res.data['payment']['id']).user, fan)

    def test_buy_and_vote(self):
        Poll.objects.filter(pk=self.poll.pk).update(buy_and_vote=True)
        c2 = self.c(self.poll, 2)
        pid = self.bought(contestant='2')
        purchase = VotePurchase.objects.get()
        self.assertEqual((purchase.auto_vote, purchase.auto_voted), (True, 12))
        v = Vote.objects.get()
        self.assertEqual((v.candidate, v.quantity, v.source, v.payment_ref), (c2, 12, 'paid', pid))
        self.assertEqual(credit_balance(self.poll, self.voter), 0)
        self.assertEqual(self.client.get(f'/api/payments/intents/{pid}/').data['result']['purchase']['auto_voted'], 12)
        # Contestant withdrawn before the payment arrived: the votes stay in the balance
        res = self.buy(contestant='3')
        Candidate.objects.filter(number=3).update(status='withdrawn')
        self.pay_test(res.data['payment']['id'])
        p = VotePurchase.objects.get(pk=res.data['purchase']['id'])
        self.assertEqual(p.auto_voted, 0)
        self.assertIn('balance', p.auto_vote_note)
        self.assertEqual(credit_balance(self.poll, self.voter), 12)
        self.assertEqual(self.buy(contestant='3').data['code'], 'not_eligible')
        # Off (default): a contestant only attributes the purchase, nothing is cast
        Poll.objects.filter(pk=self.poll.pk).update(buy_and_vote=False)
        self.bought(contestant='1')
        self.assertEqual(Vote.objects.count(), 1)

    def test_fraud_flags_and_void_warning(self):
        Poll.objects.filter(pk=self.poll.pk).update(flag_device_voters=2)
        self.bought()
        other = make_voter_token(self.poll, f'contact:{OTHER_PHONE}', 'sms_otp')
        self.bought(token=other)  # same device, second buyer
        self.assertEqual(list(VotePurchase.objects.order_by('created_at').values_list('flags', flat=True)), [[], ['shared_device_purchases']])
        self.vote(self.poll, self.c(self.poll, 1), quantity=6)
        self.as_(self.org)
        res = self.client.post(f'{API}{self.poll.id}/votes/void/', {'vote_ids': [str(v.id) for v in Vote.objects.all()], 'reason': 'Test'}, format='json')
        self.assertEqual(res.data['paid_votes'], 5)
        self.assertIn('refund', res.data['warning'])
        self.assertEqual(len(res.data['payments']), 1)

    def test_organizer_reports_and_exports(self):
        pid = self.bought(contestant='2')
        self.vote(self.poll, self.c(self.poll, 2), quantity=3)
        self.as_(self.org)
        dash = self.client.get(f'{API}{self.poll.id}/dashboard/').data['paid']
        self.assertEqual((dash['revenue'], dash['purchases'], dash['votes_sold'], dash['unspent_credits']), ('100.00', 1, 12, 10))
        self.assertEqual((dash['per_contestant'][0]['name'], dash['per_contestant'][0]['revenue'], dash['per_contestant'][0]['paid_votes']),
                         ('Contestant 2', '100.00', 2))
        self.assertEqual(dash['per_pack'][0]['label'], 'Fan pack')
        contest = self.client.get(f'{API}{self.poll.id}/').data
        self.assertEqual((contest['stats']['revenue'], contest['stats']['paid_votes']), ('100.00', 2))
        self.assertTrue(contest['payments']['available'])
        rows = self.client.get(f'{API}{self.poll.id}/purchases/').data['purchases']
        self.assertEqual((rows[0]['payment_id'], rows[0]['status'], rows[0]['provider']), (pid, 'paid', 'test'))
        body = self.client.get(f'{API}{self.poll.id}/export/?kind=purchases').content.decode()
        self.assertIn(pid, body)
        self.assertNotIn(PHONE, body)
        votes_csv = self.client.get(f'{API}{self.poll.id}/export/?kind=votes').content.decode()
        self.assertIn('Payment ref', votes_csv)
        self.assertIn(pid, votes_csv)
        # The payments module's organizer pages are purpose-agnostic: vote packs show up there too
        listed = self.client.get('/api/payments/organizer/payments/?purpose=vote_pack').data
        self.assertEqual((listed['count'], listed['results'][0]['description']), (1, '12 votes · Contest'))
        summary = self.client.get('/api/payments/organizer/summary/').data
        self.assertEqual(summary['totals']['collected'], '100.00')
        self.assertEqual(summary['events'][0]['event']['title'], 'Miss Dharan')


class MyVotePurchasesTests(VotePackBase):
    def test_signed_in_buyer_sees_vote_packs_in_my_payments(self):
        fan = make_user('fan2@x.com', 'attendee')
        self.as_(fan)  # signed in, but the contest verifies by SMS code
        payment_id = self.bought()
        self.assertEqual(PaymentIntent.objects.get(pk=payment_id).user, fan)
        self.as_(fan)
        rows = self.client.get('/api/payments/mine/').data['results']
        self.assertEqual([r['id'] for r in rows], [payment_id])
        s = rows[0]['summary']
        self.assertEqual((s['type'], s['votes'], s['credited'], s['contest']['slug']), ('vote_pack', 12, True, self.poll.slug))
        self.assertNotIn('credits', s)  # balance belongs to the verified voter, not shown in the list
