"""Contests: setup, presets, contestants, public pages and vote rules (allowances, daily reset, rounds, categories)."""
from datetime import datetime, timezone as dt_timezone
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.events.models import Event, EventTicket
from .models import Candidate, ContestCategory, ContestRound, Poll, RoundEntry, Vote

User = get_user_model()
API = '/api/voting/contests/'


def make_user(email, role='organizer', **kw):
    return User.objects.create_user(username=email.split('@')[0], email=email, password='pw-123456', role=role, **kw)


class ContestBase(APITestCase):
    def setUp(self):
        cache.clear()
        from apps.accounts import modules
        modules.clear_cache()
        self.org = make_user('org@x.com')
        self.other = make_user('other@x.com')
        self.staff = make_user('staff@x.com', 'staff')
        self.event = Event.objects.create(organizer=self.org, title='Miss Dharan', slug='miss-dharan', location='Dharan',
                                          start_date=timezone.localdate(), status=Event.Status.PUBLISHED)

    def as_(self, user):
        self.client.force_authenticate(user=user)

    def create_contest(self, preset='pageant', **kw):
        self.as_(self.org)
        res = self.client.post(API, {'event': str(self.event.id), 'title': 'Miss Dharan 2026', 'preset': preset, **kw}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.client.force_authenticate(user=None)
        return Poll.objects.get(pk=res.data['id'])

    def simple_contest(self, n=3, rounds=False, **settings):
        """Open contest, device voting, no rounds unless asked, n contestants."""
        poll = Poll.objects.create(event=self.event, kind=Poll.Kind.CONTEST, title='Contest', slug='contest',
                                   status=Poll.Status.OPEN, vote_mode=Poll.VoteMode.OPEN, ip_votes_per_minute=0,
                                   device_votes_per_minute=0, **settings)
        for i in range(n):
            Candidate.objects.create(poll=poll, name=f'Contestant {i + 1}', number=i + 1, slug=f'c{i + 1}', order=i)
        if rounds:
            r = ContestRound.objects.create(poll=poll, name='Round 1', order=0, status=ContestRound.Status.OPEN)
            for c in poll.candidates.all():
                RoundEntry.objects.create(round=r, contestant=c)
        return poll

    def c(self, poll, number):
        return poll.candidates.get(number=number)

    def vote(self, poll, contestant, device='dev-1', **kw):
        body = {'contestant': str(contestant.id) if isinstance(contestant, Candidate) else contestant, 'device_id': device, **kw}
        return self.client.post(f'/api/voting/public/{self.event.slug}/contests/{poll.slug}/vote/', body, format='json')


def at(y, m, d, hh, mm):
    return datetime(y, m, d, hh, mm, tzinfo=dt_timezone.utc)


class SetupTests(ContestBase):
    def test_presets_listed(self):
        self.as_(self.org)
        keys = [p['key'] for p in self.client.get(API + 'presets/').data]
        self.assertEqual(keys, ['pageant', 'talent', 'awards', 'quick'])

    def test_pageant_preset_fills_everything(self):
        poll = self.create_contest()
        self.assertEqual(poll.kind, 'contest')
        self.assertEqual(poll.slug, 'miss-dharan-2026')
        self.assertEqual(list(poll.rounds.values_list('name', flat=True)), ['Audition', 'Top 20', 'Top 10', 'Finale'])
        finale = poll.rounds.get(name='Finale')
        self.assertEqual((finale.judge_weight, finale.public_weight), (70, 30))
        self.assertEqual(list(finale.criteria.values_list('name', 'max_points')), [('Beauty', 30), ('Talent', 30), ('Q&A', 40)])
        self.assertEqual(poll.votes_per_day, 5)
        self.assertEqual(poll.vote_mode, 'sms_otp')
        best_talent = poll.categories.get(name='Best Talent')
        self.assertEqual(best_talent.criterion.name, 'Talent')
        self.assertTrue(poll.profile_fields.filter(key='phone', is_public=False).exists())

    def test_awards_and_talent_presets(self):
        poll = self.create_contest('awards')
        self.assertFalse(poll.main_vote_enabled)
        self.assertEqual(poll.categories.count(), 3)
        self.assertEqual(poll.rounds.count(), 0)
        self.as_(self.org)
        res = self.client.post(f'{API}{poll.id}/preset/', {'preset': 'talent'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(len(res.data['rounds']), 2)
        self.assertEqual(res.data['vote_mode'], 'ticket')

    def test_preset_blocked_after_votes(self):
        poll = self.simple_contest()
        self.vote(poll, self.c(poll, 1))
        self.as_(self.org)
        self.assertEqual(self.client.post(f'{API}{poll.id}/preset/', {'preset': 'awards'}, format='json').status_code, 409)

    def test_permissions(self):
        poll = self.create_contest()
        self.as_(self.other)
        self.assertEqual(self.client.get(f'{API}{poll.id}/').status_code, 404)
        self.assertEqual(self.client.post(API, {'event': str(self.event.id), 'preset': 'pageant'}, format='json').status_code, 403)
        self.as_(self.staff)
        self.assertEqual(self.client.get(API).status_code, 403)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(API).status_code, 401)

    def test_update_settings_and_nested(self):
        poll = self.create_contest()
        self.as_(self.org)
        data = self.client.get(f'{API}{poll.id}/').data
        rounds = data['rounds']
        rounds[0]['name'] = 'Online auditions'
        rounds[3]['criteria'].append({'name': 'Walk', 'max_points': 10, 'weight': 2})
        res = self.client.patch(f'{API}{poll.id}/', {
            'votes_per_day': 10, 'rounds': rounds,
            'categories': [{'name': 'Best Walk', 'selection': 'judges', 'round_ref': 'Finale', 'criterion_ref': 'Walk'}],
            'vote_packs': [{'label': 'Fan pack', 'votes': 50, 'bonus_votes': 5, 'price': '450.00'}],
            'paid_votes_enabled': True,
        }, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['rounds'][0]['name'], 'Online auditions')
        self.assertEqual(len(res.data['rounds'][3]['criteria']), 4)
        cat = poll.categories.get()
        self.assertEqual((cat.criterion.name, cat.round.name), ('Walk', 'Finale'))
        self.assertEqual(poll.vote_packs.get().bonus_votes, 5)

    def test_validation(self):
        poll = self.create_contest()
        self.as_(self.org)
        bad = self.client.patch(f'{API}{poll.id}/', {'votes_per_voter': None, 'votes_per_day': None, 'votes_per_round': None}, format='json')
        self.assertIn('votes_per_voter', bad.data)
        rounds = self.client.get(f'{API}{poll.id}/').data['rounds']
        rounds[1]['judge_weight'] = 80  # + public 50 ≠ 100
        self.assertIn('rounds', self.client.patch(f'{API}{poll.id}/', {'rounds': rounds}, format='json').data)
        self.assertIn('vote_packs', self.client.patch(f'{API}{poll.id}/', {'paid_votes_enabled': True}, format='json').data)

    def test_round_with_votes_cannot_be_removed(self):
        poll = self.simple_contest(rounds=True)
        self.vote(poll, self.c(poll, 1))
        self.as_(self.org)
        res = self.client.patch(f'{API}{poll.id}/', {'rounds': []}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_contest_open_close(self):
        poll = self.create_contest()
        self.as_(self.org)
        self.assertEqual(self.client.post(f'{API}{poll.id}/status/open/').status_code, 400)  # no contestants
        self.client.post(f'{API}{poll.id}/contestants/', {'name': 'Asha'}, format='json')
        self.assertEqual(self.client.post(f'{API}{poll.id}/status/open/').data['status'], 'open')
        self.assertEqual(self.client.post(f'{API}{poll.id}/status/close/').data['status'], 'closed')


class ContestantTests(ContestBase):
    def setUp(self):
        super().setUp()
        self.poll = self.create_contest()
        self.as_(self.org)
        self.url = f'{API}{self.poll.id}/contestants/'

    def test_auto_number_slug_and_first_round(self):
        a = self.client.post(self.url, {'name': 'Asha Rai', 'profile': {'age': '21', 'district': 'Sunsari'}}, format='json')
        self.assertEqual(a.status_code, 201, a.data)
        self.assertEqual((a.data['number'], a.data['display_number'], a.data['slug']), (1, '#01', 'asha-rai'))
        b = self.client.post(self.url, {'name': 'Asha Rai'}, format='json')
        self.assertEqual((b.data['number'], b.data['slug']), (2, 'asha-rai-2'))
        audition = self.poll.rounds.get(name='Audition')
        self.assertEqual(audition.entries.count(), 2)

    def test_number_unique_and_profile_validation(self):
        self.client.post(self.url, {'name': 'A', 'number': 7}, format='json')
        res = self.client.post(self.url, {'name': 'B', 'number': 7}, format='json')
        self.assertIn('number', res.data)
        self.assertIn('profile', self.client.post(self.url, {'name': 'C', 'profile': {'age': 'old'}}, format='json').data)
        res = self.client.post(self.url, {'name': 'D', 'social_links': {'instagram': 'instagram.com/d'}, 'gallery': ['/media/uploads/misc/x/a.jpg']}, format='json')
        self.assertEqual(res.data['social_links']['instagram'], 'https://instagram.com/d')
        self.assertIn('gallery', self.client.post(self.url, {'name': 'E', 'gallery': ['http://evil/x.jpg']}, format='json').data)
        self.assertIn('social_links', self.client.post(self.url, {'name': 'F', 'social_links': {'myspace': 'x'}}, format='json').data)

    def test_bulk_import_reorder_renumber(self):
        res = self.client.post(f'{self.url}bulk/', {'contestants': [{'name': 'A'}, {'name': 'B'}]}, format='json')
        self.assertEqual(res.status_code, 201)
        csv_text = 'Name,No,Age,District,Bio\nSita,10,22,Morang,Dancer\nGita,,19,Jhapa,\n'
        res = self.client.post(f'{self.url}import/', {'csv': csv_text}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        sita = self.poll.candidates.get(name='Sita')
        self.assertEqual((sita.number, sita.profile['age'], sita.description), (10, '22', 'Dancer'))
        self.assertEqual(self.poll.candidates.get(name='Gita').number, 11)
        bad = self.client.post(f'{self.url}import/', {'csv': 'Name,Age\nX,abc\n'}, format='json')
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(self.poll.candidates.count(), 4)  # nothing from the bad file
        ids = list(self.poll.candidates.order_by('-name').values_list('id', flat=True))
        res = self.client.post(f'{self.url}reorder/', {'ids': [str(i) for i in ids], 'renumber': True}, format='json')
        self.assertEqual([c['number'] for c in res.data], [1, 2, 3, 4])
        self.assertEqual(res.data[0]['name'], 'Sita')

    def test_delete_blocked_with_votes_withdraw_instead(self):
        c = self.client.post(self.url, {'name': 'A'}, format='json').data
        poll = self.poll
        Vote.objects.create(poll=poll, candidate_id=c['id'], voter_identifier='x')
        self.assertEqual(self.client.delete(f'{self.url}{c["id"]}/').status_code, 409)
        res = self.client.patch(f'{self.url}{c["id"]}/', {'status': 'withdrawn'}, format='json')
        self.assertEqual(res.data['status'], 'withdrawn')
        self.assertTrue(poll.audit_log.filter(action='contestant_status').exists())


class PublicPageTests(ContestBase):
    def test_draft_is_hidden_open_is_public(self):
        poll = self.create_contest()
        self.as_(self.org)
        self.client.post(f'{API}{poll.id}/contestants/', {'name': 'Asha', 'description': 'Bio', 'profile': {'age': '21', 'phone': '9800000000'}}, format='json')
        self.client.force_authenticate(user=None)
        url = f'/api/voting/public/{self.event.slug}/contests/{poll.slug}/'
        self.assertEqual(self.client.get(url).status_code, 404)
        Poll.objects.filter(pk=poll.pk).update(status='open')
        data = self.client.get(url).data
        self.assertEqual(data['kind'], 'contest')
        self.assertEqual(data['contestants'][0]['display_number'], '#01')
        self.assertEqual([p['key'] for p in data['contestants'][0]['profile']], ['age'])  # private phone not shown
        self.assertFalse(data['voting_open'])  # no round open yet
        # Contestant page by number, padded number and slug
        for ref in ('1', '01', '%2301', 'asha'):
            res = self.client.get(f'{url}c/{ref}/')
            self.assertEqual(res.status_code, 200, ref)
            self.assertEqual(res.data['contestant']['name'], 'Asha')
        self.assertEqual(self.client.get(f'{url}c/99/').status_code, 404)
        # Also listed on the event's voting page and by uuid on the old path
        listed = self.client.get(f'/api/voting/public/{self.event.slug}/').data['polls']
        self.assertEqual(listed[0]['kind'], 'contest')
        self.assertEqual(self.client.get(f'/api/voting/public/{self.event.slug}/{poll.id}/').data['kind'], 'contest')

    def test_og_page(self):
        poll = self.simple_contest()
        res = self.client.get(f'/api/voting/og/{self.event.slug}/{poll.slug}/c/2/')
        self.assertEqual(res.status_code, 200)
        html = res.content.decode()
        self.assertIn('og:title" content="Vote for #02 Contestant 2', html)
        self.assertIn('/e/miss-dharan/vote/contest/c/2', html)
        self.assertIn('http-equiv="refresh"', html)

    def test_shared_links_carry_their_own_preview(self):
        # The plain /e/… links people share are answered by apps.seo with the contest's own tags
        poll = self.simple_contest()
        html = self.client.get(f'/e/{self.event.slug}/vote/{poll.slug}/c/2', HTTP_HOST='eventlaya.com').content.decode()
        self.assertIn('Vote for #02 Contestant 2', html)
        self.assertIn('/e/miss-dharan/vote/contest/c/2', html)
        html = self.client.get(f'/e/{self.event.slug}/vote/{poll.slug}', HTTP_HOST='eventlaya.com').content.decode()
        self.assertIn('og:title" content="Contest"', html)
        res = self.client.get(f'/e/{self.event.slug}/vote/{poll.slug}/c/99', HTTP_HOST='eventlaya.com')
        self.assertEqual(res.status_code, 404)
        # Drafts don't leak their title
        Poll.objects.filter(pk=poll.pk).update(status=Poll.Status.DRAFT)
        html = self.client.get(f'/e/{self.event.slug}/vote/{poll.slug}', HTTP_HOST='eventlaya.com').content.decode()
        self.assertNotIn('Contestant', html)
        self.assertNotIn('og:title" content="Contest"', html)

    def test_tenant_scoping(self):
        from apps.accounts.test_whitelabel import DFF_DOMAIN, approve
        from apps.accounts import tenancy
        tenancy.clear_cache()
        self.addCleanup(tenancy.clear_cache)
        dff = make_user('dff@x.com', organization_name='DFF')
        approve(dff, subdomain='dff', custom_domain=DFF_DOMAIN, brand_name='DFF', is_domain_verified=True, ssl_active=True)
        poll = self.simple_contest()
        url = f'/api/voting/public/{self.event.slug}/contests/{poll.slug}/'
        self.assertEqual(self.client.get(url, HTTP_HOST=DFF_DOMAIN).status_code, 404)  # another organizer's site
        self.assertEqual(self.client.get(url).status_code, 200)
        res = self.client.post(f'{url}vote/', {'contestant': '1', 'device_id': 'd'}, format='json', HTTP_HOST=DFF_DOMAIN)
        self.assertEqual(res.status_code, 404)


class VoteRuleTests(ContestBase):
    def test_one_vote_per_voter(self):
        poll = self.simple_contest()
        res = self.vote(poll, self.c(poll, 1))
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['allowance']['free_remaining'], 0)
        res = self.vote(poll, self.c(poll, 2))
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['code'], 'allowance_used')
        self.assertEqual(self.vote(poll, self.c(poll, 2), device='dev-2').status_code, 201)

    def test_daily_reset_in_nepal_time(self):
        poll = self.simple_contest(votes_per_voter=None, votes_per_day=2)
        # 2026-11-01 18:10 UTC = 23:55 Nov 1 in Nepal (UTC+5:45); 18:20 UTC = 00:05 Nov 2
        with mock.patch('django.utils.timezone.now', return_value=at(2026, 11, 1, 18, 10)):
            self.assertEqual(self.vote(poll, self.c(poll, 1)).status_code, 201)
            self.assertEqual(self.vote(poll, self.c(poll, 2)).status_code, 201)
            res = self.vote(poll, self.c(poll, 1))
            self.assertEqual(res.status_code, 409)
            self.assertIn('midnight, Nepal time', res.data['error'])
        with mock.patch('django.utils.timezone.now', return_value=at(2026, 11, 1, 18, 20)):
            res = self.vote(poll, self.c(poll, 1))
            self.assertEqual(res.status_code, 201, res.data)
            self.assertEqual(res.data['allowance']['free_remaining'], 1)
        self.assertEqual(sorted(str(d) for d in Vote.objects.values_list('nepal_date', flat=True).distinct()), ['2026-11-01', '2026-11-02'])

    def test_quantity_contestant_cap_and_split(self):
        poll = self.simple_contest(votes_per_voter=10, max_votes_per_submit=5, votes_per_contestant=6)
        self.assertEqual(self.vote(poll, self.c(poll, 1), quantity=6).status_code, 400)  # more than 5 at once
        self.assertEqual(self.vote(poll, self.c(poll, 1), quantity=5).status_code, 201)
        res = self.vote(poll, self.c(poll, 1), quantity=2)
        self.assertEqual(res.status_code, 409)  # contestant cap 6 → only 1 left
        self.assertIn('1 free vote left', res.data['error'])
        self.assertEqual(self.vote(poll, self.c(poll, 1), quantity=1).status_code, 201)
        self.assertEqual(self.vote(poll, self.c(poll, 2), quantity=4).status_code, 201)
        self.assertEqual(sum(Vote.objects.filter(candidate=self.c(poll, 1)).values_list('quantity', flat=True)), 6)
        nosplit = Poll.objects.create(event=self.event, kind='contest', title='No split', slug='nosplit', status='open',
                                      vote_mode='open', votes_per_voter=5, allow_split=False, ip_votes_per_minute=0)
        a = Candidate.objects.create(poll=nosplit, name='A', number=1)
        b = Candidate.objects.create(poll=nosplit, name='B', number=2)
        self.assertEqual(self.vote(nosplit, a).status_code, 201)
        res = self.vote(nosplit, b)
        self.assertEqual(res.data['code'], 'no_split')
        self.assertEqual(self.vote(nosplit, a).status_code, 201)

    def test_rounds_gate_voting(self):
        poll = self.simple_contest(rounds=True, votes_per_voter=None, votes_per_round=1)
        r1 = poll.rounds.get()
        r2 = ContestRound.objects.create(poll=poll, name='Final', order=1)
        res = self.vote(poll, self.c(poll, 1))
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Vote.objects.get().round, r1)
        self.assertEqual(self.vote(poll, self.c(poll, 2)).status_code, 409)  # 1 per round
        r1.status = 'closed'
        r1.save()
        res = self.vote(poll, self.c(poll, 2))
        self.assertEqual(res.data['code'], 'no_open_round')
        RoundEntry.objects.create(round=r2, contestant=self.c(poll, 2))
        Candidate.objects.filter(pk=self.c(poll, 1).pk).update(status='eliminated')
        r2.status = 'open'
        r2.save()
        self.assertEqual(self.vote(poll, self.c(poll, 1)).status_code, 409)  # eliminated
        self.assertEqual(self.vote(poll, self.c(poll, 3)).status_code, 409)  # not in the final
        self.assertEqual(self.vote(poll, self.c(poll, 2)).status_code, 201)  # new round, new allowance

    def test_scheduled_round_opens_on_its_own(self):
        poll = self.simple_contest(rounds=True)
        r = poll.rounds.get()
        r.status = 'upcoming'
        r.opens_at = at(2026, 11, 1, 10, 0)
        r.save()
        with mock.patch('django.utils.timezone.now', return_value=at(2026, 11, 1, 9, 0)):
            self.assertEqual(self.vote(poll, self.c(poll, 1)).data['code'], 'no_open_round')
        with mock.patch('django.utils.timezone.now', return_value=at(2026, 11, 1, 10, 1)):
            self.assertEqual(self.vote(poll, self.c(poll, 1)).status_code, 201)

    def test_categories_one_vote_each(self):
        poll = self.simple_contest(votes_per_voter=1, main_vote_enabled=False)
        film = ContestCategory.objects.create(poll=poll, name='Best Film', slug='best-film')
        film.nominees.set([self.c(poll, 1), self.c(poll, 2)])
        actor = ContestCategory.objects.create(poll=poll, name='Best Actor', slug='best-actor')
        jury = ContestCategory.objects.create(poll=poll, name='Jury Prize', slug='jury', selection='manual')
        self.assertEqual(self.vote(poll, self.c(poll, 1)).status_code, 400)  # main vote off: pick a category
        self.assertEqual(self.vote(poll, self.c(poll, 3), category=str(film.id)).status_code, 409)  # not nominated
        self.assertEqual(self.vote(poll, self.c(poll, 1), category=str(film.id)).status_code, 201)
        self.assertEqual(self.vote(poll, self.c(poll, 2), category=str(film.id)).status_code, 409)
        self.assertEqual(self.vote(poll, self.c(poll, 3), category='best-actor').status_code, 201)
        self.assertEqual(self.vote(poll, self.c(poll, 3), category=str(jury.id)).status_code, 409)
        res = self.client.post(f'/api/voting/public/{self.event.slug}/contests/{poll.slug}/allowance/', {'device_id': 'dev-1'}, format='json')
        self.assertEqual(res.data['categories'][str(film.id)]['free_remaining'], 0)
        self.assertEqual(res.data['categories'][str(actor.id)]['voted_for'], [str(self.c(poll, 3).id)])

    def test_closed_scheduled_withdrawn(self):
        poll = self.simple_contest(votes_per_voter=5)
        Candidate.objects.filter(number=3).update(status='withdrawn')
        self.assertIn('withdrawn', self.vote(poll, self.c(poll, 3)).data['error'])
        self.assertEqual(self.vote(poll, '99').status_code, 404)
        Poll.objects.filter(pk=poll.pk).update(status='closed')
        self.assertEqual(self.vote(poll, self.c(poll, 1)).data['code'], 'closed')

    def test_ticket_and_account_modes(self):
        poll = self.simple_contest(votes_per_voter=1)
        Poll.objects.filter(pk=poll.pk).update(vote_mode='ticket')
        t = EventTicket.generate_ticket(self.event, 'Asha', 'asha@x.com')
        self.assertEqual(self.vote(poll, self.c(poll, 1)).status_code, 400)
        self.assertEqual(self.vote(poll, self.c(poll, 1), ticket_code=t.ticket_number).status_code, 201)
        self.assertEqual(self.vote(poll, self.c(poll, 2), ticket_code=t.ticket_number).status_code, 409)
        Poll.objects.filter(pk=poll.pk).update(vote_mode='account')
        self.assertEqual(self.vote(poll, self.c(poll, 1)).data['code'], 'sign_in_required')
        self.as_(make_user('fan@x.com', 'attendee'))
        self.assertEqual(self.vote(poll, self.c(poll, 1)).status_code, 201)

    def test_legacy_vote_path_delegates_to_contest(self):
        poll = self.simple_contest()
        res = self.client.post(f'/api/voting/public/{self.event.slug}/{poll.id}/vote/', {'contestant': '2', 'device_id': 'z'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(Vote.objects.get().candidate.number, 2)
        res = self.client.post(f'/api/voting/polls/{poll.id}/vote/', {'candidate_id': str(self.c(poll, 1).id)}, format='json')
        self.assertEqual(res.data['code'], 'is_contest')


class ContestantAllowanceTests(ContestBase):
    """allowance/ and the vote response tell the voter how many free votes one contestant can still get."""

    def allowance(self, poll, contestant=None, device='dev-1'):
        body = {'device_id': device}
        if contestant is not None:
            body['contestant'] = str(contestant.id) if isinstance(contestant, Candidate) else contestant
        return self.client.post(f'/api/voting/public/{self.event.slug}/contests/{poll.slug}/allowance/', body, format='json')

    def test_cap_hit_and_existing_fields_unchanged(self):
        poll = self.simple_contest(votes_per_voter=10, max_votes_per_submit=5, votes_per_contestant=3)
        res = self.allowance(poll, self.c(poll, 1))
        self.assertEqual(res.status_code, 200, res.data)
        main = res.data['main']
        self.assertEqual((main['free_remaining'], main['credits'], main['voted_for']), (10, 0, []))
        self.assertEqual((main['contestant_free_remaining'], main['contestant_used'], main['contestant_cap']), (3, 0, 3))
        self.assertEqual(main['contestant_id'], str(self.c(poll, 1).id))
        res = self.vote(poll, self.c(poll, 1), quantity=2)
        self.assertEqual(res.status_code, 201)
        a = res.data['allowance']  # vote response: for the contestant just voted for
        self.assertEqual((a['free_remaining'], a['contestant_free_remaining'], a['contestant_used']), (8, 1, 2))
        self.assertEqual(self.vote(poll, self.c(poll, 1), quantity=2).status_code, 409)  # server agrees: only 1 left
        self.assertEqual(self.vote(poll, self.c(poll, 1), quantity=1).status_code, 201)
        main = self.allowance(poll, self.c(poll, 1)).data['main']
        self.assertEqual((main['free_remaining'], main['contestant_free_remaining'], main['contestant_used']), (7, 0, 3))
        other = self.allowance(poll, self.c(poll, 2)).data['main']
        self.assertEqual((other['contestant_free_remaining'], other['contestant_used']), (3, 0))
        # Without a contestant the response is exactly as before
        self.assertNotIn('contestant_free_remaining', self.allowance(poll).data['main'])
        self.assertEqual(self.allowance(poll, '99').status_code, 404)

    def test_no_cap_is_null_and_overall_limit_still_wins(self):
        poll = self.simple_contest(votes_per_voter=2, max_votes_per_submit=5)
        main = self.allowance(poll, self.c(poll, 1)).data['main']
        self.assertIsNone(main['contestant_free_remaining'])
        self.assertIsNone(main['contestant_used'])
        Poll.objects.filter(pk=poll.pk).update(votes_per_contestant=5)
        main = self.allowance(poll, self.c(poll, 1)).data['main']
        self.assertEqual(main['contestant_free_remaining'], 2)  # min(per-voter 2, per-contestant 5)

    def test_daily_cap_resets_at_nepal_midnight(self):
        poll = self.simple_contest(votes_per_voter=None, votes_per_day=10, votes_per_contestant=2, contestant_cap_period='day',
                                   max_votes_per_submit=5)
        with mock.patch('django.utils.timezone.now', return_value=at(2026, 11, 1, 18, 10)):  # 23:55 Nepal
            self.assertEqual(self.vote(poll, self.c(poll, 1), quantity=2).status_code, 201)
            main = self.allowance(poll, self.c(poll, 1)).data['main']
            self.assertEqual((main['contestant_free_remaining'], main['contestant_used']), (0, 2))
        with mock.patch('django.utils.timezone.now', return_value=at(2026, 11, 1, 18, 20)):  # 00:05 next day
            main = self.allowance(poll, self.c(poll, 1)).data['main']
            self.assertEqual((main['contestant_free_remaining'], main['contestant_used']), (2, 0))

    def test_category_counts_separately_from_main_vote(self):
        poll = self.simple_contest(votes_per_voter=10, max_votes_per_submit=5, votes_per_contestant=2)
        cat = ContestCategory.objects.create(poll=poll, name="People's Choice", slug='pc')
        self.assertEqual(self.vote(poll, self.c(poll, 1), quantity=2).status_code, 201)
        res = self.allowance(poll, self.c(poll, 1))
        self.assertEqual(res.data['main']['contestant_free_remaining'], 0)
        self.assertEqual(res.data['categories'][str(cat.id)]['contestant_free_remaining'], 2)
        res = self.vote(poll, self.c(poll, 1), category=str(cat.id), quantity=1)
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['allowance']['contestant_free_remaining'], 1)

    def test_credits_usable_beyond_the_free_cap(self):
        from .credits import grant_credits, voter_hash_for
        poll = self.simple_contest(votes_per_voter=10, max_votes_per_submit=5, votes_per_contestant=2)
        grant_credits(poll, voter_hash_for(poll, device_id='dev-1'), 4, source='bonus', note='test')
        main = self.allowance(poll, self.c(poll, 1)).data['main']
        self.assertEqual((main['contestant_free_remaining'], main['credits']), (2, 4))
        # The most one vote can give = min(max per submit 5, 2 free + 4 credits) = 5, and the server accepts it
        res = self.vote(poll, self.c(poll, 1), quantity=5)
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual((res.data['allowance']['contestant_free_remaining'], res.data['allowance']['credits']), (0, 1))
        self.assertEqual(self.vote(poll, self.c(poll, 1), quantity=2).status_code, 409)  # 0 free + 1 credit
        self.assertEqual(self.vote(poll, self.c(poll, 1), quantity=1).status_code, 201)
