from datetime import datetime, time, timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.modules import clear_cache
from .guests import send_due_reminders
from .models import Event, EventTicket

User = get_user_model()


class GuestManagementTests(APITestCase):
    def setUp(self):
        clear_cache()
        self.addCleanup(clear_cache)
        self.org = User.objects.create_user(username='org', email='org@x.com', password='x', role=User.Role.ORGANIZER)
        self.event = Event.objects.create(organizer=self.org, title='Gala', slug='gala', location='Dharan',
                                          start_date=timezone.localdate(), start_time=time(23, 59), status='published')
        mk = lambda n, e: EventTicket.generate_ticket(event=self.event, name=n, email=e, phone='', price=0)  # noqa: E731
        self.vip, self.guest, self.guest2 = mk('Hari Rai', 'hari@x.com'), mk('Sita', 'sita@x.com'), mk('Sita guest', 'sita@x.com')
        self.client.force_authenticate(self.org)
        self.base = f'/api/events/{self.event.id}'

    def test_tags_and_notes_are_for_staff_only(self):
        r = self.client.patch(f'{self.base}/guests/{self.vip.id}/', {'tags': ['VIP', ' vip ', 'Press'], 'note': 'Front row'}, format='json')
        self.assertEqual((r.data['guest_tags'], r.data['host_note']), (['VIP', 'Press'], 'Front row'))
        listed = {t['attendee_name']: t for t in self.client.get(f'{self.base}/tickets/').data}
        self.assertEqual(listed['Hari Rai']['guest_tags'], ['VIP', 'Press'])
        from rest_framework.test import APIRequestFactory
        from .my_tickets import my_ticket_data
        request = APIRequestFactory().get('/')
        request.user = self.org
        self.assertNotIn('host_note', my_ticket_data(EventTicket.objects.get(pk=self.vip.pk), request))
        self.client.force_authenticate(User.objects.create_user(username='a', email='a@x.com', password='x'))
        self.assertEqual(self.client.patch(f'{self.base}/guests/{self.vip.id}/', {'note': 'x'}, format='json').status_code, 403)

    def test_arrival_alert_only_for_tagged_guests_by_default(self):
        self.client.patch(f'{self.base}/guests/{self.vip.id}/', {'tags': ['VIP']}, format='json')
        with mock.patch('apps.core.fcm.send_push_to_event_staff', return_value=1) as push:
            for t in (self.guest, self.vip):
                with self.captureOnCommitCallbacks(execute=True):  # the alert goes out after the scan is saved
                    self.client.post(f'{self.base}/gate/scan/', {'qr_token': t.qr_token, 'scan_type': 'gate_in'}, format='json')
        self.assertEqual(push.call_count, 1)
        self.assertIn('Hari Rai (VIP) is IN', push.call_args[0][1])
        arrivals = self.client.get(f'{self.base}/arrivals/').data
        self.assertEqual([a['name'] for a in arrivals], ['Hari Rai', 'Sita'])

    def test_messages_go_once_per_email_and_are_rate_limited(self):
        r = self.client.post(f'{self.base}/guest-messages/', {'subject': 'Doors open', 'body': 'Come in!', 'dry_run': True}, format='json')
        self.assertEqual(r.data['recipients'], 2)  # Sita's two tickets share one email
        r = self.client.post(f'{self.base}/guest-messages/', {'subject': 'Doors open', 'body': 'Come in!'}, format='json')
        self.assertEqual((r.status_code, r.data['recipients'], len(mail.outbox)), (201, 2, 2))
        self.assertIn('Doors open', mail.outbox[0].subject)
        self.client.post(f'{self.base}/gate/scan/', {'qr_token': self.vip.qr_token, 'scan_type': 'gate_in'}, format='json')
        r = self.client.post(f'{self.base}/guest-messages/', {'subject': 'Late?', 'body': 'Gates close at 9', 'audience': 'not_arrived'}, format='json')
        self.assertEqual(r.data['recipients'], 1)
        for _ in range(3):
            self.client.post(f'{self.base}/guest-messages/', {'subject': 's', 'body': 'b'}, format='json')
        self.assertEqual(self.client.post(f'{self.base}/guest-messages/', {'subject': 's', 'body': 'b'}, format='json').status_code, 429)
        self.assertEqual(len(self.client.get(f'{self.base}/guest-messages/').data), 5)

    def test_reminders_go_once_in_each_window(self):
        start = timezone.make_aware(datetime.combine(timezone.localdate() + timedelta(days=1), time(18, 0)))
        Event.objects.filter(pk=self.event.pk).update(start_date=start.date(), start_time=time(18, 0))
        self.assertEqual(send_due_reminders(now=start - timedelta(hours=20)), 2)
        self.assertEqual(send_due_reminders(now=start - timedelta(hours=19)), 0)  # already sent
        self.assertEqual(send_due_reminders(now=start - timedelta(hours=1)), 2)  # "starting soon"
        self.assertIn('Starting soon', mail.outbox[-1].subject)

    def test_module_off_blocks_guest_endpoints(self):
        from apps.accounts.models import PlatformModule
        PlatformModule.objects.filter(slug='guest_management').update(is_globally_enabled=False)
        clear_cache()
        self.assertEqual(self.client.get(f'{self.base}/arrivals/').status_code, 403)
