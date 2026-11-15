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
        self.assertEqual(keys, ['simple', 'pageant', 'talent', 'awards', 'quick'])

    def test_simple_preset_has_no_rounds_judges_or_awards(self):
        poll = self.create_contest(preset='simple')
        self.assertEqual((poll.rounds.count(), poll.categories.count(), poll.profile_fields.count()), (0, 0, 0))
        self.assertTrue(poll.main_vote_enabled)

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
        self.assertEqual(data['contestants'][0]['display_number'], '')  # numbers hidden unless the organizer shows them
        Poll.objects.filter(pk=poll.pk).update(show_numbers=True)
        data = self.client.get(url).data
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
        poll = self.simple_contest(show_numbers=True)
        res = self.client.get(f'/api/voting/og/{self.event.slug}/{poll.slug}/c/2/')
        self.assertEqual(res.status_code, 200)
        html = res.content.decode()
        self.assertIn('og:title" content="Vote for #02 Contestant 2', html)
        self.assertIn('/e/miss-dharan/vote/contest/c/2', html)
        self.assertIn('http-equiv="refresh"', html)
        # Numbers hidden (the default): no "#02" in the preview, and the link uses the name
        Poll.objects.filter(pk=poll.pk).update(show_numbers=False)
        html = self.client.get(f'/api/voting/og/{self.event.slug}/{poll.slug}/c/2/').content.decode()
        self.assertIn('og:title" content="Vote for Contestant 2', html)
        self.assertIn('/e/miss-dharan/vote/contest/c/c2', html)

    def test_shared_links_carry_their_own_preview(self):
        # The plain /e/… links people share are answered by apps.seo with the contest's own tags
        poll = self.simple_contest(show_numbers=True)
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


class PublicContestListTests(ContestBase):
    URL = '/api/voting/public-contests/'

    def test_lists_by_status_and_hides_drafts(self):
        live = self.simple_contest(n=2, results_visibility=Poll.ResultsVisibility.LIVE, show_vote_counts=True)
        Poll.objects.create(event=self.event, kind=Poll.Kind.CONTEST, title='Draft', slug='draft')
        Poll.objects.create(event=self.event, kind=Poll.Kind.CONTEST, title='Soon', slug='soon', status=Poll.Status.SCHEDULED,
                            opens_at=timezone.now() + timezone.timedelta(days=2))
        res = self.client.get(self.URL)
        self.assertEqual(res.status_code, 200)
        self.assertEqual([r['id'] for r in res.data['results']], [str(live.id)])
        self.assertEqual(res.data['results'][0]['contestants'], 2)
        self.assertEqual(res.data['results'][0]['total_votes'], 0)
        self.assertEqual(res.data['counts'], {'live': 1, 'upcoming': 1, 'past': 0})
        self.assertEqual([r['title'] for r in self.client.get(self.URL + '?when=upcoming').data['results']], ['Soon'])

    def test_vote_total_hidden_when_results_hidden(self):
        self.simple_contest(results_visibility=Poll.ResultsVisibility.RANKS_ONLY)
        self.assertIsNone(self.client.get(self.URL).data['results'][0]['total_votes'])

    def test_search_finds_contestant(self):
        self.simple_contest()
        self.assertEqual(len(self.client.get(self.URL + '?search=Contestant 2').data['results']), 1)
        self.assertEqual(len(self.client.get(self.URL + '?search=nobody').data['results']), 0)


