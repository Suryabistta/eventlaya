from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.accounts.models import PlatformModule, RoleModulePermission
from apps.accounts.modules import clear_cache, module_for_path
from apps.events.models import Event

User = get_user_model()


class ModuleEnforcementTests(APITestCase):
    def setUp(self):
        clear_cache()
        self.organizer = User.objects.create_user(username='org', email='org@test.com', password='x', role=User.Role.ORGANIZER)
        self.staff = User.objects.create_user(username='st', email='st@test.com', password='x', role=User.Role.STAFF)
        self.admin = User.objects.create_user(username='ad', email='ad@test.com', password='x', role=User.Role.SUPERADMIN)
        Event.objects.create(organizer=self.organizer, title='Fest', slug='fest', location='X',
                             start_date=date.today() + timedelta(days=3), status=Event.Status.PUBLISHED)

    def test_modules_are_seeded(self):
        self.assertTrue(PlatformModule.objects.filter(slug='chat').exists())
        self.assertFalse(RoleModulePermission.objects.get(module__slug='chat', role='attendee').is_enabled)

    def test_path_mapping(self):
        self.assertEqual(module_for_path('/api/voting/polls/'), 'voting')
        self.assertEqual(module_for_path('/api/events/staff-assign/'), 'staff_management')
        self.assertEqual(module_for_path('/api/events/0c4b6286-16dc-4a40-91b4-19a578257e30/gate/scan/'), 'gate_scanner')
        self.assertEqual(module_for_path('/api/forms/events/fest/register/'), 'events')
        self.assertEqual(module_for_path('/api/events/public/'), 'events')
        self.assertIsNone(module_for_path('/api/auth/me/'))

    def test_global_switch_blocks_everyone_but_superadmin(self):
        self.assertEqual(self.client.get('/api/events/public/').status_code, 200)
        PlatformModule.objects.filter(slug='events').update(is_globally_enabled=False)
        clear_cache()
        res = self.client.get('/api/events/public/')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'module_disabled')
        for email, expected in (('org@test.com', 403), ('ad@test.com', 200)):
            token = self.client.post('/api/auth/login/', {'email': email, 'password': 'x'}, format='json').data['access']
            self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
            self.assertEqual(self.client.get('/api/events/').status_code, expected, email)

    def test_role_switch_with_jwt(self):
        RoleModulePermission.objects.filter(module__slug='events', role='organizer').update(is_enabled=False)
        clear_cache()
        token = self.client.post('/api/auth/login/', {'email': 'org@test.com', 'password': 'x'}, format='json').data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(self.client.get('/api/events/').status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.get('/api/events/public/').status_code, 200)  # anonymous: global switch only

    def test_toggle_takes_effect_immediately(self):
        module = PlatformModule.objects.get(slug='voting')
        module.is_globally_enabled = False
        module.save()  # signal clears the cache
        self.assertEqual(self.client.get('/api/voting/public/events/fest/polls/').status_code, 403)
