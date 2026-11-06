from datetime import date, datetime, time, timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.events.models import Event, EventTicket, TicketType

User = get_user_model()


def local(d, t=time(12, 0)):
    return timezone.make_aware(datetime.combine(d, t))


class PhaseTests(APITestCase):
    def setUp(self):
        self.organizer = User.objects.create_user(username='org', email='org@test.com', password='x', role=User.Role.ORGANIZER)
        self.day = date.today() + timedelta(days=10)
        self.event = Event.objects.create(
            organizer=self.organizer, title='Fest', slug='fest', location='Dharan',
            start_date=self.day, start_time=time(10, 0), end_time=time(18, 0), status=Event.Status.PUBLISHED,
        )
        TicketType.objects.create(event=self.event, name='General', price=0)

    def test_phase_follows_the_clock(self):
        self.assertEqual(self.event.phase(local(self.day - timedelta(days=1))), 'upcoming')
        self.assertEqual(self.event.phase(local(self.day, time(9, 59))), 'upcoming')
        self.assertEqual(self.event.phase(local(self.day, time(10, 0))), 'live')
        self.assertEqual(self.event.phase(local(self.day, time(18, 0))), 'ended')

    def test_whole_day_event_without_times_ends_at_midnight(self):
        self.event.start_time = self.event.end_time = None
        self.assertEqual(self.event.phase(local(self.day, time(23, 59))), 'live')
        self.assertEqual(self.event.phase(local(self.day + timedelta(days=1), time(0, 0))), 'ended')

    def test_status_overrides(self):
        before = local(self.day - timedelta(days=1))
        for st, expected in ((Event.Status.DRAFT, 'draft'), (Event.Status.CANCELLED, 'cancelled'),
                             (Event.Status.COMPLETED, 'ended'), (Event.Status.ONGOING, 'live')):
            self.event.status = st
            self.assertEqual(self.event.phase(before), expected)

    def register(self, email='a@test.com'):
        return self.client.post(f'/api/forms/events/{self.event.slug}/register/', {'name': 'A', 'email': email}, format='json')

    def test_registration_follows_phase(self):
        self.assertEqual(self.register('a@test.com').status_code, 201)
        with mock.patch('django.utils.timezone.now', return_value=local(self.day, time(12, 0))):
            self.assertEqual(self.register('walkin@test.com').status_code, 201)  # walk-ins while live
        with mock.patch('django.utils.timezone.now', return_value=local(self.day, time(19, 0))):
            res = self.register('late@test.com')
            self.assertEqual(res.status_code, 400)
            self.assertIn('ended', res.data['error'])
        self.event.status = Event.Status.CANCELLED
        self.event.save()
        self.assertIn('cancelled', self.register('c@test.com').data['error'])

    def test_api_exposes_phase(self):
        res = self.client.get(f'/api/events/public/{self.event.slug}/')
        self.assertEqual(res.data['event']['phase'], 'upcoming')
        self.assertTrue(res.data['event']['registration_open'])

    def test_public_page_for_completed_and_cancelled(self):
        for st, phase in ((Event.Status.COMPLETED, 'ended'), (Event.Status.CANCELLED, 'cancelled')):
            self.event.status = st
            self.event.save()
            res = self.client.get(f'/api/events/public/{self.event.slug}/')
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.data['event']['phase'], phase)
            self.assertFalse(res.data['event']['registration_open'])
        self.event.status = Event.Status.DRAFT
        self.event.save()
        self.assertEqual(self.client.get(f'/api/events/public/{self.event.slug}/').status_code, 404)

    def test_public_list_upcoming_and_past(self):
        past = Event.objects.create(organizer=self.organizer, title='Old', slug='old', location='X',
                                    start_date=date.today() - timedelta(days=5), status=Event.Status.PUBLISHED)
        def slugs(when):
            data = self.client.get(f'/api/events/public/?when={when}').data
            return [e['slug'] for e in (data['results'] if isinstance(data, dict) else data)]
        self.assertIn('fest', slugs('upcoming'))
        self.assertNotIn('old', slugs('upcoming'))
        self.assertIn(past.slug, slugs('past'))

    def test_cannot_create_event_in_the_past(self):
        self.client.force_authenticate(self.organizer)
        res = self.client.post('/api/events/', {'title': 'Late', 'location': 'X', 'start_date': str(date.today() - timedelta(days=1))}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('start_date', res.data)

    def test_cannot_delete_event_with_registrations(self):
        self.client.force_authenticate(self.organizer)
        EventTicket.generate_ticket(self.event, 'A', 'a@test.com')
        self.assertEqual(self.client.delete(f'/api/events/{self.event.id}/').status_code, 400)
        self.assertTrue(Event.objects.filter(pk=self.event.pk).exists())
        empty = Event.objects.create(organizer=self.organizer, title='Empty', slug='empty', location='X', start_date=self.day)
        self.assertEqual(self.client.delete(f'/api/events/{empty.id}/').status_code, 204)
