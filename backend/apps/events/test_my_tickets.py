from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import PlatformModule
from apps.accounts.modules import clear_cache
from apps.events.models import Event, EventTicket

User = get_user_model()


def make_user(email, role='attendee', **kw):
    return User.objects.create_user(username=email, email=email, password='pw-12345678', role=role, **kw)


def make_event(org, slug, days, **kw):
    return Event.objects.create(organizer=org, title=slug.title(), slug=slug, location='Dharan',
                                start_date=timezone.localdate() + timedelta(days=days),
                                status=kw.pop('status', Event.Status.PUBLISHED), **kw)


class RegistrationLinkingTests(APITestCase):
    def setUp(self):
        clear_cache()
        self.org = make_user('org@x.com', 'organizer')
        self.event = make_event(self.org, 'fest', 3)
        self.user = make_user('asha@x.com', first_name='Asha', last_name='Rai', phone='9800', email_verified=True)

    def register(self, **body):
        return self.client.post('/api/forms/events/fest/register/', body, format='json')

    def login(self, user):
        token = self.client.post('/api/auth/login/', {'email': user.email, 'password': 'pw-12345678'}, format='json').data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    def test_signed_in_registration_links_and_defaults_from_account(self):
        self.login(self.user)
        res = self.register()
        self.assertEqual(res.status_code, 201, res.content)
        ticket = EventTicket.objects.get()
        self.assertEqual((ticket.user, ticket.attendee_name, ticket.attendee_email, ticket.attendee_phone),
                         (self.user, 'Asha Rai', 'asha@x.com', '9800'))

    def test_registering_someone_else_is_not_linked(self):
        self.login(self.user)
        self.register(name='Friend', email='friend@x.com')
        self.assertIsNone(EventTicket.objects.get().user)

    def test_unverified_account_ticket_links_on_verification(self):
        self.user.email_verified = False
        self.user.save()
        self.login(self.user)
        self.register()
        self.assertIsNone(EventTicket.objects.get().user)

    def test_existing_guest_ticket_is_claimed_by_verified_account(self):
        EventTicket.generate_ticket(self.event, 'Asha', 'asha@x.com')
        self.login(self.user)
        res = self.register()
        self.assertTrue(res.data['already_registered'])
        self.assertEqual(EventTicket.objects.get().user, self.user)

    def test_stale_token_does_not_block_guest_registration(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer not-a-real-token')
        res = self.register(name='Guest', email='g@x.com')
        self.assertEqual(res.status_code, 201)
        self.assertIsNone(EventTicket.objects.get().user)


class MyTicketsTests(APITestCase):
    def setUp(self):
        clear_cache()
        self.addCleanup(clear_cache)  # module switches are cached outside the test transaction
        self.org = make_user('org@x.com', 'organizer', organization_name='Org Co')
        self.user = make_user('asha@x.com')
        self.other = make_user('b@x.com')
        self.soon = make_event(self.org, 'soon', 2)
        self.later = make_event(self.org, 'later', 10)
        self.old = make_event(self.org, 'old', -5)
        self.t_soon = EventTicket.generate_ticket(self.soon, 'Asha', 'asha@x.com', user=self.user)
        self.t_later = EventTicket.generate_ticket(self.later, 'Asha', 'asha@x.com', user=self.user)
        self.t_old = EventTicket.generate_ticket(self.old, 'Asha', 'asha@x.com', user=self.user,
                                                 is_attended=True, first_check_in=timezone.now())
        EventTicket.generate_ticket(self.soon, 'B', 'b@x.com', user=self.other)
        EventTicket.generate_ticket(self.later, 'Guest', 'guest@x.com')
        self.client.force_authenticate(self.user)

    def ids(self, when):
        res = self.client.get('/api/me/tickets/', {'when': when})
        self.assertEqual(res.status_code, 200)
        return [t['id'] for t in res.data['results']]

    def test_lists_only_own_tickets_split_by_time(self):
        self.assertEqual(self.ids('upcoming'), [str(self.t_soon.id), str(self.t_later.id)])
        self.assertEqual(self.ids('past'), [str(self.t_old.id)])
        self.assertEqual(len(self.ids('all')), 3)
        self.assertEqual(self.client.get('/api/me/tickets/', {'when': 'soon'}).status_code, 400)

    def test_ticket_shape(self):
        data = self.client.get(f'/api/me/tickets/{self.t_old.id}/').data
        self.assertEqual(data['qr_token'], self.t_old.qr_token)
        self.assertEqual(data['event']['slug'], 'old')
        self.assertEqual(data['event']['phase'], 'ended')
        self.assertEqual(data['event']['organizer_name'], 'Org Co')
        self.assertTrue(data['can_review'])
        self.assertIsNone(data['my_review_id'])
        for key in ('ticket_type', 'price', 'status', 'first_check_in', 'last_activity', 'is_attended'):
            self.assertIn(key, data)
        upcoming = self.client.get(f'/api/me/tickets/{self.t_soon.id}/').data
        self.assertFalse(upcoming['can_review'])  # not checked in

    def test_cannot_read_other_peoples_tickets(self):
        theirs = EventTicket.objects.get(user=self.other)
        self.assertEqual(self.client.get(f'/api/me/tickets/{theirs.id}/').status_code, 404)

    def test_requires_auth_and_events_module(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/me/tickets/').status_code, 401)
        clear_cache()
        PlatformModule.objects.filter(slug='events').update(is_globally_enabled=False)
        clear_cache()
        token = self.client.post('/api/auth/login/', {'email': 'asha@x.com', 'password': 'pw-12345678'}, format='json').data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        res = self.client.get('/api/me/tickets/')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'module_disabled')
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 200)  # account endpoints stay on
