"""Contests: weighted results, normalization, tie-breaks, visibility, advancement and judges' scoring."""
from apps.accounts.models import User
from .models import Candidate, ContestJudge, ContestRound, Criterion, Poll, RoundEntry, ScoreSheet, Vote
from .scoring import round_standings
from .test_contests import API, ContestBase, make_user


class ScoringBase(ContestBase):
    def setUp(self):
        super().setUp()
        self.poll = self.simple_contest(n=3, rounds=True, votes_per_voter=None, votes_per_day=1000)
        self.rnd = self.poll.rounds.get()
        self.rnd.judging_enabled = True
        self.rnd.judge_weight, self.rnd.public_weight = 70, 30
        self.rnd.save()
        self.beauty = Criterion.objects.create(round=self.rnd, name='Beauty', max_points=30, order=0)
        self.talent = Criterion.objects.create(round=self.rnd, name='Talent', max_points=30, order=1)
        self.qa = Criterion.objects.create(round=self.rnd, name='Q&A', max_points=40, order=2)
        self.c1, self.c2, self.c3 = (self.c(self.poll, i) for i in (1, 2, 3))
        self.judges = [ContestJudge.objects.create(poll=self.poll, user=make_user(f'j{i}@x.com', 'attendee'), name=f'Judge {i}')
                       for i in (1, 2, 3)]

    def votes(self, contestant, n):
        Vote.objects.create(poll=self.poll, candidate=contestant, voter_identifier=f'v-{contestant.id}', quantity=n, round=self.rnd)

    def sheet(self, judge, contestant, b, t, q, submitted=True):
        return ScoreSheet.objects.create(round=self.rnd, judge=judge, contestant=contestant,
                                         scores={str(self.beauty.id): b, str(self.talent.id): t, str(self.qa.id): q},
                                         status='submitted' if submitted else 'draft')

    def standard(self):
        self.votes(self.c1, 100)
        self.votes(self.c2, 50)
        j1, j2, j3 = self.judges
        self.sheet(j1, self.c1, 20, 20, 20)  # 60%
        self.sheet(j2, self.c1, 30, 30, 40)  # 100%
        self.sheet(j3, self.c1, 10, 10, 10)  # 30%
        for j in self.judges:
            self.sheet(j, self.c2, 30, 30, 40)  # 100%
            self.sheet(j, self.c3, 15, 15, 20)  # 50%

    def rows(self):
        return {r['name']: r for r in round_standings(self.poll, self.rnd)['rows']}


