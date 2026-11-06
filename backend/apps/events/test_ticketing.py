from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.events.models import Event, EventGate, EventTicket, PromoCode, TicketType

User = get_user_model()


class TicketingBase(APITestCase):
    def setUp(self):
        self.organizer = User.objects.create_user(username='org', email='org@test.com', password='x', role=User.Role.ORGANIZER)
        self.other = User.objects.create_user(username='org2', email='org2@test.com', password='x', role=User.Role.ORGANIZER)
        self.event = Event.objects.create(
            organizer=self.organizer, title='Tech Fest', slug='tech-fest', location='Dharan',
            start_date=date.today() + timedelta(days=30), status=Event.Status.PUBLISHED,
        )
        self.general = TicketType.objects.create(event=self.event, name='General', price=Decimal('500'), order=1)

    def url(self, suffix=''):
        return f'/api/events/{self.event.id}/{suffix}'

    def register(self, email='a@test.com', **body):
        return self.client.post(f'/api/forms/events/{self.event.slug}/register/', {'name': 'Asha', 'email': email, **body}, format='json')


class RegistrationTests(TicketingBase):
    def test_single_type_is_picked_automatically(self):
        res = self.register()
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['ticket']['ticket_type_name'], 'General')
        self.assertEqual(Decimal(res.data['ticket']['price']), Decimal('500'))

    def test_must_choose_when_several_types(self):
        TicketType.objects.create(event=self.event, name='Student', price=Decimal('250'))
        self.assertEqual(self.register().status_code, 400)
        student = TicketType.objects.get(name='Student')
        res = self.register(ticket_type_id=str(student.id))
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(Decimal(res.data['ticket']['price']), Decimal('250'))

    def test_quantity_sells_out(self):
        self.general.quantity = 1
        self.general.save()
        self.assertEqual(self.register('a@test.com').status_code, 201)
        res = self.register('b@test.com', ticket_type_id=str(self.general.id))
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertIn('sold out', res.data['error'])

    def test_sales_window(self):
        self.general.sales_end = timezone.now() - timedelta(hours=1)
        self.general.save()
        self.assertEqual(self.register(ticket_type_id=str(self.general.id)).status_code, 400)
        self.general.sales_end = None
        self.general.sales_start = timezone.now() + timedelta(days=1)
        self.general.save()
        self.assertEqual(self.register(ticket_type_id=str(self.general.id)).status_code, 400)

    def test_hidden_type_needs_unlocking_code(self):
        sponsor = TicketType.objects.create(event=self.event, name='Sponsor', price=0, is_hidden=True)
        promo = PromoCode.objects.create(event=self.event, code='sponsor', discount_type='none')
        promo.ticket_types.add(sponsor)
        self.assertEqual(self.register(ticket_type_id=str(sponsor.id)).status_code, 400)
        res = self.register(ticket_type_id=str(sponsor.id), promo_code='SPONSOR')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['ticket']['promo_code'], 'SPONSOR')

    def test_percent_and_amount_discounts(self):
        PromoCode.objects.create(event=self.event, code='HALF', discount_type='percent', discount_value=50)
        PromoCode.objects.create(event=self.event, code='MINUS600', discount_type='amount', discount_value=600)
        self.assertEqual(Decimal(self.register('a@test.com', promo_code='half').data['ticket']['price']), Decimal('250'))
        self.assertEqual(Decimal(self.register('b@test.com', promo_code='MINUS600').data['ticket']['price']), Decimal('0'))

    def test_promo_limits(self):
        PromoCode.objects.create(event=self.event, code='ONCE', discount_value=10, max_uses=1)
        self.assertEqual(self.register('a@test.com', promo_code='ONCE').status_code, 201)
        self.assertEqual(self.register('b@test.com', promo_code='ONCE').status_code, 400)
        PromoCode.objects.create(event=self.event, code='OLD', discount_value=10, valid_until=timezone.now() - timedelta(days=1))
        self.assertEqual(self.register('c@test.com', promo_code='OLD').status_code, 400)
        self.assertEqual(self.register('d@test.com', promo_code='NOPE').status_code, 400)

    def test_promo_limited_to_types(self):
        vip = TicketType.objects.create(event=self.event, name='VIP', price=Decimal('1000'))
        promo = PromoCode.objects.create(event=self.event, code='VIP10', discount_value=10)
        promo.ticket_types.add(vip)
        res = self.register(ticket_type_id=str(self.general.id), promo_code='VIP10')
        self.assertEqual(res.status_code, 400)
        res = self.register(ticket_type_id=str(vip.id), promo_code='VIP10')
        self.assertEqual(Decimal(res.data['ticket']['price']), Decimal('900'))

    def test_public_page_and_promo_check(self):
        TicketType.objects.create(event=self.event, name='Secret', price=0, is_hidden=True)
        res = self.client.get(f'/api/events/public/{self.event.slug}/')
        self.assertEqual([t['name'] for t in res.data['event']['ticket_types']], ['General'])
        PromoCode.objects.create(event=self.event, code='TEN', discount_value=10)
        res = self.client.post(f'/api/events/public/{self.event.slug}/promo/', {'code': 'ten'}, format='json')
        self.assertTrue(res.data['valid'])
        self.assertEqual(res.data['ticket_types'][0]['discounted_price'], '450.00')
        res = self.client.post(f'/api/events/public/{self.event.slug}/promo/', {'code': 'bad'}, format='json')
        self.assertEqual(res.status_code, 400)