class ScheduleFromControlsTests(ContestBase):
    def test_schedule_then_auto_open(self):
        poll = self.simple_contest()
        poll.status = Poll.Status.DRAFT
        poll.save()
        self.as_(self.org)
        soon = timezone.now() + timezone.timedelta(hours=1)
        res = self.client.patch(f'{API}{poll.id}/', {'status': 'scheduled', 'opens_at': soon.isoformat(), 'closes_at': None}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        poll.refresh_from_db()
        self.assertEqual(poll.status, Poll.Status.SCHEDULED)


class PublicContestListTotalsTests(ContestBase):
    def test_vote_total_is_not_multiplied_by_contestants(self):
        poll = self.simple_contest(n=4, results_visibility=Poll.ResultsVisibility.LIVE, show_vote_counts=True)
        from .models import hash_voter
        for i in range(3):
            Vote.objects.create(poll=poll, candidate=self.c(poll, 1), voter_identifier=hash_voter(f'v{i}'), quantity=1)
        row = self.client.get('/api/voting/public-contests/').data['results'][0]
        self.assertEqual((row['contestants'], row['total_votes']), (4, 3))


class OrganizerPreviewTests(ContestBase):
    def test_organizer_previews_a_draft_contest_public_cannot(self):
        poll = self.simple_contest()
        Poll.objects.filter(pk=poll.pk).update(status=Poll.Status.DRAFT)
        url = f'/api/voting/public/{self.event.slug}/contests/{poll.slug}/'
        self.assertEqual(self.client.get(url).status_code, 404)
        self.as_(self.org)
        self.assertEqual(self.client.get(url).status_code, 200)
        self.as_(self.other)
        self.assertEqual(self.client.get(url).status_code, 404)


class ContestantSelfEditTests(ContestBase):
    def setUp(self):
        super().setUp()
        self.poll = self.simple_contest(n=2)
        self.c1 = self.c(self.poll, 1)
        self.url = f'/api/voting/self/{self.c1.ensure_edit_token()}/'

    def test_contestant_updates_own_profile_but_not_name(self):
        r = self.client.patch(self.url, {'description': 'New bio', 'subtitle': 'Dharan', 'name': 'Hacked'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.c1.refresh_from_db()
        self.assertEqual((self.c1.description, self.c1.subtitle, self.c1.name), ('New bio', 'Dharan', 'Contestant 1'))
        self.assertEqual(self.client.get('/api/voting/self/not-a-token/').status_code, 404)

    def test_organizer_can_turn_it_off(self):
        Poll.objects.filter(pk=self.poll.pk).update(contestants_can_edit=False)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.client.patch(self.url, {'description': 'x'}, format='json').status_code, 403)

    def test_opening_voting_invites_each_contestant_once(self):
        from unittest import mock
        Poll.objects.filter(pk=self.poll.pk).update(status=Poll.Status.DRAFT, contestant_notify=Poll.Notify.EMAIL)
        Candidate.objects.filter(poll=self.poll).update(contact_email='c@x.com')
        self.as_(self.org)
        with mock.patch('apps.core.email.send_simple_event_email') as send, self.captureOnCommitCallbacks(execute=True):
            self.client.post(f'{API}{self.poll.id}/status/open/')
        self.assertEqual(send.call_count, 2)
        self.assertIn('/contestant/', send.call_args[0][4])  # the private edit link is in the message
        self.assertEqual(Candidate.objects.filter(poll=self.poll, invited_at__isnull=False).count(), 2)
        with mock.patch('apps.core.email.send_simple_event_email') as send, self.captureOnCommitCallbacks(execute=True):
            self.client.post(f'{API}{self.poll.id}/status/close/')
            self.client.post(f'{API}{self.poll.id}/status/open/')
        self.assertEqual(send.call_count, 0)  # not twice


class NotifyMeTests(ContestBase):
    def test_reminder_sent_once_when_voting_opens(self):
        from django.core import mail
        from .models import ContestReminder
        poll = self.simple_contest()
        Poll.objects.filter(pk=poll.pk).update(status=Poll.Status.SCHEDULED, opens_at=timezone.now() + timezone.timedelta(days=1))
        url = f'/api/voting/public/{self.event.slug}/contests/{poll.slug}/remind/'
        self.assertEqual(self.client.post(url, {'destination': 'Fan@X.com'}, format='json').status_code, 201)
        self.assertEqual(self.client.post(url, {'destination': 'fan@x.com'}, format='json').status_code, 201)  # no duplicate
        self.assertEqual(self.client.post(url, {'destination': 'nope'}, format='json').status_code, 400)
        self.assertEqual(ContestReminder.objects.count(), 1)
        self.as_(self.org)
        mail.outbox.clear()
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(f'{API}{poll.id}/status/open/')
        self.assertEqual([m.to for m in mail.outbox if 'Voting is open' in m.subject], [['fan@x.com']])
        self.assertEqual(ContestReminder.objects.count(), 0)  # contact deleted after sending
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.post(url, {'destination': 'late@x.com'}, format='json').status_code, 400)  # already open


class DeleteContestTests(ContestBase):
    def test_open_contest_with_votes_must_be_closed_first(self):
        from .models import hash_voter
        poll = self.simple_contest()
        Vote.objects.create(poll=poll, candidate=self.c(poll, 1), voter_identifier=hash_voter('v'), quantity=1)
        self.as_(self.org)
        self.assertEqual(self.client.delete(f'{API}{poll.id}/').status_code, 409)
        self.client.post(f'{API}{poll.id}/status/close/')
        self.assertEqual(self.client.delete(f'{API}{poll.id}/').status_code, 204)
        self.assertFalse(Poll.objects.filter(pk=poll.pk).exists())
        self.as_(self.other)
        other = self.simple_contest()
        self.assertEqual(self.client.delete(f'{API}{other.id}/').status_code, 404)  # not theirs


class SmsEmailFallbackTests(ContestBase):
    def test_sms_down_voter_uses_email_and_votes(self):
        import re
        from unittest import mock
        from django.core import mail
        from .sms import SMSError
        poll = self.simple_contest()
        Poll.objects.filter(pk=poll.pk).update(vote_mode=Poll.VoteMode.SMS_OTP)
        base = f'/api/voting/public/{self.event.slug}/contests/{poll.slug}/'
        with mock.patch('apps.voting.otp.send_sms', side_effect=SMSError('no balance')):
            r = self.client.post(base + 'otp/send/', {'destination': '9812345678'}, format='json')
        self.assertEqual((r.status_code, r.data.get('code')), (503, 'sms_unavailable'))
        self.assertTrue(self.client.get(base).data['verification']['email_fallback'])
        mail.outbox.clear()
        r = self.client.post(base + 'otp/send/', {'destination': 'fan@x.com'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        code = re.search(r'\b(\d{6})\b', mail.outbox[-1].subject + mail.outbox[-1].body).group(1)
        token = self.client.post(base + 'otp/verify/', {'destination': 'fan@x.com', 'code': code}, format='json').data['voter_token']
        r = self.vote(poll, self.c(poll, 1), voter_token=token)
        self.assertEqual(r.status_code, 201, r.data)

    def test_fallback_off_keeps_sms_only(self):
        poll = self.simple_contest(sms_email_fallback=False)
        Poll.objects.filter(pk=poll.pk).update(vote_mode=Poll.VoteMode.SMS_OTP)
        r = self.client.post(f'/api/voting/public/{self.event.slug}/contests/{poll.slug}/otp/send/', {'destination': 'fan@x.com'}, format='json')
        self.assertEqual(r.status_code, 400)  # not a phone number
