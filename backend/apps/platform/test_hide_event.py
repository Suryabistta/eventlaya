from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts import modules
from apps.events.models import Event

User = get_user_model()


class HideEventTests(APITestCase):
    def setUp(self):
        cache.clear()
        modules.clear_cache()
        self.admin = User.objects.create_user(username='sa', email='sa@x.com', password='pw-123456', role='superadmin')
        self.org = User.objects.create_user(username='org', email='org@x.com', password='pw-123456', role='organizer')
        self.event = Event.objects.create(organizer=self.org, title='Fest', slug='fest', location='Dharan',
                                          start_date=timezone.localdate() + timezone.timedelta(days=5), status=Event.Status.PUBLISHED,
                                          is_featured=True)

    def hide(self, hidden, reason=''):
        self.client.force_authenticate(self.admin)
        r = self.client.post(f'/api/platform/events/{self.event.id}/hide/', {'hidden': hidden, 'reason': reason}, format='json')
        self.client.force_authenticate(None)
        return r

    def test_hidden_everywhere_public_but_organizer_sees_why(self):
        self.assertEqual(self.hide(True).status_code, 400)  # a reason is required
        self.assertEqual(self.hide(True, 'Misleading tickets').status_code, 200)
        self.assertEqual([e['slug'] for e in self.client.get('/api/events/public/').data], [])
        self.assertEqual(self.client.get('/api/events/public/fest/').status_code, 404)
        r = self.client.post('/api/forms/events/fest/register/', {'name': 'A', 'email': 'a@x.com', 'phone': '9800000000'}, format='json')
        self.assertIn(r.status_code, (400, 404))
        self.client.force_authenticate(self.org)
        mine = self.client.get(f'/api/events/{self.event.id}/').data
        self.assertEqual((mine['hidden_by_admin'], mine['hidden_reason'], mine['is_featured']), (True, 'Misleading tickets', False))
        self.client.force_authenticate(None)
        self.hide(False)
        self.assertEqual([e['slug'] for e in self.client.get('/api/events/public/').data], ['fest'])

    def test_only_superadmin(self):
        self.client.force_authenticate(self.org)
        self.assertEqual(self.client.post(f'/api/platform/events/{self.event.id}/hide/', {'hidden': True, 'reason': 'x'}, format='json').status_code, 403)
