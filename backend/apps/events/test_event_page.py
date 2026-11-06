from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.events.models import Event, EventAgendaItem, EventFAQ, EventSpeaker

User = get_user_model()


class EventPageTests(APITestCase):
    def setUp(self):
        self.organizer = User.objects.create_user(username='org', email='org@test.com', password='x', role=User.Role.ORGANIZER, organization_name='Dharan Club')
        self.other = User.objects.create_user(username='org2', email='org2@test.com', password='x', role=User.Role.ORGANIZER)
        self.admin = User.objects.create_user(username='admin', email='admin@test.com', password='x', role=User.Role.SUPERADMIN)
        self.staff = User.objects.create_user(username='staff', email='staff@test.com', password='x', role=User.Role.STAFF)
        self.event = Event.objects.create(
            organizer=self.organizer, title='Page Fest', slug='page-fest', location='Dharan Hall',
            start_date=date.today() + timedelta(days=5), capacity=100, status=Event.Status.PUBLISHED,
        )
        self.url = f'/api/events/{self.event.id}/page/'
        self.payload = {
            'tagline': 'Two days of code and music',
            'category': 'hackathon',
            'highlights': ['24-hour hackathon', '  ', 'Free lunch'],
            'contact_email': 'hello@pagefest.com',
            'contact_phone': '+977 9800000000',
            'map_query': 'Purwanchal Campus, Dharan',
            'agenda': [
                {'day': str(self.event.start_date), 'start_time': '09:00', 'end_time': '10:00', 'title': 'Opening', 'location': 'Main hall', 'speaker_names': 'Sita Rai'},
                {'day': str(self.event.start_date), 'start_time': '10:30', 'title': 'Hacking starts'},
            ],
            'speakers': [
                {'name': 'Sita Rai', 'role': 'CTO', 'organization': 'Koshi Labs', 'photo_url': '/media/uploads/avatar/1/a.png', 'bio': 'Builds things.'},
            ],
            'faqs': [{'question': 'Is it free?', 'answer': 'Yes.'}, {'question': 'Is food provided?', 'answer': 'Lunch is.'}],
        }

    def test_owner_replaces_content_atomically(self):
        self.client.force_authenticate(self.organizer)
        res = self.client.put(self.url, self.payload, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['highlights'], ['24-hour hackathon', 'Free lunch'])
        self.assertEqual([a['title'] for a in res.data['agenda']], ['Opening', 'Hacking starts'])
        self.assertEqual(res.data['faqs'][1]['order'], 1)

        # Replacing a list removes the old rows; omitted lists are kept
        res = self.client.put(self.url, {'agenda': [{'start_time': '12:00', 'title': 'Lunch'}]}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(EventAgendaItem.objects.filter(event=self.event).count(), 1)
        self.assertEqual(EventFAQ.objects.filter(event=self.event).count(), 2)
        self.assertEqual(EventSpeaker.objects.filter(event=self.event).count(), 1)

        res = self.client.get(self.url)
        self.assertEqual(res.data['slug'], 'page-fest')
        self.assertEqual(res.data['tagline'], 'Two days of code and music')

    def test_invalid_payload_changes_nothing(self):
        self.client.force_authenticate(self.organizer)
        self.client.put(self.url, self.payload, format='json')
        bad = {**self.payload, 'tagline': 'Changed', 'agenda': [{'start_time': '10:00', 'end_time': '09:00', 'title': 'Backwards'}]}
        res = self.client.put(self.url, bad, format='json')
        self.assertEqual(res.status_code, 400)
        self.event.refresh_from_db()
        self.assertEqual(self.event.tagline, 'Two days of code and music')
        self.assertEqual(EventAgendaItem.objects.filter(event=self.event).count(), 2)

    def test_validation_messages(self):
        self.client.force_authenticate(self.organizer)
        for payload, field in (
            ({'category': 'rave'}, 'category'),
            ({'highlights': 'not a list'}, 'highlights'),
            ({'highlights': ['x' * 121]}, 'highlights'),
            ({'speakers': [{'name': 'A', 'photo_url': 'javascript:alert(1)'}]}, 'speakers'),
            ({'faqs': [{'question': '', 'answer': 'x'}]}, 'faqs'),
            ({'contact_email': 'nope'}, 'contact_email'),
        ):
            res = self.client.put(self.url, payload, format='json')
            self.assertEqual(res.status_code, 400, payload)
            self.assertIn(field, res.data)

    def test_permissions(self):
        for user, code in ((self.other, 403), (self.staff, 403), (None, 401)):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get(self.url).status_code, code)
            self.assertEqual(self.client.put(self.url, {'tagline': 'x'}, format='json').status_code, code)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.put(self.url, {'tagline': 'By admin'}, format='json').status_code, 200)

    def test_public_detail_includes_page_content(self):
        self.client.force_authenticate(self.organizer)
        self.client.put(self.url, self.payload, format='json')
        self.client.force_authenticate(None)
        res = self.client.get('/api/events/public/page-fest/')
        self.assertEqual(res.status_code, 200)
        ev = res.data['event']
        self.assertEqual(ev['tagline'], 'Two days of code and music')
        self.assertEqual(ev['category'], 'hackathon')
        self.assertEqual(len(ev['agenda']), 2)
        self.assertEqual(ev['speakers'][0]['name'], 'Sita Rai')
        self.assertEqual(len(ev['faqs']), 2)
        self.assertEqual(ev['spots_left'], 100)
        self.assertEqual(ev['organizer_info']['name'], 'Dharan Club')
        self.assertIsNone(ev['banner_absolute'])
        self.assertEqual(ev['map_query'], 'Purwanchal Campus, Dharan')

    def test_unpublished_event_page_is_hidden(self):
        self.event.status = Event.Status.DRAFT
        self.event.save()
        self.assertEqual(self.client.get('/api/events/public/page-fest/').status_code, 404)


class EventSlugStabilityTests(APITestCase):
    def test_editing_an_event_keeps_its_slug(self):
        org = User.objects.create_user(username='o', email='o@test.com', password='x', role=User.Role.ORGANIZER)
        ev = Event.objects.create(organizer=org, title='Old Name', slug='old-name', location='x', start_date=date.today())
        self.client.force_authenticate(org)
        res = self.client.patch(f'/api/events/{ev.id}/', {'title': 'Brand New Name', 'location': 'Dharan'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['slug'], 'old-name')
