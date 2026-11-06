"""Contests: OTP verification, SMS providers, CAPTCHA, rate limits, fraud flags + voiding, exports, paid credits, modules."""
import os
from datetime import timedelta
from unittest import mock

from django.core import mail
from django.utils import timezone

from apps.accounts import modules
from apps.accounts.models import PlatformModule
from . import sms
from .credits import credit_balance, grant_pack, voter_hash_for
from .models import Candidate, ContestJudge, Poll, Vote, VoteCredit, VoteOTP, VotePack
from .test_contests import API, ContestBase, make_user

NOW = timezone.now


class OTPTests(ContestBase):
    def setUp(self):
        super().setUp()
        self.poll = self.simple_contest(votes_per_voter=None, votes_per_day=3)
        Poll.objects.filter(pk=self.poll.pk).update(vote_mode='sms_otp')
        self.poll.refresh_from_db()
        self.base = f'/api/voting/public/{self.event.slug}/contests/{self.poll.slug}/'
        sms.console_outbox.clear()

    def send(self, dest='+977 984-1234567'):
        return self.client.post(f'{self.base}otp/send/', {'destination': dest}, format='json')

    def verify(self, code, dest='9841234567'):
        return self.client.post(f'{self.base}otp/verify/', {'destination': dest, 'code': code}, format='json')

    def last_code(self):
        return sms.console_outbox[-1][1][:6]

    def test_full_flow_hashed_storage(self):
        self.assertEqual(self.vote(self.poll, self.c(self.poll, 1)).data['code'], 'verification_required')
        res = self.send()
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['destination'], '984*****67')
        self.assertEqual(sms.console_outbox[-1][0], '9841234567')
        text = sms.console_outbox[-1][1]
        self.assertTrue(text.isascii() and len(text) <= 160, text)  # one GSM-7 SMS credit
        code = self.last_code()
        row = VoteOTP.objects.get()
        self.assertNotIn('9841234567', row.destination_hash + row.code_hash)
        self.assertNotEqual(row.code_hash, code)
        res = self.verify(code)
        self.assertEqual(res.status_code, 200, res.data)
        token = res.data['voter_token']
        self.assertEqual(self.vote(self.poll, self.c(self.poll, 1), voter_token=token).status_code, 201)
        self.assertEqual(self.vote(self.poll, self.c(self.poll, 2), voter_token=token, device='other').status_code, 201)
        # A token is per contest
        other = Poll.objects.create(event=self.event, kind='contest', title='Other', slug='other', status='open', vote_mode='sms_otp')
        Candidate.objects.create(poll=other, name='X', number=1)
        self.assertEqual(self.vote(other, '1', voter_token=token).data['code'], 'verification_required')
        self.assertEqual(self.vote(self.poll, self.c(self.poll, 1), voter_token=token + 'x').data['code'], 'verification_required')
        # Code is single use
        self.assertEqual(self.verify(code).status_code, 410)

    def test_cooldown_attempts_expiry(self):
        self.send()
        res = self.send()
        self.assertEqual(res.status_code, 429)
        self.assertGreater(res.data['retry_after'], 0)
        for _ in range(4):
            self.assertEqual(self.verify('000000' if self.last_code() != '000000' else '111111').status_code, 400)
        res = self.verify('000000' if self.last_code() != '000000' else '111111')
        self.assertEqual(res.status_code, 429)
        self.assertEqual(self.verify(self.last_code()).status_code, 429)  # locked even with the right code
        later = NOW() + timedelta(seconds=61)
        with mock.patch('django.utils.timezone.now', return_value=later):
            self.assertEqual(self.send().status_code, 200)
        code = self.last_code()
        with mock.patch('django.utils.timezone.now', return_value=later + timedelta(minutes=6)):
            self.assertEqual(self.verify(code).status_code, 410)  # 5-minute expiry

    def test_hourly_limit_and_bad_numbers(self):
        self.assertEqual(self.send('12345').status_code, 400)
        self.assertEqual(self.send('9612345678').status_code, 400)  # not 97/98
        t = NOW()
        for i in range(5):
            with mock.patch('django.utils.timezone.now', return_value=t + timedelta(minutes=2 * i)):
                self.assertEqual(self.send().status_code, 200)
        with mock.patch('django.utils.timezone.now', return_value=t + timedelta(minutes=11)):
            self.assertEqual(self.send().status_code, 429)

    def test_email_otp(self):
        Poll.objects.filter(pk=self.poll.pk).update(vote_mode='email_otp')
        res = self.send('Fan@Example.com')
        self.assertEqual(res.status_code, 200, res.data)
        code = mail.outbox[-1].subject[:6]
        self.assertTrue(code.isdigit())
        self.assertEqual(self.verify(code, 'fan@example.com').status_code, 200)

    def test_send_failure_is_reported(self):
        with mock.patch('apps.voting.otp.send_sms', side_effect=sms.SMSError('no balance')):
            self.assertEqual(self.send().status_code, 503)
        self.assertEqual(VoteOTP.objects.count(), 0)

    def test_otp_needs_otp_mode(self):
        Poll.objects.filter(pk=self.poll.pk).update(vote_mode='open')
        self.assertEqual(self.send().status_code, 400)


