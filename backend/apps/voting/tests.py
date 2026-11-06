from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.events.models import Event, EventTicket
from .models import Candidate, Poll, Vote

User = get_user_model()
POLLS = '/api/voting/polls/'


def make_user(email, role):
    return User.objects.create_user(username=email.split('@')[0], email=email, password='pw-123456', role=role)


class VotingBase(APITestCase):
    def setUp(self):
        cache.clear()  # reset the vote rate limiter between tests
        self.org = make_user('org@x.com', 'organizer')
        self.other = make_user('other@x.com', 'organizer')
        self.admin = make_user('admin@x.com', 'superadmin')
        self.staff = make_user('staff@x.com', 'staff')
        today = timezone.localdate()
        self.event = Event.objects.create(
            organizer=self.org, title='Tech Fest', slug='tech-fest', location='Dharan',
            start_date=today, status=Event.Status.PUBLISHED,
        )
        self.ticket = EventTicket.generate_ticket(self.event, 'Asha', 'asha@x.com')
        self.ticket2 = EventTicket.generate_ticket(self.event, 'Bikash', 'bikash@x.com')

    def as_(self, user):
        self.client.force_authenticate(user=user)

    def payload(self, **kw):
        data = {
            'event': str(self.event.id),
            'title': 'Best project',
            'status': 'open',
            'vote_mode': 'ticket',
            'candidates': [{'name': 'Team A', 'subtitle': 'ERC'}, {'name': 'Team B'}, {'name': 'Team C', 'photo_url': '/media/x.png'}],
        }
        data.update(kw)
        return data

    def make_poll(self, **kw):
        self.as_(self.org)
        res = self.client.post(POLLS, self.payload(**kw), format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.client.force_authenticate(user=None)
        return Poll.objects.get(pk=res.data['id'])

    def vote(self, poll, ids, **kw):
        body = {'candidate_ids': [str(i) for i in ids], **kw}
        return self.client.post(f'/api/voting/public/{self.event.slug}/{poll.id}/vote/', body, format='json')


class PollManagementTests(VotingBase):
    def test_create_with_candidates_and_order(self):
        poll = self.make_poll()
        self.assertEqual(list(poll.candidates.values_list('name', flat=True)), ['Team A', 'Team B', 'Team C'])
        self.assertEqual(poll.max_choices, 1)

    def test_quick_poll_cannot_use_one_time_codes(self):
        # Codes are verified only for contests, so such a poll could never receive a vote
        self.as_(self.org)
        for mode in ('sms_otp', 'email_otp'):
            res = self.client.post(POLLS, self.payload(vote_mode=mode), format='json')
            self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn('vote_mode', res.data)

    def test_only_owner_or_superadmin_can_manage(self):
        poll = self.make_poll()
        for user in (self.other, self.staff):
            self.as_(user)
            self.assertEqual(self.client.get(f'{POLLS}{poll.id}/').status_code in (403, 404), True)
            self.assertIn(self.client.patch(f'{POLLS}{poll.id}/', {'title': 'x'}, format='json').status_code, (403, 404))
        self.as_(self.other)
        res = self.client.post(POLLS, self.payload(), format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.as_(self.staff)
        self.assertEqual(self.client.post(POLLS, self.payload(), format='json').status_code, 403)
        self.as_(self.admin)
        self.assertEqual(self.client.patch(f'{POLLS}{poll.id}/', {'title': 'Admin edit'}, format='json').status_code, 200)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(POLLS).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_list_scoped_to_owner(self):
        self.make_poll()
        self.as_(self.other)
        self.assertEqual(self.client.get(POLLS).data, [])
        self.as_(self.org)
        self.assertEqual(len(self.client.get(f'{POLLS}?event={self.event.id}').data), 1)

    def test_update_candidates_add_edit_remove(self):
        poll = self.make_poll()
        a, b, c = poll.candidates.order_by('order')
        self.as_(self.org)
        res = self.client.patch(f'{POLLS}{poll.id}/', {'candidates': [
            {'id': str(c.id), 'name': 'Team C+'}, {'id': str(a.id), 'name': 'Team A'}, {'name': 'Team D'},
        ]}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual([x['name'] for x in res.data['candidates']], ['Team C+', 'Team A', 'Team D'])
        self.assertFalse(Candidate.objects.filter(pk=b.pk).exists())

    def test_validation(self):
        self.as_(self.org)
        res = self.client.post(POLLS, self.payload(status='scheduled'), format='json')
        self.assertIn('opens_at', res.data)
        now = timezone.now()
        res = self.client.post(POLLS, self.payload(opens_at=now.isoformat(), closes_at=(now - timedelta(hours=1)).isoformat()), format='json')
        self.assertIn('closes_at', res.data)
        res = self.client.post(POLLS, self.payload(allow_multiple=True, max_choices=5), format='json')
        self.assertIn('max_choices', res.data)
        res = self.client.post(POLLS, self.payload(candidates=[{'name': 'Solo'}]), format='json')
        self.assertIn('candidates', res.data)
        other_event = Event.objects.create(organizer=self.other, title='O', slug='o', location='x', start_date=timezone.localdate())
        poll = self.make_poll()
        self.as_(self.org)
        res = self.client.patch(f'{POLLS}{poll.id}/', {'event': str(other_event.id)}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_open_close_reset_duplicate(self):
        poll = self.make_poll(status='draft')
        self.as_(self.org)
        self.assertEqual(self.client.post(f'{POLLS}{poll.id}/open/').data['status'], 'open')
        self.client.force_authenticate(user=None)
        self.assertEqual(self.vote(poll, [poll.candidates.first().id], ticket_code=self.ticket.ticket_number).status_code, 201)
        self.as_(self.org)
        self.assertEqual(self.client.post(f'{POLLS}{poll.id}/close/').data['status'], 'closed')
        self.assertEqual(self.client.post(f'{POLLS}{poll.id}/reset/', {}, format='json').status_code, 400)
        res = self.client.post(f'{POLLS}{poll.id}/reset/', {'confirm': True}, format='json')
        self.assertEqual(res.data['deleted'], 1)
        dup = self.client.post(f'{POLLS}{poll.id}/duplicate/')
        self.assertEqual(dup.status_code, 201)
        self.assertEqual(dup.data['status'], 'draft')
        self.assertEqual(len(dup.data['candidates']), 3)
        self.as_(self.other)
        self.assertEqual(self.client.post(f'{POLLS}{poll.id}/open/').status_code, 404)

    def test_open_requires_two_candidates(self):
        poll = self.make_poll(status='draft', candidates=[{'name': 'Only'}])
        self.as_(self.org)
        self.assertEqual(self.client.post(f'{POLLS}{poll.id}/open/').status_code, 400)

    def test_candidate_crud(self):
        poll = self.make_poll()
        self.as_(self.org)
        res = self.client.post('/api/voting/candidates/', {'poll': str(poll.id), 'name': 'Team Z'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(self.client.patch(f'/api/voting/candidates/{res.data["id"]}/', {'subtitle': 'KEC'}, format='json').status_code, 200)
        self.as_(self.other)
        self.assertEqual(self.client.post('/api/voting/candidates/', {'poll': str(poll.id), 'name': 'X'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/voting/candidates/{res.data["id"]}/').status_code, 404)


class ScheduleTests(VotingBase):
    def test_auto_open_and_close(self):
        now = timezone.now()
        poll = self.make_poll(status='scheduled', opens_at=(now + timedelta(hours=1)).isoformat())
        cid = poll.candidates.first().id
        res = self.vote(poll, [cid], ticket_code=self.ticket.ticket_number)
        self.assertEqual(res.status_code, 409)
        Poll.objects.filter(pk=poll.pk).update(opens_at=now - timedelta(minutes=1), closes_at=now + timedelta(minutes=30))
        self.assertEqual(self.vote(poll, [cid], ticket_code=self.ticket.ticket_number).status_code, 201)
        poll.refresh_from_db()
        self.assertEqual(poll.status, 'open')
        Poll.objects.filter(pk=poll.pk).update(closes_at=now - timedelta(seconds=1))
        self.assertEqual(self.vote(poll, [cid], ticket_code=self.ticket2.ticket_number).status_code, 409)
        poll.refresh_from_db()
        self.assertEqual(poll.status, 'closed')


class BallotTests(VotingBase):
    def test_ticket_mode_one_ballot_per_ticket(self):
        poll = self.make_poll()
        a, b, _ = poll.candidates.order_by('order')
        res = self.vote(poll, [a.id], ticket_code=self.ticket.ticket_number.lower())
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(self.vote(poll, [b.id], ticket_code=self.ticket.qr_token).status_code, 409)
        self.assertEqual(self.vote(poll, [b.id], ticket_code='TKT-NOPE').status_code, 400)
        self.assertEqual(self.vote(poll, [b.id]).status_code, 400)

    def test_ticket_must_belong_to_event(self):
        poll = self.make_poll()
        other = Event.objects.create(organizer=self.org, title='Other', slug='other', location='x', start_date=timezone.localdate())
        t = EventTicket.generate_ticket(other, 'C', 'c@x.com')
        self.assertEqual(self.vote(poll, [poll.candidates.first().id], ticket_code=t.ticket_number).status_code, 400)

    def test_require_checked_in(self):
        poll = self.make_poll(require_checked_in=True)
        cid = poll.candidates.first().id
        self.assertEqual(self.vote(poll, [cid], ticket_code=self.ticket.ticket_number).status_code, 403)
        self.ticket.first_check_in = timezone.now()
        self.ticket.status = EventTicket.Status.CHECKED_IN
        self.ticket.save()
        self.assertEqual(self.vote(poll, [cid], ticket_code=self.ticket.ticket_number).status_code, 201)

    def test_cancelled_ticket_rejected(self):
        poll = self.make_poll()
        self.ticket.status = EventTicket.Status.CANCELLED
        self.ticket.save()
        self.assertEqual(self.vote(poll, [poll.candidates.first().id], ticket_code=self.ticket.ticket_number).status_code, 403)

    def test_contact_mode_normalizes(self):
        poll = self.make_poll(vote_mode='contact')
        a, b, _ = poll.candidates.order_by('order')
        self.assertEqual(self.vote(poll, [a.id], contact='+977 980-0000001').status_code, 201)
        self.assertEqual(self.vote(poll, [b.id], contact='9800000001').status_code, 409)
        self.assertEqual(self.vote(poll, [b.id], contact='Me@X.com').status_code, 201)
        self.assertEqual(self.vote(poll, [b.id], contact='me@x.com ').status_code, 409)
        self.assertEqual(self.vote(poll, [b.id], contact='12').status_code, 400)
        self.assertNotIn('9800000001', ''.join(Vote.objects.values_list('voter_identifier', flat=True)))

    def test_open_mode_one_per_device(self):
        poll = self.make_poll(vote_mode='open')
        cid = poll.candidates.first().id
        self.assertEqual(self.vote(poll, [cid], device_id='dev-1').status_code, 201)
        self.assertEqual(self.vote(poll, [cid], device_id='dev-1').status_code, 409)
        self.assertEqual(self.vote(poll, [cid], device_id='dev-2').status_code, 201)

    def test_multiple_choice_limits(self):
        poll = self.make_poll(allow_multiple=True, max_choices=2)
        a, b, c = poll.candidates.order_by('order')
        self.assertEqual(self.vote(poll, [a.id, b.id, c.id], ticket_code=self.ticket.ticket_number).status_code, 400)
        res = self.vote(poll, [a.id, b.id, a.id], ticket_code=self.ticket.ticket_number)
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(Vote.objects.filter(poll=poll).count(), 2)
        self.assertEqual(self.vote(poll, [c.id], ticket_code=self.ticket.ticket_number).status_code, 409)

    def test_rejects_foreign_candidate_and_closed_or_draft(self):
        poll = self.make_poll()
        other = self.make_poll()
        self.assertEqual(self.vote(poll, [other.candidates.first().id], ticket_code=self.ticket.ticket_number).status_code, 400)
        self.assertEqual(self.vote(poll, ['not-a-uuid'], ticket_code=self.ticket.ticket_number).status_code, 400)
        draft = self.make_poll(status='draft')
        self.assertEqual(self.vote(draft, [draft.candidates.first().id], ticket_code=self.ticket.ticket_number).status_code, 404)

    def test_rate_limited_per_ip(self):
        poll = self.make_poll(vote_mode='open')
        cid = poll.candidates.first().id
        codes = [self.vote(poll, [cid], device_id=f'd{i}').status_code for i in range(21)]
        self.assertEqual(codes[:20], [201] * 20)
        self.assertEqual(codes[20], status.HTTP_429_TOO_MANY_REQUESTS)

    def test_legacy_endpoint(self):
        poll = self.make_poll(vote_mode='contact')
        cid = poll.candidates.first().id
        res = self.client.post(f'/api/voting/polls/{poll.id}/vote/', {'candidate_id': str(cid), 'voter_identifier': 'a@b.com'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['new_vote_count'], 1)


class PublicReadTests(VotingBase):
    def test_public_list_hides_drafts_and_hidden(self):
        self.make_poll(title='Visible')
        self.make_poll(title='Draft', status='draft')
        hidden = self.make_poll(title='Hidden', show_on_public_page=False)
        res = self.client.get(f'/api/voting/public/{self.event.slug}/')
        self.assertEqual([p['title'] for p in res.data['polls']], ['Visible'])
        # Hidden polls still open by direct link
        self.assertEqual(self.client.get(f'/api/voting/public/{self.event.slug}/{hidden.id}/').status_code, 200)

    def test_results_visibility(self):
        poll = self.make_poll(results_visibility='after_close')
        self.vote(poll, [poll.candidates.first().id], ticket_code=self.ticket.ticket_number)
        url = f'/api/voting/public/{self.event.slug}/{poll.id}/'
        data = self.client.get(url).data
        self.assertFalse(data['results_visible'])
        self.assertNotIn('votes', data['candidates'][0])
        self.assertIsNone(data['total_votes'])
        Poll.objects.filter(pk=poll.pk).update(status='closed')
        data = self.client.get(url).data
        self.assertTrue(data['results_visible'])
        self.assertEqual(data['total_votes'], 1)
        Poll.objects.filter(pk=poll.pk).update(results_visibility='hidden_to_public')
        self.assertFalse(self.client.get(url).data['results_visible'])

    def test_unpublished_event_404(self):
        self.event.status = Event.Status.DRAFT
        self.event.save()
        self.assertEqual(self.client.get(f'/api/voting/public/{self.event.slug}/').status_code, 404)


class ResultsTests(VotingBase):
    def test_results_counts_turnout_and_timeline(self):
        poll = self.make_poll()
        a, b, _ = poll.candidates.order_by('order')
        self.vote(poll, [a.id], ticket_code=self.ticket.ticket_number)
        self.vote(poll, [a.id], ticket_code=self.ticket2.ticket_number)
        self.as_(self.org)
        res = self.client.get(f'{POLLS}{poll.id}/results/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['total_votes'], 2)
        self.assertEqual(res.data['turnout']['registered'], 2)
        self.assertEqual(res.data['turnout']['pct_of_registered'], 100.0)
        self.assertEqual(res.data['leader_ids'], [str(a.id)])
        top = next(c for c in res.data['candidates'] if c['id'] == str(a.id))
        self.assertEqual((top['votes'], top['percentage'], top['rank']), (2, 100.0, 1))
        points = res.data['timeline']['points']
        self.assertEqual(len(points), 36)
        self.assertEqual(points[-1]['cumulative'], 2)
        # list endpoint counts match results
        listed = self.client.get(f'{POLLS}{poll.id}/').data
        self.assertEqual(listed['total_votes'], 2)
        self.assertEqual(listed['voters'], 2)
        self.as_(self.other)
        self.assertEqual(self.client.get(f'{POLLS}{poll.id}/results/').status_code, 404)

    def test_csv_exports(self):
        poll = self.make_poll(vote_mode='contact')
        self.vote(poll, [poll.candidates.first().id], contact='secret@x.com')
        self.as_(self.org)
        res = self.client.get(f'{POLLS}{poll.id}/export/')
        body = res.content.decode()
        self.assertEqual(res['Content-Type'], 'text/csv; charset=utf-8')
        self.assertIn('Team A', body)
        votes = self.client.get(f'{POLLS}{poll.id}/export/?kind=votes').content.decode()
        self.assertIn('Voter reference', votes)
        self.assertNotIn('secret', votes)
        self.as_(self.other)
        self.assertEqual(self.client.get(f'{POLLS}{poll.id}/export/').status_code, 404)
