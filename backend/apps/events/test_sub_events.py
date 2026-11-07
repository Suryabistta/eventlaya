from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.accounts.models import PlatformModule
from apps.accounts.modules import clear_cache
from .models import Event, EventTicket

User = get_user_model()


class SubEventTests(APITestCase):
    def setUp(self):
        self.org = User.objects.create_user(username='o', email='o@x.com', password='pw-123456', role='organizer')
        self.other = User.objects.create_user(username='p', email='p@x.com', password='pw-123456', role='organizer')
        self.main = Event.objects.create(organizer=self.org, title='Film Festival', slug='dff', location='Dharan',
                                         start_date='2030-01-01', status='published')
        self.addCleanup(clear_cache)

    def create_sub(self, parent, user=None, **extra):
        self.client.force_authenticate(user or self.org)
        body = {'title': 'Workshop', 'slug': f"ws-{extra.pop('n', 1)}", 'location': 'Hall B', 'start_date': '2030-01-02',
                'status': 'published', 'parent': str(parent.id), **extra}
        return self.client.post('/api/events/', body, format='json')

    def test_create_sub_event_and_public_pages(self):
        r = self.create_sub(self.main)
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['parent_title'], 'Film Festival')
        self.client.force_authenticate(None)
        main = self.client.get('/api/events/public/dff/').data['event']
        self.assertEqual([s['title'] for s in main['sub_events']], ['Workshop'])
        sub = self.client.get('/api/events/public/ws-1/').data['event']
        self.assertEqual(sub['parent'], {'id': str(self.main.id), 'title': 'Film Festival', 'slug': 'dff'})
        # Browse page lists only main events
        self.assertEqual([e['slug'] for e in self.client.get('/api/events/public/').data], ['dff'])

    def test_one_level_and_own_events_only(self):
        sub_id = self.create_sub(self.main).data['id']
        sub = Event.objects.get(pk=sub_id)
        self.assertEqual(self.create_sub(sub, n=2).status_code, 400)
        self.assertEqual(self.create_sub(self.main, user=self.other, n=3).status_code, 400)
        self.client.force_authenticate(self.org)
        r = self.client.patch(f'/api/events/{self.main.id}/', {'parent': sub_id}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_registration_switch_per_sub_event(self):
        sub = Event.objects.get(pk=self.create_sub(self.main, allow_registration=False).data['id'])
        self.client.force_authenticate(None)
        card = self.client.get('/api/events/public/dff/').data['event']['sub_events'][0]
        self.assertFalse(card['registration_open'])
        self.assertFalse(card['allow_registration'])
        self.assertFalse(sub.allow_registration)

    def test_pass_shows_main_and_sub_title(self):
        sub = Event.objects.get(pk=self.create_sub(self.main).data['id'])
        t = EventTicket.generate_ticket(sub, 'A', 'a@x.com')
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f'/api/events/passes/{t.qr_token}/').data['event']['title'], 'Film Festival › Workshop')

    def test_cannot_delete_main_event_with_sub_event_registrations(self):
        sub = Event.objects.get(pk=self.create_sub(self.main).data['id'])
        EventTicket.generate_ticket(sub, 'A', 'a@x.com')
        self.client.force_authenticate(self.org)
        self.assertEqual(self.client.delete(f'/api/events/{self.main.id}/').status_code, 400)

    def test_module_off(self):
        PlatformModule.objects.filter(slug='sub_events').update(is_globally_enabled=False)
        clear_cache()
        self.assertEqual(self.create_sub(self.main).status_code, 400)
