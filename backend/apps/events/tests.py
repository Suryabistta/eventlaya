from rest_framework.test import APITestCase
from rest_framework import status
from django.contrib.auth import get_user_model
from apps.events.models import Event, EventTicket, GateScanLog
from apps.dynamic_forms.models import Form, FormField

User = get_user_model()

class EventlayaCoreTests(APITestCase):
    def setUp(self):
        self.organizer = User.objects.create_user(
            username='test_org',
            email='test@org.com',
            password='password123',
            role=User.Role.ORGANIZER
        )
        self.form = Form.objects.create(
            organizer=self.organizer,
            title='Test Form',
            slug='test-form',
            status=Form.Status.PUBLISHED
        )
        self.field1 = FormField.objects.create(
            form=self.form,
            field_type=FormField.FieldType.TEXT,
            label='Organization',
            required=True,
            order=1
        )
        self.event = Event.objects.create(
            organizer=self.organizer,
            title='Dharan Tech Meetup',
            slug='dharan-tech-meetup',
            description='Test event description',
            location='Dharan Hall',
            start_date='2026-11-01',
            status=Event.Status.PUBLISHED,
            allow_registration=True,
            registration_form=self.form
        )
        self.form.event = self.event
        self.form.save()

    def test_public_event_details_and_form_schema(self):
        res = self.client.get(f'/api/events/public/{self.event.slug}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['event']['title'], 'Dharan Tech Meetup')
        self.assertIsNotNone(res.data['form'])
        self.assertEqual(len(res.data['form']['fields']), 1)

    def test_event_registration_creates_ticket_and_response(self):
        payload = {
            'name': 'Suman Giri',
            'email': 'suman@example.com',
            'phone': '+977-9812345678',
            'answers': {
                str(self.field1.id): 'Dharan IT Hub'
            }
        }
        res = self.client.post(f'/api/forms/events/{self.event.slug}/register/', data=payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertIn('ticket', res.data)
        ticket_number = res.data['ticket']['ticket_number']
        qr_token = res.data['ticket']['qr_token']
        self.assertTrue(ticket_number.startswith('TKT-'))

        # Check Ticket in DB
        ticket = EventTicket.objects.get(qr_token=qr_token)
        self.assertEqual(ticket.attendee_name, 'Suman Giri')
        self.assertEqual(ticket.status, EventTicket.Status.VALID)

        # Test Gate In Scan
        scan_payload = {
            'qr_token': qr_token,
            'scan_type': 'gate_in',
            'gate_name': 'Gate A'
        }
        scan_res = self.client.post(f'/api/events/{self.event.id}/gate/scan/', data=scan_payload, format='json')
        self.assertEqual(scan_res.status_code, status.HTTP_200_OK)
        self.assertEqual(scan_res.data['result'], 'success')
        self.assertEqual(scan_res.data['ticket']['status'], 'checked_in')

        # Test Duplicate Scan Detection
        dup_res = self.client.post(f'/api/events/{self.event.id}/gate/scan/', data=scan_payload, format='json')
        self.assertEqual(dup_res.status_code, status.HTTP_200_OK)
        self.assertEqual(dup_res.data['result'], 'duplicate')
        self.assertIn('already inside', dup_res.data['message'])

        # Test Gate Out Scan
        out_payload = {
            'qr_token': qr_token,
            'scan_type': 'gate_out',
            'gate_name': 'Gate A'
        }
        out_res = self.client.post(f'/api/events/{self.event.id}/gate/scan/', data=out_payload, format='json')
        self.assertEqual(out_res.status_code, status.HTTP_200_OK)
        self.assertEqual(out_res.data['result'], 'success')
        self.assertEqual(out_res.data['ticket']['status'], 'checked_out')
