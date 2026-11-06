from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core import mail
from rest_framework.test import APITestCase

from apps.events.models import Event, EventTicket, PromoCode, TicketOrder, TicketType

User = get_user_model()


class OrderTests(APITestCase):
    def setUp(self):
        self.organizer = User.objects.create_user(username='org', email='org@test.com', password='x', role=User.Role.ORGANIZER)
        self.event = Event.objects.create(
            organizer=self.organizer, title='Fest', slug='fest', location='Dharan',
            start_date=date.today() + timedelta(days=20), status=Event.Status.PUBLISHED, max_tickets_per_order=5,
        )
        self.general = TicketType.objects.create(event=self.event, name='General', price=Decimal('500'), order=1)
        self.student = TicketType.objects.create(event=self.event, name='Student', price=Decimal('250'), order=2)

    def register(self, items=None, email='buyer@test.com', **extra):
        body = {'name': 'Asha Rai', 'email': email, **extra}
        if items is not None:
            body['items'] = items
        return self.client.post(f'/api/forms/events/{self.event.slug}/register/', body, format='json')

    def test_multi_type_order_with_guest_names(self):
        res = self.register([
            {'ticket_type_id': str(self.general.id), 'quantity': 2, 'guest_names': ['Bikash Rai']},
            {'ticket_type_id': str(self.student.id), 'quantity': 1},
        ])
        self.assertEqual(res.status_code, 201, res.data)
        names = [t['attendee_name'] for t in res.data['tickets']]
        self.assertEqual(names, ['Asha Rai', 'Bikash Rai', 'Asha Rai · Guest 3'])
        self.assertEqual([t['guest_number'] for t in res.data['tickets']], [0, 1, 2])
        self.assertEqual(len({t['qr_token'] for t in res.data['tickets']}), 3)
        order = TicketOrder.objects.get()
        self.assertEqual((order.ticket_count, order.total), (3, Decimal('1250')))
        self.assertEqual(res.data['order']['reference'], order.reference)
        self.assertEqual(res.data['ticket']['attendee_name'], 'Asha Rai')  # older clients read `ticket`
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('3 passes', mail.outbox[0].subject)
        self.assertIn('/ticket/', mail.outbox[0].body)

    def test_limits(self):
        res = self.register([{'ticket_type_id': str(self.general.id), 'quantity': 6}])
        self.assertEqual(res.status_code, 400)
        self.assertIn('up to 5', res.data['error'])
        self.general.quantity = 2
        self.general.save()
        res = self.register([{'ticket_type_id': str(self.general.id), 'quantity': 3}])
        self.assertEqual(res.status_code, 409)
        self.assertIn('Only 2', res.data['error'])
        self.event.capacity = 1
        self.event.save()
        res = self.register([{'ticket_type_id': str(self.student.id), 'quantity': 2}])
        self.assertEqual(res.status_code, 409)

    def test_legacy_single_ticket_and_already_registered(self):
        res = self.register(ticket_type_id=str(self.general.id))
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(len(res.data['tickets']), 1)
        res = self.register(ticket_type_id=str(self.general.id))
        self.assertTrue(res.data['already_registered'])
        res = self.register([{'ticket_type_id': str(self.student.id), 'quantity': 2}], additional=True)
        self.assertEqual(res.status_code, 201)
        self.assertEqual(EventTicket.objects.filter(attendee_email='buyer@test.com').count(), 3)

    def test_promo_counts_once_per_order_and_discounts_eligible_tickets(self):
        promo = PromoCode.objects.create(event=self.event, code='STU', discount_type='percent', discount_value=20, max_uses=1)
        promo.ticket_types.add(self.student)
        res = self.register([
            {'ticket_type_id': str(self.general.id), 'quantity': 1},
            {'ticket_type_id': str(self.student.id), 'quantity': 2},
        ], promo_code='STU')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual([t['price'] for t in res.data['tickets']], ['500.00', '200.00', '200.00'])
        self.assertEqual([t['promo_code'] for t in res.data['tickets']], [None, 'STU', 'STU'])
        self.assertEqual(promo.used_count, 1)
        res = self.register([{'ticket_type_id': str(self.student.id), 'quantity': 1}], email='other@test.com', promo_code='STU')
        self.assertEqual(res.status_code, 400)  # fully used

    def test_public_pass_page(self):
        token = self.register([{'ticket_type_id': str(self.general.id), 'quantity': 2}]).data['tickets'][1]['qr_token']
        res = self.client.get(f'/api/events/passes/{token}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['ticket']['attendee_name'], 'Asha Rai · Guest 2')
        self.assertEqual(res.data['event']['title'], 'Fest')
        self.assertEqual(self.client.get('/api/events/passes/nope/').status_code, 404)

    def test_organizer_sets_limit(self):
        self.client.force_authenticate(self.organizer)
        res = self.client.patch(f'/api/events/{self.event.id}/', {'max_tickets_per_order': 51}, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.patch(f'/api/events/{self.event.id}/', {'max_tickets_per_order': 2}, format='json')
        self.assertEqual(res.data['max_tickets_per_order'], 2)


class HiddenSpotsTests(APITestCase):
    def setUp(self):
        self.organizer = User.objects.create_user(username='org', email='org@test.com', password='x', role=User.Role.ORGANIZER)
        self.event = Event.objects.create(
            organizer=self.organizer, title='Quiet Fest', slug='quiet-fest', location='Dharan', capacity=100,
            start_date=date.today() + timedelta(days=20), status=Event.Status.PUBLISHED, show_spots_left=False,
        )
        TicketType.objects.create(event=self.event, name='General', price=0, quantity=40)
        EventTicket.generate_ticket(self.event, 'A', 'a@test.com')

    def test_counts_hidden_from_attendees(self):
        ev = self.client.get('/api/events/public/quiet-fest/').data['event']
        self.assertTrue(ev['spots_hidden'])
        self.assertIsNone(ev['spots_left'])
        self.assertEqual((ev['capacity'], ev['registered_count']), (0, 0))
        self.assertIsNone(ev['ticket_types'][0]['remaining'])
        self.assertFalse(ev['is_full'])
        listed = self.client.get('/api/events/public/?when=upcoming').data
        listed = listed['results'] if isinstance(listed, dict) else listed
        self.assertEqual(listed[0]['capacity'], 0)

    def test_full_still_shown_and_organizer_sees_numbers(self):
        self.event.capacity = 1
        self.event.save()
        self.assertTrue(self.client.get('/api/events/public/quiet-fest/').data['event']['is_full'])
        self.client.force_authenticate(self.organizer)
        own = self.client.get(f'/api/events/{self.event.id}/').data
        self.assertEqual((own['capacity'], own['registered_count'], own['show_spots_left']), (1, 1, False))

    def test_visible_by_default(self):
        self.event.show_spots_left = True
        self.event.save()
        ev = self.client.get('/api/events/public/quiet-fest/').data['event']
        self.assertFalse(ev['spots_hidden'])
        self.assertEqual((ev['spots_left'], ev['ticket_types'][0]['remaining']), (99, 40))
