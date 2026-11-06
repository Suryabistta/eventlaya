from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.events.models import Event, EventFunding

User = get_user_model()


class OrganizerOnlyDataTests(APITestCase):
    """Attendee exports, analytics and budgets contain personal or financial data."""

    def setUp(self):
        self.owner = User.objects.create_user(username='own', email='own@x.com', password='password123')
        self.other = User.objects.create_user(username='oth', email='oth@x.com', password='password123')
        self.event = Event.objects.create(organizer=self.owner, title='Locked', slug='locked', location='Dharan', start_date=date.today() + timedelta(days=3), status=Event.Status.PUBLISHED)
        self.urls = [f'/api/events/{self.event.id}/export-attendees/', f'/api/events/{self.event.id}/analytics/', f'/api/events/{self.event.id}/funding/']

    def test_anonymous_and_other_organizers_are_refused(self):
        for url in self.urls:
            self.assertIn(self.client.get(url).status_code, (401, 403), url)
        self.client.force_authenticate(self.other)
        for url in self.urls:
            self.assertEqual(self.client.get(url).status_code, 403, url)
        self.assertEqual(self.client.post(self.urls[2], {'target_budget': 1}, format='json').status_code, 403)

    def test_visitors_get_nothing_from_the_organizer_event_list(self):
        # Counts here ignore "show spots left" and white-label scoping; visitors use /api/events/public/
        self.assertEqual(self.client.get('/api/events/').data, [])
        self.assertEqual(self.client.get(f'/api/events/{self.event.id}/').status_code, 404)
        self.assertEqual(self.client.get('/api/events/public/').status_code, 200)

    def test_owner_gets_real_data_only(self):
        self.client.force_authenticate(self.owner)
        for url in self.urls:
            self.assertEqual(self.client.get(url).status_code, 200, url)
        data = self.client.get(self.urls[1]).data
        self.assertEqual(data['gate_distribution_chart']['labels'], [])
        self.assertEqual(data['registration_growth_chart']['labels'], [])
        self.assertEqual(data['velocity_chart']['labels'], [])
        self.assertEqual(float(EventFunding.objects.get(event=self.event).target_budget), 0.0)
