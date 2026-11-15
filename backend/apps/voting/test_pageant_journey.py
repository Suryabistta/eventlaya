"""End to end: a first-time organizer runs a pageant, through the same API calls the website makes.

Create the event (applications on, no tickets) → visitors see "Apply" → people apply → organizer accepts (they become
contestants in one email) → voting opens (contestants get their links) → the public votes → voting closes →
winners are announced and shown publicly. Each step also checks that the organizer's view and the public view agree.
"""
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts import modules
from .models import Candidate, Poll

User = get_user_model()


class PageantJourneyTests(APITestCase):
    def setUp(self):
        cache.clear()
        modules.clear_cache()
        self.org = User.objects.create_user(username='newbie', email='newbie@x.com', password='pw-123456', role='organizer',
                                            organization_name='Newbie Club', email_verified=True)

    def as_org(self):
        self.client.force_authenticate(self.org)

    def as_public(self):
        self.client.force_authenticate(None)

    def test_full_pageant(self):
        # 1. Create the pageant like the website does: event, an (empty) application form, a Simple vote contest
        self.as_org()
        close = (timezone.now() + timedelta(days=20)).isoformat()
        r = self.client.post('/api/events/', {
            'title': 'Miss Newbie 2026', 'status': 'published', 'date_tba': True, 'tickets_enabled': False,
            'applications_enabled': True, 'applications_close': close, 'application_cta': 'Apply now',
        }, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        event_id, slug = r.data['id'], r.data['slug']
        # No form yet: the organizer sees the same reason the public would
        self.assertEqual(self.client.get(f'/api/events/{event_id}/').data['applications_closed_reason'], 'Applications are not open yet.')
        form = self.client.post('/api/forms/', {'title': 'Apply to Miss Newbie 2026', 'slug': 'apply-miss-newbie', 'event': event_id,
                                                'status': 'published'}, format='json')
        self.assertEqual(form.status_code, 201, form.data)
        self.client.patch(f'/api/events/{event_id}/', {'application_form': form.data['id']}, format='json')
        self.assertIsNone(self.client.get(f'/api/events/{event_id}/').data['applications_closed_reason'])
        contest = self.client.post('/api/voting/contests/', {'event': event_id, 'title': 'Miss Newbie 2026', 'preset': 'simple'}, format='json')
        self.assertEqual(contest.status_code, 201, contest.data)
        cid = contest.data['id']
        # Easy voting for the test (no SMS): one vote per device
        self.client.patch(f'/api/voting/contests/{cid}/', {'vote_mode': 'open', 'ip_votes_per_minute': 0, 'device_votes_per_minute': 0,
                                                            'captcha_enabled': False, 'contestant_notify': 'email'}, format='json')
        # Opening voting with nobody in it is refused
        self.assertEqual(self.client.post(f'/api/voting/contests/{cid}/status/open/').status_code, 400)

        # 2. The public page offers "Apply", and people apply
        self.as_public()
        page = self.client.get(f'/api/events/public/{slug}/').data['event']
        self.assertTrue(page['applications']['open'])
        for i, name in enumerate(['Asha Rai', 'Bina Limbu', 'Chandra Gurung']):
            r = self.client.post(f'/api/forms/events/{slug}/apply/', {'name': name, 'email': f'c{i}@x.com', 'phone': f'98000000{i}0',
                                                                      'answers': {}}, format='json')
            self.assertEqual(r.status_code, 201, r.data)

        # 3. The organizer accepts two: each becomes a contestant, with ONE email
        self.as_org()
        apps = self.client.get(f'/api/forms/events/{event_id}/applications/').data
        mail.outbox.clear()
        for a in apps[:2]:
            with self.captureOnCommitCallbacks(execute=True):
                r = self.client.post(f"/api/forms/responses/{a['id']}/review/", {'status': 'accepted'}, format='json')
            self.assertEqual(r.data['added_to_contest'], 'Miss Newbie 2026')
        self.assertEqual(Candidate.objects.filter(poll_id=cid).count(), 2)
        for a in apps[:2]:
            self.assertEqual(len([m for m in mail.outbox if a['submitter_email'] in m.to]), 1)

        # 4. Voting opens: each contestant gets their own page + private edit link (once)
        with mock.patch('apps.core.email.send_simple_event_email') as sent, self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.post(f'/api/voting/contests/{cid}/status/open/').status_code, 200)
        self.assertEqual(sent.call_count, 2)
        self.assertTrue(all('/contestant/' in call[0][4] for call in sent.call_args_list))

        # 5. The public finds it on /voting and votes
        self.as_public()
        listing = self.client.get('/api/voting/public-contests/').data['results']
        self.assertEqual([c['id'] for c in listing], [cid])
        public = self.client.get(f'/api/voting/public/{slug}/contests/{contest.data["slug"]}/').data
        self.assertTrue(public['voting_open'])
        first = public['contestants'][0]['id']
        for device in ('d1', 'd2', 'd3'):
            r = self.client.post(f'/api/voting/public/{slug}/contests/{contest.data["slug"]}/vote/', {'contestant': first, 'device_id': device}, format='json')
            self.assertEqual(r.status_code, 201, r.data)
            self.assertNotIn('#', r.data['message'])  # contestant numbers stay hidden unless the organizer shows them

        # 6. Close and announce winners: the public sees them
        self.as_org()
        self.client.post(f'/api/voting/contests/{cid}/status/close/')
        with self.captureOnCommitCallbacks(execute=True):
            r = self.client.post(f'/api/voting/contests/{cid}/announce/', {'announcement': 'Congratulations!'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.as_public()
        public = self.client.get(f'/api/voting/public/{slug}/contests/{contest.data["slug"]}/').data
        self.assertEqual((public['status'], public['announcement']), (Poll.Status.CLOSED, 'Congratulations!'))
        self.assertEqual(public['standings']['rows'][0]['contestant_id'], first)
