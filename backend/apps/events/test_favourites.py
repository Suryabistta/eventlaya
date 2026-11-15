from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts import modules
from apps.accounts.models import PlatformModule
from .models import Event

User = get_user_model()
URL = '/api/me/favourites/'


class FavouritesTests(APITestCase):
    def setUp(self):
        cache.clear()
        modules.clear_cache()
        org = User.objects.create_user(username='org', email='org@x.com', password='pw-123456', role='organizer')
        self.event = Event.objects.create(organizer=org, title='Fest', slug='fest', location='Dharan',
                                          start_date=timezone.localdate(), status=Event.Status.PUBLISHED)
        self.user = User.objects.create_user(username='a', email='a@x.com', password='pw-123456', role='attendee')

    def test_save_list_remove(self):
        self.assertEqual(self.client.get(URL).status_code, 401)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.post(URL, {'event': 'fest'}, format='json').status_code, 201)
        self.assertEqual(self.client.post(URL, {'event': str(self.event.id)}, format='json').status_code, 201)  # no duplicate
        data = self.client.get(URL).data
        self.assertEqual((data['ids'], data['events'][0]['slug']), ([str(self.event.id)], 'fest'))
        other = User.objects.create_user(username='b', email='b@x.com', password='pw-123456', role='attendee')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(URL).data['ids'], [])  # each person sees only their own
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.delete(f'{URL}{self.event.id}/').status_code, 204)
        self.assertEqual(self.client.get(URL).data['ids'], [])

    def test_module_off_blocks_it(self):
        PlatformModule.objects.filter(slug='favourites').update(is_globally_enabled=False)
        modules.clear_cache()
        self.client.force_authenticate(self.user)
        r = self.client.get(URL)
        self.assertEqual((r.status_code, r.json().get('code')), (403, 'module_disabled'))