class FakeResponse:
    def __init__(self, status, data):
        self.status_code, self._data = status, data

    def json(self):
        return self._data


class SMSProviderTests(ContestBase):
    def test_provider_selection(self):
        with mock.patch.dict(os.environ, {'SMS_PROVIDER': '', 'AAKASH_SMS_TOKEN': ''}):
            self.assertEqual(sms.provider_name(), 'console')
        with mock.patch.dict(os.environ, {'SMS_PROVIDER': '', 'AAKASH_SMS_TOKEN': 'tok'}):
            self.assertEqual(sms.provider_name(), 'aakash')
        with mock.patch.dict(os.environ, {'SMS_PROVIDER': 'sparrow'}):
            self.assertEqual(sms.provider_name(), 'sparrow')

    def test_aakash(self):
        ok = FakeResponse(200, {'error': False, 'message': '1 messages has been queued for delivery.',
                                'data': {'valid': [{'mobile': '9841234567', 'status': 'queued'}], 'invalid': []}})
        with mock.patch('requests.post', return_value=ok) as post:
            sms.AakashSMS('tok').send('9841234567', 'hi')
        self.assertEqual(post.call_args.kwargs['data'], {'auth_token': 'tok', 'to': '9841234567', 'text': 'hi'})
        self.assertEqual(post.call_args.args[0], 'https://sms.aakashsms.com/sms/v3/send')
        bad = FakeResponse(200, {'error': True, 'message': 'Not enough balance.', 'data': []})
        with mock.patch('requests.post', return_value=bad):
            with self.assertRaisesMessage(sms.SMSError, 'Not enough balance'):
                sms.AakashSMS('tok').send('9841234567', 'hi')
        with self.assertRaises(sms.SMSError):
            sms.AakashSMS('').send('9841234567', 'hi')

    def test_sparrow(self):
        with mock.patch('requests.post', return_value=FakeResponse(200, {'response_code': 200})) as post:
            sms.SparrowSMS('t', 'Eventlaya').send('9841234567', 'hi')
        self.assertEqual(post.call_args.kwargs['data']['from'], 'Eventlaya')
        with mock.patch('requests.post', return_value=FakeResponse(403, {'response_code': 1002, 'response': 'Invalid token'})):
            with self.assertRaisesMessage(sms.SMSError, 'Invalid token'):
                sms.SparrowSMS('t', 'E').send('9841234567', 'hi')

    def test_number_normalization(self):
        self.assertEqual(sms.normalize_nepal_mobile('+977-9812345678'), '9812345678')
        self.assertEqual(sms.normalize_nepal_mobile('974 1234567'), '9741234567')
        with self.assertRaises(ValueError):
            sms.normalize_nepal_mobile('014123456')


