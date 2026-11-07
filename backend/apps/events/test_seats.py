from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.accounts.models import PlatformModule
from apps.accounts.modules import clear_cache
from .models import Event, EventTicket

User = get_user_model()


class SeatTests(APITestCase):
    def setUp(self):
        self.org = User.objects.create_user(username='o', email='o@x.com', password='pw-123456', role='organizer')
        self.other = User.objects.create_user(username='p', email='p@x.com', password='pw-123456', role='organizer')
        self.event = Event.objects.create(organizer=self.org, title='Fest', slug='fest', location='Dharan', start_date='2030-01-01', status='published')
        self.t1 = EventTicket.generate_ticket(self.event, 'A', 'a@x.com')
        self.t2 = EventTicket.generate_ticket(self.event, 'B', 'b@x.com')
        self.url = f'/api/events/{self.event.id}/seats/'
        self.addCleanup(clear_cache)

    def assign(self, rows, user=None):
        self.client.force_authenticate(user or self.org)
        return self.client.post(self.url, {'assignments': rows}, format='json')

    def test_assign_by_ticket_number_and_email(self):
        r = self.assign([{'ticket': self.t1.ticket_number, 'seat': 'A-1'}, {'ticket': 'B@x.com', 'seat': 'A-2'}])
        self.assertEqual(r.data, {'updated': 2, 'errors': []})
        self.t1.refresh_from_db()
        self.assertEqual(self.t1.seat_number, 'A-1')

    def test_duplicates_unknown_and_taken_rejected(self):
        self.assign([{'ticket': self.t1.ticket_number, 'seat': 'A-1'}])
        r = self.assign([
            {'ticket': self.t2.ticket_number, 'seat': 'a-1'},  # already t1's
            {'ticket': 'nobody@x.com', 'seat': 'A-3'},
        ])
        self.assertEqual(r.data['updated'], 0)
        self.assertEqual(len(r.data['errors']), 2)
        r = self.assign([{'ticket': self.t1.ticket_number, 'seat': 'B-1'}, {'ticket': self.t2.ticket_number, 'seat': 'B-1'}])
        self.assertEqual(r.data['updated'], 1)

    def test_only_organizer(self):
        self.assertEqual(self.assign([{'ticket': self.t1.ticket_number, 'seat': 'A-1'}], self.other).status_code, 403)

    def test_attendee_sees_seat_only_when_shown(self):
        self.assign([{'ticket': self.t1.ticket_number, 'seat': 'A-1'}])
        self.client.force_authenticate(None)
        pass_url = f'/api/events/passes/{self.t1.qr_token}/'
        self.assertEqual(self.client.get(pass_url).data['ticket']['seat_number'], '')
        self.event.show_seat_number = True
        self.event.save()
        data = self.client.get(pass_url).data['ticket']
        self.assertEqual(data['seat_number'], 'A-1')
        self.assertEqual(data['pass_layout'], 'vertical')

    def test_module_off_blocks_and_hides(self):
        self.assign([{'ticket': self.t1.ticket_number, 'seat': 'A-1'}])
        self.event.show_seat_number = True
        self.event.save()
        PlatformModule.objects.filter(slug='seat_numbers').update(is_globally_enabled=False)
        clear_cache()
        self.assertEqual(self.assign([{'ticket': self.t1.ticket_number, 'seat': 'A-2'}]).status_code, 403)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f'/api/events/passes/{self.t1.qr_token}/').data['ticket']['seat_number'], '')
