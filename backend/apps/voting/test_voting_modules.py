"""Superadmin switches for voting: voting (master) → contests → judging, and paid_votes (contests + payments)."""
from django.test import override_settings

from apps.accounts import modules
from apps.accounts.models import PlatformModule, RoleModulePermission
from .models import Candidate, ContestJudge, ContestRound, Criterion, Poll, RoundEntry, ScoreSheet, Vote, VotePack
from .otp import make_voter_token
from .test_contests import API, ContestBase, make_user
from .test_vote_payments import PAY


def switch(slug, globally=None, role=None, on=True):
    if globally is not None:
        PlatformModule.objects.filter(slug=slug).update(is_globally_enabled=globally)
    if role:
        RoleModulePermission.objects.filter(module__slug=slug, role=role).update(is_enabled=on)
    modules.clear_cache()


@override_settings(**PAY)
class VotingModuleTests(ContestBase):
    def setUp(self):
        super().setUp()
        modules.clear_cache()
        self.addCleanup(modules.clear_cache)
        self.contest = self.simple_contest(rounds=True, votes_per_voter=5, paid_votes_enabled=True)
        Poll.objects.filter(pk=self.contest.pk).update(vote_mode='sms_otp')
        self.contest.refresh_from_db()
        VotePack.objects.create(poll=self.contest, label='Pack', votes=10, price='100')
        self.rnd = self.contest.rounds.get()
        self.rnd.judging_enabled, self.rnd.judge_weight, self.rnd.public_weight = True, 50, 50
        self.rnd.save()
        self.crit = Criterion.objects.create(round=self.rnd, name='Talent', max_points=10)
        self.fan = make_user('fan@x.com', 'attendee')
        self.judge = ContestJudge.objects.create(poll=self.contest, user=make_user('judge@x.com', 'attendee'))
        self.quick = Poll.objects.create(event=self.event, title='Quick', status='open', vote_mode='open')
        for n in ('A', 'B'):
            Candidate.objects.create(poll=self.quick, name=n)
        self.pub = f'/api/voting/public/{self.event.slug}/'
        self.cpub = f'{self.pub}contests/{self.contest.slug}/'
        self.token = make_voter_token(self.contest, 'contact:9841234567', 'sms_otp')

    def slugs(self, user):
        self.as_(user)
        return {m['slug'] for m in self.client.get('/api/auth/modules/').data['modules']}

    def anon(self):
        self.client.force_authenticate(user=None)

    def test_modules_seeded_with_requirements(self):
        rows = {m.slug: m for m in PlatformModule.objects.filter(slug__in=['voting', 'contests', 'judging', 'paid_votes'])}
        self.assertEqual(set(rows), {'voting', 'contests', 'judging', 'paid_votes'})
        self.assertNotIn('One-person-one-vote', rows['voting'].description)
        on = lambda slug: set(RoleModulePermission.objects.filter(module__slug=slug, is_enabled=True).values_list('role', flat=True))  # noqa: E731
        self.assertEqual(on('contests'), {'superadmin', 'organizer', 'attendee'})
        self.assertEqual(on('judging'), {'superadmin', 'organizer', 'attendee', 'staff'})
        self.assertEqual(on('paid_votes'), {'superadmin', 'organizer', 'attendee'})
        self.as_(self.org)
        listed = {m['slug']: m for m in self.client.get('/api/auth/modules/').data['modules']}
        self.assertEqual(listed['paid_votes']['requires'], ['contests', 'payments'])
        self.assertEqual(listed['judging']['requires'], ['contests'])
        self.assertEqual(listed['contests']['requires'], ['voting'])

    def test_contests_off_globally(self):
        switch('contests', globally=False)
        # Anonymous public endpoints
        self.anon()
        for url in (self.cpub, f'{self.cpub}c/1/', f'/api/voting/og/{self.event.slug}/{self.contest.slug}/',
                    f'{self.pub}{self.contest.id}/'):
            res = self.client.get(url)
            self.assertEqual((res.status_code, res.json()['code'], res.json()['module']), (403, 'module_disabled', 'contests'), url)
        self.assertEqual(self.client.post(f'{self.cpub}vote/', {'contestant': '1', 'device_id': 'd'}, format='json').status_code, 403)
        self.assertEqual(self.client.post(f'{self.pub}{self.contest.id}/vote/', {'contestant': '1'}, format='json').status_code, 403)
        self.assertEqual(self.client.post(f'{self.cpub}otp/send/', {'destination': '9841234567'}, format='json').status_code, 403)
        # Quick polls are unaffected; the event's list drops the contest
        listed = self.client.get(self.pub).data['polls']
        self.assertEqual([p['title'] for p in listed], ['Quick'])
        res = self.client.post(f'{self.pub}{self.quick.id}/vote/', {'candidate_ids': [str(self.quick.candidates.first().id)], 'device_id': 'q'}, format='json')
        self.assertEqual(res.status_code, 201)
        # Organizer: contest API off, quick polls still listed
        self.as_(self.org)
        self.assertEqual(self.client.get(f'{API}{self.contest.id}/').status_code, 403)
        self.assertEqual(self.client.get(API).status_code, 403)
        self.assertEqual([p['title'] for p in self.client.get(f'/api/voting/polls/?event={self.event.id}').data], ['Quick'])
        self.assertNotIn('contests', self.slugs(self.org))
        self.assertNotIn('judging', self.slugs(self.org))  # child of contests
        # Superadmins always pass
        self.as_(make_user('admin@x.com', 'superadmin'))
        self.assertEqual(self.client.get(f'{API}{self.contest.id}/').status_code, 200)

    def test_contests_off_for_a_role(self):
        switch('contests', role='attendee', on=False)
        self.as_(self.fan)
        self.assertEqual(self.client.get(self.cpub).status_code, 403)
        self.assertNotIn('contests', self.slugs(self.fan))
        self.anon()
        self.assertEqual(self.client.get(self.cpub).status_code, 200)  # anonymous visitors only need the global switch
        # Off for organizers: their contests are off for everyone
        switch('contests', role='organizer', on=False)
        self.anon()
        self.assertEqual(self.client.get(self.cpub).status_code, 403)
        self.as_(self.org)
        self.assertEqual(self.client.get(f'{API}{self.contest.id}/').status_code, 403)

    def test_voting_master_switch_turns_everything_off(self):
        switch('voting', globally=False)
        self.anon()
        self.assertEqual(self.client.get(self.cpub).json()['module'], 'voting')  # middleware answers first
        self.assertEqual(self.client.get(f'{self.pub}{self.quick.id}/').status_code, 403)
        for slug in ('voting', 'contests', 'judging', 'paid_votes'):
            self.assertNotIn(slug, self.slugs(self.org))
        # voting off for attendees only → their contests/judging are off too (dependency), organizers unaffected
        switch('voting', globally=True)
        switch('voting', role='attendee', on=False)
        self.as_(self.judge.user)
        self.assertEqual(self.client.get(f'/api/voting/judge/{self.judge.id}/').status_code, 403)
        self.assertTrue({'contests', 'judging'} <= self.slugs(self.org))

    def test_judging_switch(self):
        Vote.objects.create(poll=self.contest, candidate=self.c(self.contest, 1), voter_identifier='v', quantity=10, round=self.rnd)
        ScoreSheet.objects.create(round=self.rnd, judge=self.judge, contestant=self.c(self.contest, 2), status='submitted',
                                  scores={str(self.crit.id): 10})
        self.as_(self.org)
        res = self.client.get(f'{API}{self.contest.id}/results/?round={self.rnd.id}').data
        self.assertEqual(res['weights'], {'judges': 50.0, 'public': 50.0})
        finals = {r['name']: r['final'] for r in res['rows']}
        self.assertEqual((finals['Contestant 1'], finals['Contestant 2']), (50.0, 50.0))
        self.assertEqual(res['rows'][0]['name'], 'Contestant 2')  # tie broken by the judges' score
        self.as_(self.judge.user)
        self.assertEqual(self.client.get(f'/api/voting/judge/{self.judge.id}/').status_code, 200)

        switch('judging', globally=False)
        self.as_(self.judge.user)
        res = self.client.get(f'/api/voting/judge/{self.judge.id}/')
        self.assertEqual((res.status_code, res.json()['module']), (403, 'judging'))
        self.assertEqual(self.client.get('/api/voting/judge/').status_code, 403)
        self.as_(self.org)
        self.assertEqual(self.client.get(f'{API}{self.contest.id}/judges/').status_code, 403)
        self.assertEqual(self.client.get(f'{API}{self.contest.id}/sheets/').status_code, 403)
        self.assertEqual(self.client.get(f'{API}{self.contest.id}/export/?kind=scores').status_code, 403)
        self.assertEqual(self.client.get(f'{API}{self.contest.id}/').status_code, 200)  # contests still on
        res = self.client.get(f'{API}{self.contest.id}/results/?round={self.rnd.id}').data
        self.assertEqual(res['weights'], {'judges': 0, 'public': 100})  # judges' scores no longer count
        self.assertEqual(res['rows'][0]['name'], 'Contestant 1')
        self.assertEqual(self.client.get(f'{API}{self.contest.id}/dashboard/').data['judges'], [])

    def test_judging_off_for_the_judge_role_or_the_organizer(self):
        switch('judging', role='attendee', on=False)
        self.as_(self.judge.user)
        self.assertEqual(self.client.get(f'/api/voting/judge/{self.judge.id}/').status_code, 403)
        switch('judging', role='attendee', on=True)
        switch('judging', role='organizer', on=False)
        self.as_(self.judge.user)
        self.assertEqual(self.client.get(f'/api/voting/judge/{self.judge.id}/').status_code, 403)  # the contest's organizer has it off
        self.assertEqual(self.client.get('/api/voting/judge/').data, [])

    def test_paid_votes_switch(self):
        buy = lambda: self.client.post(f'{self.cpub}buy/', {'pack': str(self.contest.vote_packs.get().id), 'provider': 'test',  # noqa: E731
                                                              'voter_token': self.token}, format='json')
        self.anon()
        self.assertTrue(self.client.get(self.cpub).data['paid']['payments_available'])
        switch('paid_votes', globally=False)
        self.anon()
        paid = self.client.get(self.cpub).data['paid']
        self.assertEqual((paid['enabled'], paid['payments_available'], paid['packs'], paid['unavailable_reason']),
                         (False, False, [], 'paid_votes_off'))
        res = buy()
        self.assertEqual((res.status_code, res.data['code'], res.data['module']), (403, 'module_disabled', 'paid_votes'))
        self.assertEqual(self.client.get(self.cpub).status_code, 200)  # the contest itself is fine
        # Dependency: contests off for attendees → paid votes off for them
        switch('paid_votes', globally=True)
        switch('contests', role='attendee', on=False)
        self.assertNotIn('paid_votes', self.slugs(self.fan))
        self.assertIn('paid_votes', self.slugs(self.org))
        # Dependency: payments off → paid_votes off
        switch('contests', role='attendee', on=True)
        switch('payments', globally=False)
        self.assertNotIn('paid_votes', self.slugs(self.fan))
        self.anon()
        self.assertEqual(self.client.get(self.cpub).data['paid']['unavailable_reason'], 'payments_off')
