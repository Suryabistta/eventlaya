from django.core.cache import cache
from django.utils import timezone

from apps.events.models import EventTicket
from .models import Vote
from .tests import VotingBase, make_user


class AccountVotingTests(VotingBase):
    def setUp(self):
        super().setUp()
        self.attendee = make_user('asha2@x.com', 'attendee')
        self.ticket.user = self.attendee
        self.ticket.save()

    def login(self, user):
        token = self.client.post('/api/auth/login/', {'email': user.email, 'password': 'pw-123456'}, format='json').data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    def test_vote_with_account_and_see_has_voted(self):
        poll = self.make_poll()
        cand = poll.candidates.first()
        self.login(self.attendee)
        polls = self.client.get(f'/api/voting/public/{self.event.slug}/').data['polls']
        self.assertEqual(polls[0]['viewer'], {'has_voted': False, 'candidate_ids': [], 'can_vote_with_account': True})
        res = self.vote(poll, [cand.id])
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['poll']['viewer']['has_voted'], True)
        self.assertEqual(Vote.objects.get().ticket, self.ticket)
        detail = self.client.get(f'/api/voting/public/{self.event.slug}/{poll.id}/').data
        self.assertEqual(detail['viewer']['candidate_ids'], [str(cand.id)])
        # Same person can't vote again, with the account or by pasting the ticket code
        self.assertEqual(self.vote(poll, [cand.id]).status_code, 409)
        self.client.credentials()
        self.assertEqual(self.vote(poll, [cand.id], ticket_code=self.ticket.ticket_number).status_code, 409)

    def test_account_without_ticket_is_refused(self):
        poll = self.make_poll()
        self.login(make_user('nobody@x.com', 'attendee'))
        res = self.vote(poll, [poll.candidates.first().id])
        self.assertEqual(res.status_code, 403)
        self.assertEqual(self.client.get(f'/api/voting/public/{self.event.slug}/').data['polls'][0]['viewer']['can_vote_with_account'], False)

    def test_check_in_rule_still_applies(self):
        poll = self.make_poll(require_checked_in=True)
        self.login(self.attendee)
        self.assertEqual(self.vote(poll, [poll.candidates.first().id]).status_code, 403)
        EventTicket.objects.filter(pk=self.ticket.pk).update(first_check_in=timezone.now(), status='checked_in')
        cache.clear()
        self.assertEqual(self.vote(poll, [poll.candidates.first().id]).status_code, 201)

    def test_contact_poll_uses_verified_email(self):
        poll = self.make_poll(vote_mode='contact')
        self.attendee.email_verified = True
        self.attendee.save()
        self.login(self.attendee)
        self.assertEqual(self.vote(poll, [poll.candidates.first().id]).status_code, 201)
        self.client.credentials()
        self.assertEqual(self.vote(poll, [poll.candidates.first().id], contact='ASHA2@x.com').status_code, 409)

    def test_anonymous_viewer_is_null_and_token_flow_unchanged(self):
        poll = self.make_poll()
        self.assertIsNone(self.client.get(f'/api/voting/public/{self.event.slug}/').data['polls'][0]['viewer'])
        self.assertEqual(self.vote(poll, [poll.candidates.first().id], ticket_code=self.ticket2.qr_token).status_code, 201)
        self.assertEqual(self.vote(poll, [poll.candidates.first().id]).status_code, 400)
