from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import PlatformModule
from apps.accounts.modules import clear_cache
from .models import Event, EventTicket, TicketType

User = get_user_model()


class PrintedTicketTests(APITestCase):
    def setUp(self):
        self.org = User.objects.create_user(username='o', email='o@x.com', password='pw-123456', role='organizer')
        self.other = User.objects.create_user(username='p', email='p@x.com', password='pw-123456', role='organizer')
        self.event = Event.objects.create(organizer=self.org, title='Dharan Film Festival', slug='dff', location='Dharan',
                                          start_date=timezone.localdate(), status='published', capacity=100)
        self.tt = TicketType.objects.create(event=self.event, name='General', price=500)
        self.base = f'/api/events/{self.event.id}/ticket-batches/'
        self.client.force_authenticate(self.org)
        self.addCleanup(clear_cache)

    def create(self, **extra):
        body = {'name': 'Bhatbhateni Dharan', 'quantity': 20, 'ticket_type': str(self.tt.id), **extra}
        return self.client.post(self.base, body, format='json')

    def test_bulk_create_makes_scannable_tickets(self):
        r = self.create()
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['price'], '500.00')  # from the ticket type
        tickets = EventTicket.objects.filter(batch_id=r.data['id'])
        self.assertEqual(tickets.count(), 20)
        self.assertEqual(len(set(tickets.values_list('qr_token', flat=True))), 20)
        t = tickets.order_by('ticket_number').first()
        self.assertTrue(t.ticket_number.endswith('-0001'))
        self.assertEqual(t.price, 0)  # paid at the shop: nothing to collect at the gate
        # The regular gate scan admits it
        res = self.client.post(f'/api/events/{self.event.id}/gate/scan/', {'qr_token': t.qr_token, 'scan_type': 'gate_in'}, format='json')
        self.assertEqual(res.data['result'], 'success', res.data)
        self.assertEqual(self.client.get(self.base).data[0]['used'], 1)

    def test_capacity_and_limits(self):
        self.assertEqual(self.create(quantity=101).status_code, 400)
        self.assertEqual(self.create(quantity=0).status_code, 400)
        self.assertEqual(self.create(template='custom').status_code, 400)  # needs artwork

    def test_pdf_csv_and_preview(self):
        bid = self.create(quantity=7).data['id']
        pdf = self.client.get(f'{self.base}{bid}/pdf/')
        self.assertEqual(pdf['Content-Type'], 'application/pdf')
        self.assertTrue(pdf.content.startswith(b'%PDF'))
        single = self.client.get(f'{self.base}{bid}/pdf/?per_page=single&part=1')
        self.assertTrue(single.content.startswith(b'%PDF'))
        csv = self.client.get(f'{self.base}{bid}/csv/').content.decode()
        self.assertEqual(len(csv.strip().splitlines()), 8)
        png = self.client.post(f'{self.base}preview/', {'template': 'bold', 'layout': 'vertical', 'ticket_type': str(self.tt.id)}, format='json')
        self.assertEqual(png['Content-Type'], 'image/png')

    def test_void_range_and_whole_batch_keep_used_tickets(self):
        bid = self.create(quantity=10).data['id']
        tickets = list(EventTicket.objects.filter(batch_id=bid).order_by('ticket_number'))
        self.client.post(f'/api/events/{self.event.id}/gate/scan/', {'qr_token': tickets[8].qr_token, 'scan_type': 'gate_in'}, format='json')
        self.assertEqual(self.client.post(f'{self.base}{bid}/void/', {'from': 8, 'to': 10}, format='json').data['voided'], 2)
        res = self.client.post(f'/api/events/{self.event.id}/gate/scan/', {'qr_token': tickets[9].qr_token, 'scan_type': 'gate_in'}, format='json')
        self.assertNotEqual(res.data.get('result'), 'success')
        self.assertEqual(self.client.post(f'{self.base}{bid}/void/', {}, format='json').data['voided'], 7)
        tickets[8].refresh_from_db()
        self.assertNotEqual(tickets[8].status, 'cancelled')

    def test_only_organizer_and_module(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.create().status_code, 403)
        self.client.force_authenticate(self.org)
        PlatformModule.objects.filter(slug='offline_tickets').update(is_globally_enabled=False)
        clear_cache()
        self.assertEqual(self.create().status_code, 403)