class FraudTests(ContestBase):
    def setUp(self):
        super().setUp()
        self.poll = self.simple_contest(votes_per_voter=100)

    def test_captcha_when_configured(self):
        Poll.objects.filter(pk=self.poll.pk).update(captcha_enabled=True)
        self.assertEqual(self.vote(self.poll, '1').status_code, 201)  # no keys → off
        with mock.patch.dict(os.environ, {'TURNSTILE_SITE_KEY': 'site', 'TURNSTILE_SECRET_KEY': 'secret'}):
            data = self.client.get(f'/api/voting/public/{self.event.slug}/contests/{self.poll.slug}/').data
            self.assertEqual(data['verification']['captcha_site_key'], 'site')
            self.assertEqual(self.vote(self.poll, '1').data['code'], 'captcha_required')
            with mock.patch('requests.post', return_value=FakeResponse(200, {'success': True})):
                self.assertEqual(self.vote(self.poll, '1', captcha_token='tok').status_code, 201)

    def test_ip_and_device_rate_limits(self):
        Poll.objects.filter(pk=self.poll.pk).update(ip_votes_per_minute=2, device_votes_per_minute=0)
        self.assertEqual(self.vote(self.poll, '1', device='a').status_code, 201)
        self.assertEqual(self.vote(self.poll, '1', device='b').status_code, 201)
        res = self.vote(self.poll, '1', device='c')
        self.assertEqual((res.status_code, res.data['code']), (429, 'rate_limited'))
        res = self.client.post(f'/api/voting/public/{self.event.slug}/contests/{self.poll.slug}/vote/',
                               {'contestant': '1', 'device_id': 'c'}, format='json', REMOTE_ADDR='10.9.9.9')
        self.assertEqual(res.status_code, 201)  # another network is fine
        Poll.objects.filter(pk=self.poll.pk).update(ip_votes_per_minute=0, device_votes_per_minute=1)
        self.assertEqual(self.vote(self.poll, '1', device='z').status_code, 201)
        self.assertEqual(self.vote(self.poll, '1', device='z').status_code, 429)

    def test_flags_void_restore_and_audit(self):
        Poll.objects.filter(pk=self.poll.pk).update(flag_ip_burst=3, vote_mode='contact', flag_device_voters=2)
        self.vote(self.poll, '1', contact='9800000001')
        self.vote(self.poll, '1', contact='9800000002', device='dev-x')
        self.vote(self.poll, '1', contact='9800000003', device='dev-x')
        flags = [v.flags for v in Vote.objects.order_by('voted_at')]
        self.assertEqual(flags[:2], [[], []])
        self.assertEqual(sorted(flags[2]), ['ip_burst', 'shared_device'])  # 3rd vote from one IP; 2nd voter on dev-x
        self.as_(self.org)
        data = self.client.get(f'{API}{self.poll.id}/flags/').data
        self.assertEqual(len(data['votes']), 1)
        self.assertEqual(data['counts'], {'ip_burst': 1, 'shared_device': 1})
        self.assertTrue(any(g['kind'] == 'device' for g in data['groups']))
        self.assertEqual(self.client.post(f'{API}{self.poll.id}/votes/void/', {'flag': 'shared_device'}, format='json').status_code, 400)
        res = self.client.post(f'{API}{self.poll.id}/votes/void/', {'flag': 'shared_device', 'reason': 'Same phone for many voters'}, format='json')
        self.assertEqual(res.data['votes'], 1)
        results = self.client.get(f'{API}{self.poll.id}/results/').data['overall']
        self.assertEqual(results['rows'][0]['votes'], 2)
        log = self.poll.audit_log.get(action='votes_voided')
        self.assertIn('Same phone', log.summary)
        res = self.client.post(f'{API}{self.poll.id}/votes/void/', {'flag': 'shared_device', 'undo': True}, format='json')
        self.assertEqual(res.data['votes'], 1)
        self.assertEqual(self.client.get(f'{API}{self.poll.id}/results/').data['overall']['rows'][0]['votes'], 3)
        ip = Vote.objects.first().ip_hash
        self.client.post(f'{API}{self.poll.id}/votes/void/', {'ip_hash': ip, 'reason': 'Bot'}, format='json')
        self.assertEqual(Vote.objects.filter(is_void=True).count(), 3)
        # Voided votes still use up the voter's allowance (no re-voting after a void)
        Poll.objects.filter(pk=self.poll.pk).update(votes_per_voter=1)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.vote(self.poll, '2', contact='9800000001').status_code, 409)

    def test_exports(self):
        Poll.objects.filter(pk=self.poll.pk).update(vote_mode='contact')
        self.vote(self.poll, '1', contact='9811111111')
        self.as_(self.org)
        res = self.client.get(f'{API}{self.poll.id}/export/?kind=votes')
        body = res.content.decode('utf-8')
        self.assertTrue(body.startswith('﻿'))
        self.assertIn('Contestant 1', body)
        self.assertNotIn('9811111111', body)
        self.assertIn(Vote.objects.get().voter_identifier[:16], body)
        self.assertEqual(self.client.get(f'{API}{self.poll.id}/export/?kind=results').status_code, 200)
        self.assertEqual(self.client.get(f'{API}{self.poll.id}/export/?kind=scores').status_code, 200)
        self.assertEqual(self.client.get(f'{API}{self.poll.id}/export/?kind=nope').status_code, 400)
        dash = self.client.get(f'{API}{self.poll.id}/dashboard/').data
        self.assertEqual(dash['totals']['votes'], 1)
        self.assertEqual(sum(h['count'] for h in dash['hourly']), 1)
        self.assertEqual(len(self.client.get(f'{API}{self.poll.id}/audit/').data), 0)


