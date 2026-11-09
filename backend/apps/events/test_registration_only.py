from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core import mail
from rest_framework.test import APITestCase

from .models import Event, EventTicket, TicketType

User = get_user_model()


class RegistrationOnlyTests(APITestCase):
    def setUp(self):
        self.organizer = User.objects.create_user(username='org', email='org@test.com', password='x', role=User.Role.ORGANIZER)
        self.event = Event.objects.create(
            organizer=self.organizer, title='Dharan Run', slug='run', location='Dharan', capacity=2,
            start_date=date.today() + timedelta(days=10), status=Event.Status.PUBLISHED,
            registration_mode=Event.RegistrationMode.FORM,
        )
        # A paid type left over from before the switch: registration-only ignores prices
        TicketType.objects.create(event=self.event, name='Runner', price=500)
        self.url = '/api/forms/events/run/register/'

    def register(self, email, **extra):
        return self.client.post(self.url, {'name': 'Sita', 'email': email, **extra}, format='json')

    def test_free_single_registration_without_pass(self):
        r = self.register('sita@x.com', items=[{'ticket_type_id': None, 'quantity': 5}], payment_method='online')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(r.data['registration_only'])
        self.assertNotIn('ticket', r.data)
        self.assertNotIn('qr_token', str(r.data))
        t = EventTicket.objects.get(event=self.event)
        self.assertEqual((t.price, t.order.total, t.order.payment_status), (0, 0, 'free'))
        self.assertIn('Registration confirmed', mail.outbox[-1].subject)
        self.assertNotIn('/register?view=pass', mail.outbox[-1].body)

    def test_again_returns_registration_and_capacity_counts(self):
        self.register('sita@x.com')
        again = self.register('sita@x.com', additional=True)
        self.assertEqual((again.status_code, again.data['already_registered']), (200, True))
        self.assertEqual(EventTicket.objects.filter(event=self.event).count(), 1)
        self.assertEqual(self.register('ram@x.com').status_code, 201)
        self.assertEqual(self.register('hari@x.com').status_code, 409)

    def test_my_tickets_hide_the_qr(self):
        user = User.objects.create_user(username='sita', email='sita@x.com', password='x', email_verified=True)
        self.client.force_authenticate(user)
        self.register('sita@x.com')
        from rest_framework.test import APIRequestFactory
        from .my_tickets import my_ticket_data
        request = APIRequestFactory().get('/')
        request.user = user
        data = my_ticket_data(EventTicket.objects.get(event=self.event), request)
        self.assertEqual((data['qr_token'], data['registration_only']), (None, True))

    def test_export_lists_registrations_with_answers(self):
        from apps.dynamic_forms.models import Form, FormField
        form = Form.objects.create(organizer=self.organizer, event=self.event, title='Run form', slug='run-form', status='published')
        size = FormField.objects.create(form=form, label='T-shirt size', field_type='select', order=1)
        self.event.registration_form = form
        self.event.save()
        self.register('sita@x.com', answers={str(size.id): 'M'})
        self.client.force_authenticate(self.organizer)
        r = self.client.get(f'/api/events/{self.event.id}/export-attendees/')
        rows = r.content.decode().splitlines()
        self.assertIn('registrations', r['Content-Disposition'])
        self.assertEqual(rows[0], 'Registration No.,Name,Email,Phone,Status,Registered At,T-shirt size')
        self.assertTrue(rows[1].endswith(',registered,' + rows[1].split(',')[5] + ',M'))