class OrganizerTests(TicketingBase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.organizer)

    def test_crud_and_permissions(self):
        res = self.client.post(self.url('ticket-types/'), {'name': 'Student', 'price': '250', 'gate_note': 'Check ID'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual([t['name'] for t in self.client.get(self.url('ticket-types/')).data], ['General', 'Student'])
        res = self.client.patch(self.url(f'ticket-types/{res.data["id"]}/'), {'price': '300'}, format='json')
        self.assertEqual(res.data['price'], '300.00')
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.url('ticket-types/')).status_code, 403)

    def test_delete_sold_type_deactivates(self):
        EventTicket.generate_ticket(self.event, 'A', 'a@test.com', ticket_type=self.general)
        res = self.client.delete(self.url(f'ticket-types/{self.general.id}/'))
        self.assertTrue(res.data['deactivated'])
        self.general.refresh_from_db()
        self.assertFalse(self.general.is_active)

    def test_quantity_cannot_go_below_sold(self):
        EventTicket.generate_ticket(self.event, 'A', 'a@test.com', ticket_type=self.general)
        EventTicket.generate_ticket(self.event, 'B', 'b@test.com', ticket_type=self.general)
        res = self.client.patch(self.url(f'ticket-types/{self.general.id}/'), {'quantity': 1}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_presets(self):
        res = self.client.post(self.url('ticket-types/preset/'), {'preset': 'full', 'base_price': 1000}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        prices = {t['name']: t['price'] for t in res.data['ticket_types']}
        self.assertEqual(prices, {'Early Bird': '800.00', 'Student': '500.00', 'General': '1000.00', 'VIP': '2000.00'})
        self.event.refresh_from_db()
        self.assertTrue(self.event.is_paid)
        self.assertEqual(self.event.ticket_price, Decimal('500.00'))
        res = self.client.post(self.url('ticket-types/preset/'), {'preset': 'free'}, format='json')
        self.assertEqual([t['name'] for t in res.data['ticket_types']], ['Free entry'])
        self.event.refresh_from_db()
        self.assertFalse(self.event.is_paid)
        self.assertEqual(self.client.post(self.url('ticket-types/preset/'), {'preset': 'student'}, format='json').status_code, 400)

    def test_promo_code_crud(self):
        res = self.client.post(self.url('promo-codes/'), {'code': 'early 10'}, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.post(self.url('promo-codes/'), {'code': 'early10', 'discount_type': 'percent', 'discount_value': '10'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['code'], 'EARLY10')
        self.assertEqual(self.client.post(self.url('promo-codes/'), {'code': 'EARLY10', 'discount_value': '5'}, format='json').status_code, 400)
        self.assertEqual(self.client.delete(self.url(f'promo-codes/{res.data["id"]}/')).data['deleted'], True)

    def test_new_event_gets_default_type(self):
        res = self.client.post('/api/events/', {
            'title': 'New One', 'slug': 'new-one', 'location': 'Itahari', 'start_date': str(date.today() + timedelta(days=5)),
            'is_paid': True, 'ticket_price': '300',
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        types = TicketType.objects.filter(event_id=res.data['id'])
        self.assertEqual([(t.name, t.price) for t in types], [('General', Decimal('300.00'))])


class ScanTests(TicketingBase):
    def test_vip_ticket_only_at_vip_gate(self):
        main = EventGate.objects.create(event=self.event, name='Main gate')
        vip_gate = EventGate.objects.create(event=self.event, name='VIP entrance', is_vip=True)
        vip = TicketType.objects.create(event=self.event, name='VIP', price=1000, gate_note='Wristband')
        vip.allowed_gates.add(vip_gate)
        self.event.start_date = date.today()
        self.event.save()
        ticket = EventTicket.generate_ticket(self.event, 'A', 'a@test.com', ticket_type=vip, ticket_type_name='VIP')
        self.client.force_authenticate(self.organizer)
        res = self.client.post(self.url('gate/scan/'), {'qr_token': ticket.qr_token, 'scan_type': 'gate_in', 'gate_id': str(main.id)}, format='json')
        self.assertEqual(res.data['result'], 'wrong_ticket_gate')
        res = self.client.post(self.url('gate/scan/'), {'qr_token': ticket.qr_token, 'scan_type': 'gate_in', 'gate_id': str(vip_gate.id)}, format='json')
        self.assertEqual(res.data['result'], 'success', res.data)
        self.assertEqual(res.data['ticket']['ticket_type_name'], 'VIP')
        self.assertEqual(res.data['ticket']['gate_note'], 'Wristband')