class PaidCreditTests(ContestBase):
    def setUp(self):
        super().setUp()
        self.poll = self.simple_contest(votes_per_voter=None, votes_per_day=1, paid_votes_enabled=True, max_votes_per_submit=20)
        Poll.objects.filter(pk=self.poll.pk).update(vote_mode='contact')
        self.poll.refresh_from_db()
        self.pack = VotePack.objects.create(poll=self.poll, label='Fan pack', votes=10, bonus_votes=2, price='100.00')

    def test_grant_pack_is_idempotent_and_spent_after_free(self):
        voter = voter_hash_for(self.poll, phone='9841234567')
        grant_pack(self.pack, voter, payment_ref='khalti-123')
        grant_pack(self.pack, voter, payment_ref='khalti-123')  # payment callback retried
        self.assertEqual(credit_balance(self.poll, voter), 12)
        self.assertEqual(VoteCredit.objects.count(), 2)
        res = self.vote(self.poll, '1', contact='9841234567', quantity=5)
        self.assertEqual(res.status_code, 201, res.data)  # 1 free + 4 paid
        self.assertEqual(res.data['allowance']['credits'], 8)
        self.assertEqual(sorted(Vote.objects.values_list('source', 'quantity')), [('free', 1), ('paid', 4)])
        res = self.vote(self.poll, '1', contact='9841234567', quantity=9)
        self.assertEqual(res.status_code, 409)
        self.assertIn('vote pack', res.data['error'])
        self.assertEqual(res.data['credits'], 8)
        # Public page lists the packs but says payments aren't available yet
        data = self.client.get(f'/api/voting/public/{self.event.slug}/contests/{self.poll.slug}/').data
        self.assertEqual(data['paid']['packs'][0]['total_votes'], 12)
        self.assertFalse(data['paid']['payments_available'])

    def test_organizer_bonus_grant(self):
        self.as_(self.org)
        res = self.client.post(f'{API}{self.poll.id}/credits/grant/', {'phone': '9841234567', 'votes': 3}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(credit_balance(self.poll, voter_hash_for(self.poll, phone='9841234567')), 3)
        self.assertEqual(self.client.post(f'{API}{self.poll.id}/credits/grant/', {'phone': '123', 'votes': 3}, format='json').status_code, 400)


class ModuleTests(ContestBase):
    def test_voting_module_switch_covers_contests(self):
        poll = self.simple_contest()
        judge = ContestJudge.objects.create(poll=poll, user=make_user('j@x.com', 'attendee'))
        urls = [f'/api/voting/public/{self.event.slug}/contests/{poll.slug}/', f'/api/voting/og/{self.event.slug}/{poll.slug}/']
        for u in urls:
            self.assertEqual(self.client.get(u).status_code, 200, u)
        PlatformModule.objects.filter(slug='voting').update(is_globally_enabled=False)
        modules.clear_cache()
        self.addCleanup(modules.clear_cache)
        for u in urls:
            res = self.client.get(u)
            self.assertEqual(res.status_code, 403, u)
            self.assertEqual(res.json()['code'], 'module_disabled')
        self.assertEqual(self.vote(poll, '1').status_code, 403)
        self.client.force_authenticate(user=judge.user)
        self.assertEqual(self.client.get(f'/api/voting/judge/{judge.id}/').status_code, 403)
        self.client.force_authenticate(user=self.org)
        self.assertEqual(self.client.get(f'{API}{poll.id}/').status_code, 403)
