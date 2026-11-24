from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import Event

User = get_user_model()
LINK = 'https://tickets.example.com/show'


class ExternalRegisterLinkTests(APITestCase):
    """Superadmin-only: the Register button opens an external link and our registration is off."""

    def setUp(self):
        self.organizer = User.objects.create_user(username='org', email='org@test.com', password='x', role=User.Role.ORGANIZER)
        self.admin = User.objects.create_user(username='ad', email='ad@test.com', password='x', role='superadmin')
        self.event = Event.objects.create(
            organizer=self.organizer, title='Show', slug='show', location='Dharan', capacity=50,
            start_date=date.today() + timedelta(days=10), status=Event.Status.PUBLISHED,
        )
        self.url = f'/api/events/{self.event.id}/'

    def patch(self, user, data):
        self.client.force_authenticate(user)
        return self.client.patch(self.url, data, format='json')

    def test_organizer_cannot_set_it(self):
        r = self.patch(self.organizer, {'external_register_enabled': True, 'external_register_url': LINK})
        self.assertEqual(r.status_code, 200, r.data)
        self.event.refresh_from_db()
        self.assertFalse(self.event.external_register_enabled)
        self.assertEqual(self.event.external_register_url, '')

    def test_hidden_from_organizer_and_public_when_off(self):
        self.client.force_authenticate(self.organizer)
        self.assertNotIn('external_register_url', self.client.get(self.url).data)
        self.assertNotIn('external_register_enabled', self.client.get(self.url).data)
        self.client.force_authenticate(None)
        self.assertNotIn('external_register_url', self.client.get('/api/events/public/show/').data['event'])

    def test_organizer_cannot_turn_it_off(self):
        Event.objects.filter(pk=self.event.pk).update(external_register_enabled=True, external_register_url=LINK)
        self.patch(self.organizer, {'external_register_enabled': False, 'external_register_url': ''})
        self.event.refresh_from_db()
        self.assertTrue(self.event.external_register_enabled)
        self.assertEqual(self.event.external_register_url, LINK)

    def own(self):
        Event.objects.filter(pk=self.event.pk).update(organizer=self.admin)

    def test_superadmin_sets_it_and_registration_closes(self):
        self.own()
        r = self.patch(self.admin, {'external_register_enabled': True, 'external_register_url': LINK})
        self.assertEqual(r.status_code, 200, r.data)
        self.client.force_authenticate(None)
        page = self.client.get('/api/events/public/show/')
        self.assertEqual((page.data['event']['external_register_enabled'], page.data['event']['external_register_url']), (True, LINK))
        self.event.refresh_from_db()
        self.assertIsNotNone(self.event.registration_closed_reason())
        reg = self.client.post('/api/forms/events/show/register/', {'name': 'Sita', 'email': 's@x.com', 'phone': '9800000000'}, format='json')
        self.assertGreaterEqual(reg.status_code, 400)

    def test_link_required_and_https_only(self):
        self.own()
        self.assertEqual(self.patch(self.admin, {'external_register_enabled': True, 'external_register_url': ''}).status_code, 400)
        self.assertEqual(self.patch(self.admin, {'external_register_enabled': True, 'external_register_url': 'javascript:alert(1)'}).status_code, 400)
        self.assertEqual(self.patch(self.admin, {'external_register_enabled': True, 'external_register_url': 'http://x.com'}).status_code, 400)

    def register(self):
        self.client.force_authenticate(None)
        return self.client.post('/api/forms/events/show/register/', {'name': 'Sita', 'email': 's@x.com', 'phone': '9800000000'}, format='json')

    def public(self):
        self.client.force_authenticate(None)
        return self.client.get('/api/events/public/show/').data['event']

    def test_superadmin_sees_it_on_own_event(self):
        self.own()
        self.patch(self.admin, {'external_register_enabled': True, 'external_register_url': LINK})
        r = self.client.get(self.url)
        self.assertEqual((r.data['external_register_enabled'], r.data['external_register_url']), (True, LINK))

    def test_switching_off_reopens_registration_and_hides_link(self):
        self.own()
        self.patch(self.admin, {'external_register_enabled': True, 'external_register_url': LINK})
        self.assertEqual(self.register().status_code, 400)
        r = self.patch(self.admin, {'external_register_enabled': False})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertNotIn('external_register_url', self.public())
        self.assertTrue(self.public()['registration_open'])
        self.assertEqual(self.register().status_code, 201)

    def test_saved_link_while_off_is_not_public(self):
        Event.objects.filter(pk=self.event.pk).update(external_register_enabled=False, external_register_url=LINK)
        self.assertNotIn('external_register_url', self.public())
        self.assertEqual(self.register().status_code, 201)

    def test_public_page_says_open_and_closed_reason(self):
        Event.objects.filter(pk=self.event.pk).update(external_register_enabled=True, external_register_url=LINK)
        p = self.public()
        self.assertEqual((p['external_register_enabled'], p['external_register_url']), (True, LINK))
        self.assertIn('another site', self.register().data['error'])

    def test_cancelled_event_keeps_cancelled_reason(self):
        Event.objects.filter(pk=self.event.pk).update(external_register_enabled=True, external_register_url=LINK, status=Event.Status.CANCELLED)
        self.event.refresh_from_db()
        self.assertIn('cancelled', self.event.registration_closed_reason())

    def test_organizer_create_cannot_set_it(self):
        self.client.force_authenticate(self.organizer)
        r = self.client.post('/api/events/', {
            'title': 'New', 'location': 'Dharan', 'start_date': str(date.today() + timedelta(days=5)), 'capacity': 10,
            'external_register_enabled': True, 'external_register_url': LINK,
        }, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertNotIn('external_register_url', r.data)
        e = Event.objects.get(title='New')
        self.assertEqual((e.external_register_enabled, e.external_register_url), (False, ''))

    def test_superadmin_can_change_link(self):
        self.own()
        self.patch(self.admin, {'external_register_enabled': True, 'external_register_url': LINK})
        self.patch(self.admin, {'external_register_url': 'https://other.example.com/x'})
        self.event.refresh_from_db()
        self.assertEqual(self.event.external_register_url, 'https://other.example.com/x')
        self.assertEqual(self.patch(self.admin, {'external_register_url': ''}).status_code, 400)
