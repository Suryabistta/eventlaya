"""Scheduled stages (module stage_schedule): registration opens by itself at registration_opens, e.g. when
applications close."""
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Event, EventTicket

User = get_user_model()


class StageScheduleTests(APITestCase):
    def setUp(self):
        self.organizer = User.objects.create_user(username='org', email='org@test.com', password='x', role=User.Role.ORGANIZER)
        self.event = Event.objects.create(
            organizer=self.organizer, title='Dharan Film Festival', slug='dff', location='Dharan',
            start_date=date.today() + timedelta(days=30), status=Event.Status.PUBLISHED,
            registration_mode=Event.RegistrationMode.FORM,
            applications_enabled=True, applications_close=timezone.now() + timedelta(days=5),
            allow_registration=False, registration_opens=timezone.now() + timedelta(days=5),
        )
        self.url = f'/api/events/{self.event.id}/'

    def register(self, email='sita@x.com'):
        return self.client.post('/api/forms/events/dff/register/', {'name': 'Sita', 'email': email, 'phone': '9800000000'}, format='json')

    def page(self):
        return self.client.get('/api/events/public/dff/').data['event']

    def due(self):
        Event.objects.filter(pk=self.event.pk).update(registration_opens=timezone.now() - timedelta(minutes=1))

    def test_waiting_registration_is_closed_with_its_opening_time(self):
        page = self.page()
        self.assertFalse(page['registration_open'])
        self.assertEqual(page['registration_closed_reason'], 'Registration opens soon.')
        self.assertIsNotNone(page['registration_opens'])
        self.assertEqual(self.register().status_code, 400)

    def test_registration_opens_by_itself_and_the_flags_catch_up(self):
        self.due()
        page = self.page()
        self.assertTrue(page['registration_open'])
        self.assertIsNone(page['registration_opens'])
        self.event.refresh_from_db()
        self.assertTrue(self.event.allow_registration)
        self.assertTrue(self.event.tickets_enabled)
        self.assertEqual(self.register().status_code, 201)
        self.assertEqual(EventTicket.objects.filter(event=self.event).count(), 1)

    def test_due_schedule_opens_registration_even_before_the_flags_update(self):
        self.due()
        self.event.refresh_from_db()
        self.assertIsNone(self.event.registration_closed_reason())

    def test_tickets_stage_off_also_opens_on_schedule(self):
        Event.objects.filter(pk=self.event.pk).update(tickets_enabled=False)
        self.assertEqual(self.page()['registration_closed_reason'], 'Registration opens soon.')
        self.due()
        self.assertTrue(self.page()['registration_open'])
        self.event.refresh_from_db()
        self.assertTrue(self.event.tickets_enabled)

    def test_deadline_still_applies_once_open(self):
        Event.objects.filter(pk=self.event.pk).update(registration_deadline=timezone.now() - timedelta(seconds=1))
        self.due()
        self.event.refresh_from_db()
        self.assertEqual(self.event.registration_closed_reason(), 'Registration deadline has passed.')

    def test_organizer_list_opens_due_events(self):
        self.due()
        self.client.force_authenticate(self.organizer)
        self.client.get('/api/events/')
        self.event.refresh_from_db()
        self.assertTrue(self.event.allow_registration)
        self.assertIsNone(self.event.registration_opens)

    def test_open_now_and_close_now_cancel_the_schedule(self):
        self.client.force_authenticate(self.organizer)
        r = self.client.patch(self.url, {'allow_registration': True}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIsNone(r.data['registration_opens'])
        self.assertTrue(r.data['registration_open'])

    def test_setting_a_schedule(self):
        self.client.force_authenticate(self.organizer)
        when = timezone.now() + timedelta(days=2)
        r = self.client.patch(self.url, {'registration_opens': when.isoformat()}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertFalse(r.data['registration_open'])
        # A schedule sent together with "allow_registration" keeps the schedule
        r = self.client.patch(self.url, {'registration_opens': when.isoformat(), 'allow_registration': True}, format='json')
        self.assertIsNotNone(r.data['registration_opens'])
        self.assertFalse(r.data['registration_open'])

    def test_schedule_validation(self):
        self.client.force_authenticate(self.organizer)
        past = self.client.patch(self.url, {'registration_opens': (timezone.now() - timedelta(hours=1)).isoformat()}, format='json')
        self.assertEqual(past.status_code, 400)
        Event.objects.filter(pk=self.event.pk).update(registration_deadline=timezone.now() + timedelta(days=1))
        late = self.client.patch(self.url, {'registration_opens': (timezone.now() + timedelta(days=2)).isoformat()}, format='json')
        self.assertEqual(late.status_code, 400)
        self.assertIn('registration_opens', late.data)

    def test_module_off_ignores_and_refuses_schedules(self):
        from apps.accounts.models import PlatformModule
        from apps.accounts.modules import clear_cache
        PlatformModule.objects.update_or_create(slug='stage_schedule', defaults={'name': 'Scheduled stages', 'is_globally_enabled': False})
        clear_cache()
        self.addCleanup(clear_cache)
        # The waiting schedule no longer counts: registration follows the organizer's switch (closed)
        self.assertEqual(self.page()['registration_closed_reason'], 'Registration is currently closed for this event.')
        self.due()
        self.page()
        self.event.refresh_from_db()
        self.assertFalse(self.event.allow_registration)  # not opened while the module is off
        self.client.force_authenticate(self.organizer)
        r = self.client.patch(self.url, {'registration_opens': (timezone.now() + timedelta(days=2)).isoformat()}, format='json')
        self.assertEqual(r.status_code, 400)