class WeightedResultTests(ScoringBase):
    def test_weighted_top_normalization(self):
        self.standard()
        st = round_standings(self.poll, self.rnd)
        self.assertEqual(st['weights'], {'judges': 70.0, 'public': 30.0})
        r = {x['name']: x for x in st['rows']}
        self.assertAlmostEqual(r['Contestant 1']['judge_score'], 63.33, places=2)
        self.assertEqual(r['Contestant 1']['public_score'], 100)
        self.assertAlmostEqual(r['Contestant 1']['final'], 74.3333, places=3)
        self.assertAlmostEqual(r['Contestant 2']['final'], 85.0, places=3)
        self.assertAlmostEqual(r['Contestant 3']['final'], 35.0, places=3)
        self.assertEqual([x['name'] for x in st['rows']], ['Contestant 2', 'Contestant 1', 'Contestant 3'])
        self.assertEqual(r['Contestant 1']['criteria'][str(self.qa.id)], 23.33)
        self.assertEqual(len(r['Contestant 1']['judges']), 3)

    def test_share_normalization_and_drop_high_low(self):
        self.standard()
        self.rnd.public_normalization = 'share'
        self.rnd.judge_aggregation = 'drop_high_low'
        self.rnd.save()
        r = self.rows()
        self.assertAlmostEqual(r['Contestant 1']['public_score'], 66.67, places=2)
        self.assertEqual(r['Contestant 1']['judge_score'], 60.0)  # 30 and 100 dropped
        self.assertAlmostEqual(r['Contestant 1']['final'], 0.7 * 60 + 0.3 * 66.6667, places=2)

    def test_drafts_and_inactive_judges_dont_count(self):
        self.sheet(self.judges[0], self.c1, 30, 30, 40)
        self.sheet(self.judges[1], self.c1, 0, 0, 0, submitted=False)
        self.assertEqual(self.rows()['Contestant 1']['judge_score'], 100)
        self.sheet(self.judges[2], self.c1, 0, 0, 0)
        self.assertEqual(self.rows()['Contestant 1']['judge_score'], 50)
        ContestJudge.objects.filter(pk=self.judges[2].pk).update(is_active=False)
        self.assertEqual(self.rows()['Contestant 1']['judge_score'], 100)

    def test_judging_off_means_public_only(self):
        self.standard()
        self.rnd.judging_enabled = False
        self.rnd.save()
        st = round_standings(self.poll, self.rnd)
        self.assertEqual(st['weights'], {'judges': 0.0, 'public': 100.0})
        self.assertEqual(st['rows'][0]['name'], 'Contestant 1')

    def test_tie_breakers(self):
        self.rnd.public_vote_enabled = False
        self.rnd.save()
        j = self.judges[0]
        self.sheet(j, self.c1, 30, 0, 40)  # 70%
        self.sheet(j, self.c2, 0, 30, 40)  # 70%
        self.rnd.tie_breakers = ['judges', f'criterion:{self.talent.id}']
        self.rnd.save()
        rows = round_standings(self.poll, self.rnd)['rows']
        self.assertEqual([(r['name'], r['rank'], r['tied']) for r in rows[:2]], [('Contestant 2', 1, False), ('Contestant 1', 2, False)])
        self.rnd.tie_breakers = [f'criterion:{self.beauty.id}']
        self.rnd.save()
        self.assertEqual(round_standings(self.poll, self.rnd)['rows'][0]['name'], 'Contestant 1')
        self.rnd.tie_breakers = ['judges']  # nothing separates them → shared rank
        self.rnd.advance_count = 1
        self.rnd.save()
        st = round_standings(self.poll, self.rnd)
        self.assertEqual([(r['rank'], r['tied']) for r in st['rows'][:2]], [(1, True), (1, True)])
        self.assertTrue(st['tie_at_cutoff'])

    def test_earliest_tie_break(self):
        self.rnd.judging_enabled = False
        self.rnd.tie_breakers = ['earliest']
        self.rnd.save()
        self.votes(self.c3, 5)
        self.votes(self.c2, 5)  # reached 5 later
        self.assertEqual([r['name'] for r in round_standings(self.poll, self.rnd)['rows'][:2]], ['Contestant 3', 'Contestant 2'])

    def test_carry_over_votes(self):
        self.votes(self.c1, 10)
        r2 = ContestRound.objects.create(poll=self.poll, name='Final', order=1, carry_over_votes=True)
        for c in (self.c1, self.c2):
            RoundEntry.objects.create(round=r2, contestant=c)
        Vote.objects.create(poll=self.poll, candidate=self.c2, voter_identifier='z', quantity=4, round=r2)
        rows = {r['name']: r['votes'] for r in round_standings(self.poll, r2)['rows']}
        self.assertEqual(rows, {'Contestant 1': 10, 'Contestant 2': 4})
        r2.carry_over_votes = False
        r2.save()
        rows = {r['name']: r['votes'] for r in round_standings(self.poll, r2)['rows']}
        self.assertEqual(rows, {'Contestant 1': 0, 'Contestant 2': 4})


class VisibilityTests(ScoringBase):
    def standings(self):
        return self.client.get(f'/api/voting/public/{self.event.slug}/contests/{self.poll.slug}/').data['standings']

    def test_levels(self):
        self.standard()
        Poll.objects.filter(pk=self.poll.pk).update(results_visibility='live', show_judge_breakdown=True)
        s = self.standings()
        self.assertEqual(s['level'], 'full')
        self.assertEqual(s['rows'][0]['votes'], 50)
        self.assertIn('judge_score', s['rows'][0])
        Poll.objects.filter(pk=self.poll.pk).update(results_visibility='ranks_only')
        s = self.standings()
        self.assertEqual(s['level'], 'ranks')
        self.assertNotIn('votes', s['rows'][0])
        self.assertIsNone(s['total_votes'])
        Poll.objects.filter(pk=self.poll.pk).update(results_visibility='top_n', results_top_n=1)
        s = self.standings()
        self.assertEqual([r['name'] for r in s['rows']], ['Contestant 2'])
        Poll.objects.filter(pk=self.poll.pk).update(results_visibility='hidden_to_public')
        self.assertIsNone(self.standings())
        # Round setting overrides the contest; after_close shows once the round closes
        self.rnd.results_visibility = 'after_close'
        self.rnd.save()
        self.assertIsNone(self.standings())
        self.rnd.status = 'closed'
        self.rnd.save()
        self.assertEqual(self.standings()['level'], 'full')
        # Contestant page shows their own standing only when visible
        res = self.client.get(f'/api/voting/public/{self.event.slug}/contests/{self.poll.slug}/c/2/')
        self.assertEqual(res.data['contestant']['standing']['rank'], 1)


class AdvancementTests(ScoringBase):
    def setUp(self):
        super().setUp()
        self.rnd.judging_enabled = False
        self.rnd.advance_count = 2
        self.rnd.save()
        self.final = ContestRound.objects.create(poll=self.poll, name='Final', order=1)
        self.votes(self.c1, 30)
        self.votes(self.c2, 20)
        self.votes(self.c3, 10)
        self.as_(self.org)
        self.url = f'{API}{self.poll.id}/rounds/'

    def test_auto_advance_and_undo(self):
        self.assertEqual(self.client.post(f'{self.url}{self.rnd.id}/decide/', {}, format='json').status_code, 400)  # confirm
        res = self.client.post(f'{self.url}{self.rnd.id}/decide/', {'confirm': True}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(set(res.data['advanced']), {str(self.c1.id), str(self.c2.id)})
        self.c3.refresh_from_db()
        self.assertEqual(self.c3.status, 'eliminated')
        self.assertEqual(set(self.final.entries.values_list('contestant__number', flat=True)), {1, 2})
        e3 = RoundEntry.objects.get(round=self.rnd, contestant=self.c3)
        self.assertEqual((e3.status, e3.rank), ('eliminated', 3))
        self.assertTrue(self.poll.audit_log.filter(action='round_decided').exists())
        self.assertEqual(self.client.post(f'{self.url}{self.rnd.id}/decide/', {'confirm': True}, format='json').status_code, 409)
        # Eliminated contestant can no longer be voted for once the final opens
        self.client.post(f'{self.url}{self.final.id}/open/')
        self.client.force_authenticate(user=None)
        self.assertEqual(self.vote(self.poll, self.c3).status_code, 409)
        self.as_(self.org)
        # Undo is refused once the next round has votes …
        Vote.objects.create(poll=self.poll, candidate=self.c1, voter_identifier='q', round=self.final)
        self.assertEqual(self.client.post(f'{self.url}{self.rnd.id}/undo/').data['code'], 'next_round_started')
        Vote.objects.filter(round=self.final).delete()
        # … and works before
        self.assertEqual(self.client.post(f'{self.url}{self.rnd.id}/undo/').status_code, 200)
        self.c3.refresh_from_db()
        self.assertEqual(self.c3.status, 'active')
        self.assertEqual(self.final.entries.count(), 0)

    def test_tie_at_cutoff_needs_manual_pick(self):
        self.votes(self.c3, 10)  # c2 and c3 now both 20
        self.rnd.tie_breakers = ['judges', 'public']  # without "earliest" nothing separates them
        self.rnd.save()
        res = self.client.post(f'{self.url}{self.rnd.id}/decide/', {'confirm': True}, format='json')
        self.assertEqual(res.data['code'], 'tie_at_cutoff')
        res = self.client.post(f'{self.url}{self.rnd.id}/decide/', {'confirm': True, 'contestant_ids': [str(self.c1.id), str(self.c3.id)]}, format='json')
        self.assertEqual(res.status_code, 200)
        self.c2.refresh_from_db()
        self.assertEqual(self.c2.status, 'eliminated')

    def test_final_round_crowns_winner(self):
        self.client.post(f'{self.url}{self.rnd.id}/decide/', {'confirm': True}, format='json')
        Vote.objects.create(poll=self.poll, candidate=self.c2, voter_identifier='f', quantity=9, round=self.final)
        Vote.objects.create(poll=self.poll, candidate=self.c1, voter_identifier='g', quantity=3, round=self.final)
        res = self.client.post(f'{self.url}{self.final.id}/decide/', {'confirm': True}, format='json')
        self.assertEqual(res.data['winner'], str(self.c2.id))
        self.c2.refresh_from_db()
        self.assertEqual(self.c2.status, 'winner')
        self.assertEqual(list(self.final.entries.order_by('rank').values_list('contestant__number', 'rank')), [(2, 1), (1, 2)])
        results = self.client.get(f'{API}{self.poll.id}/results/').data
        self.assertEqual(len(results['rounds']), 2)

    def test_manual_mode_requires_pick(self):
        self.rnd.advance_mode = 'manual'
        self.rnd.save()
        self.assertEqual(self.client.post(f'{self.url}{self.rnd.id}/decide/', {'confirm': True}, format='json').data['code'], 'pick_required')


class JudgeTests(ScoringBase):
    def setUp(self):
        super().setUp()
        self.judge = self.judges[0]
        self.client.force_authenticate(user=self.judge.user)
        self.url = f'/api/voting/judge/{self.judge.id}/'

    def put(self, contestant, scores, submit=False, **kw):
        return self.client.put(self.url, {'round': str(self.rnd.id), 'contestant': str(contestant.id), 'scores': scores,
                                          'submit': submit, **kw}, format='json')

    def test_invite_new_and_existing(self):
        self.as_(self.org)
        res = self.client.post(f'{API}{self.poll.id}/judges/', {'email': 'NewJudge@x.com', 'name': 'Rina Thapa'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(res.data['temporary_password'])
        user = User.objects.get(email='newjudge@x.com')
        self.assertEqual(user.role, 'attendee')
        self.assertTrue(user.check_password(res.data['temporary_password']))
        res = self.client.post(f'{API}{self.poll.id}/judges/', {'email': 'other@x.com'}, format='json')
        self.assertFalse(res.data['created'])
        self.assertIsNone(res.data['temporary_password'])
        self.assertEqual(self.client.post(f'{API}{self.poll.id}/judges/', {'email': 'other@x.com'}, format='json').status_code, 400)
        from django.core import mail
        self.assertTrue(any('judge' in m.subject for m in mail.outbox))

    def test_scoring_flow_lock_and_unlock(self):
        mine = self.client.get('/api/voting/judge/').data
        self.assertEqual(mine[0]['contest'], 'Contest')
        data = self.client.get(self.url).data
        self.assertEqual(len(data['contestants']), 3)
        self.assertEqual(data['round']['criteria'][0]['name'], 'Beauty')
        s = {str(self.beauty.id): 25}
        self.assertEqual(self.put(self.c1, s).data['status'], 'draft')
        res = self.put(self.c1, s, submit=True)
        self.assertEqual(res.status_code, 400)  # all criteria needed to submit
        full = {str(self.beauty.id): 25, str(self.talent.id): 20, str(self.qa.id): 35}
        self.assertEqual(self.put(self.c1, {**full, str(self.qa.id): 41}).status_code, 400)  # above max
        res = self.put(self.c1, full, submit=True, comment='Strong Q&A')
        self.assertEqual((res.data['status'], res.data['percent']), ('submitted', 80.0))
        self.assertEqual(self.put(self.c1, full).status_code, 409)  # locked
        sheet = ScoreSheet.objects.get(judge=self.judge, contestant=self.c1)
        self.as_(self.org)
        self.assertEqual(self.client.post(f'{API}{self.poll.id}/sheets/{sheet.id}/unlock/').status_code, 200)
        self.assertTrue(self.poll.audit_log.filter(action='sheet_unlocked').exists())
        self.client.force_authenticate(user=self.judge.user)
        self.assertEqual(self.put(self.c1, full).status_code, 200)

    def test_conflict_of_interest_and_privacy(self):
        self.as_(self.org)
        self.client.patch(f'{API}{self.poll.id}/judges/{self.judge.id}/', {'excluded_contestants': [str(self.c2.id)]}, format='json')
        self.sheet(self.judges[1], self.c1, 30, 30, 40)
        self.client.force_authenticate(user=self.judge.user)
        data = self.client.get(self.url).data
        self.assertEqual([c['name'] for c in data['contestants']], ['Contestant 1', 'Contestant 3'])
        self.assertIsNone(data['contestants'][0]['others'])
        self.assertEqual(self.put(self.c2, {}).status_code, 403)
        Poll.objects.filter(pk=self.poll.pk).update(judges_see_others=True)
        data = self.client.get(self.url).data
        self.assertEqual(data['contestants'][0]['others'][0]['percent'], 100.0)

    def test_only_own_assignment_and_round_state(self):
        self.client.force_authenticate(user=self.judges[1].user)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.client.force_authenticate(user=self.org)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.client.force_authenticate(user=self.judge.user)
        ContestRound.objects.filter(pk=self.rnd.pk).update(status='upcoming')
        self.assertEqual(self.put(self.c1, {}).status_code, 409)
        ContestRound.objects.filter(pk=self.rnd.pk).update(status='closed', finalized_at='2026-11-01T00:00:00Z')
        self.assertIn('decided', self.put(self.c1, {}).data['error'])
        ContestJudge.objects.filter(pk=self.judge.pk).update(is_active=False)
        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_organizer_sees_all_sheets_and_progress(self):
        self.standard()
        self.as_(self.org)
        sheets = self.client.get(f'{API}{self.poll.id}/sheets/?round={self.rnd.id}').data
        self.assertEqual(len(sheets), 9)
        judges = self.client.get(f'{API}{self.poll.id}/judges/').data
        self.assertEqual(judges[0]['progress'][0], {'round_id': str(self.rnd.id), 'name': 'Round 1', 'expected': 3, 'submitted': 3, 'drafts': 0})
        # A judge with submitted scores is deactivated, not deleted
        res = self.client.delete(f'{API}{self.poll.id}/judges/{self.judges[2].id}/')
        self.assertEqual(res.status_code, 200)
        self.assertFalse(ContestJudge.objects.get(pk=self.judges[2].pk).is_active)
        withdrawn = Candidate.objects.get(pk=self.c3.pk)
        self.assertEqual(withdrawn.status, 'active')
