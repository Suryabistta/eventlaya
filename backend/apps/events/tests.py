import json
from datetime import date, timedelta
from rest_framework.test import APITestCase
from rest_framework import status
from django.contrib.auth import get_user_model
from django.utils import timezone
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
        self.client.force_authenticate(user=self.organizer)

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
        self.today = date.today()
        self.event = Event.objects.create(
            organizer=self.organizer,
            title='Dharan Tech Meetup',
            slug='dharan-tech-meetup',
            description='Test event description',
            location='Dharan Hall',
            start_date=self.today,
            end_date=self.today + timedelta(days=1),
            status=Event.Status.PUBLISHED,
            allow_registration=True,
            registration_form=self.form
        )
        self.form.event = self.event
        self.form.save()

    # --- 1. EVENT CREATION EDGE CASES ---

    def test_event_creation_auto_slug(self):
        """Creating an event without a slug automatically derives slug from title."""
        payload = {
            'title': 'Eastern Nepal AI Symposium',
            'location': 'Itahari Auditorium',
            'start_date': str(self.today + timedelta(days=10)),
            'capacity': 150,
            'status': 'published',
            'is_paid': False,
        }
        res = self.client.post('/api/events/', data=payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['slug'], 'eastern-nepal-ai-symposium')

    def test_event_creation_duplicate_slug_deduplication(self):
        """Creating events with identical titles auto-deduplicates slugs."""
        payload = {
            'title': 'Province 1 Hackathon',
            'location': 'Biratnagar Hall',
            'start_date': str(self.today + timedelta(days=5)),
            'capacity': 100,
            'status': 'published',
        }
        res1 = self.client.post('/api/events/', data=payload, format='json')
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res1.data['slug'], 'province-1-hackathon')

        # Create second event with same title
        res2 = self.client.post('/api/events/', data=payload, format='json')
        self.assertEqual(res2.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res2.data['slug'], 'province-1-hackathon-1')

    def test_event_creation_invalid_dates_rejected(self):
        """End date cannot be earlier than start date."""
        payload = {
            'title': 'Invalid Date Event',
            'location': 'Dharan',
            'start_date': '2026-11-10',
            'end_date': '2026-11-05',
            'capacity': 50,
        }
        res = self.client.post('/api/events/', data=payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('end_date', res.data)

    def test_event_creation_paid_event_without_price_rejected(self):
        """Paid events must specify a positive ticket price."""
        payload = {
            'title': 'VIP Concert',
            'location': 'Dharan Stadium',
            'start_date': str(self.today + timedelta(days=15)),
            'is_paid': True,
            'ticket_price': 0,
        }
        res = self.client.post('/api/events/', data=payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('ticket_price', res.data)

    # --- 2. QR GENERATION & REGISTRATION EDGE CASES ---

    def test_public_event_details_and_form_schema(self):
        self.client.logout()
        res = self.client.get(f'/api/events/public/{self.event.slug}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['event']['title'], 'Dharan Tech Meetup')
        self.assertIsNotNone(res.data['form'])
        self.assertEqual(len(res.data['form']['fields']), 1)

    def test_event_registration_creates_ticket_and_response(self):
        self.client.logout()
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

        ticket = EventTicket.objects.get(qr_token=qr_token)
        self.assertEqual(ticket.attendee_name, 'Suman Giri')
        self.assertEqual(ticket.status, EventTicket.Status.VALID)

    def test_registration_duplicate_email_returns_existing_ticket_gracefully(self):
        """Re-registering with the same email returns the existing active QR pass with HTTP 200."""
        self.client.logout()
        payload = {
            'name': 'Suman Giri',
            'email': 'suman@example.com',
            'phone': '+977-9812345678',
            'answers': {str(self.field1.id): 'Dharan IT Hub'}
        }
        # First registration
        res1 = self.client.post(f'/api/forms/events/{self.event.slug}/register/', data=payload, format='json')
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        # Second registration with same email
        res2 = self.client.post(f'/api/forms/events/{self.event.slug}/register/', data=payload, format='json')
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertTrue(res2.data.get('already_registered'))
        self.assertEqual(res2.data['ticket']['qr_token'], res1.data['ticket']['qr_token'])

    def test_registration_capacity_full_rejected(self):
        """When event capacity is reached, registration is blocked with 409 Conflict."""
        self.client.logout()
        self.event.capacity = 1
        self.event.save()

        # Fill capacity
        payload1 = {'name': 'User One', 'email': 'user1@test.com', 'answers': {str(self.field1.id): 'A'}}
        res1 = self.client.post(f'/api/forms/events/{self.event.slug}/register/', data=payload1, format='json')
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        # Try to register second attendee
        payload2 = {'name': 'User Two', 'email': 'user2@test.com', 'answers': {str(self.field1.id): 'B'}}
        res2 = self.client.post(f'/api/forms/events/{self.event.slug}/register/', data=payload2, format='json')
        self.assertEqual(res2.status_code, status.HTTP_409_CONFLICT)
        self.assertIn('capacity', res2.data['error'])

    # --- 3. QR CHECKING & GATE SCANNING ON EVENT DATE ---

    def test_gate_scan_flow_and_reentry(self):
        """Tests Gate In, duplicate rejection, Gate Out, and Re-entry pass-back flow."""
        self.client.logout()
        ticket = EventTicket.generate_ticket(self.event, 'Bikash Rai', 'bikash@test.com')

        # 1. Gate In Scan
        scan_res = self.client.post(f'/api/events/{self.event.id}/gate/scan/', data={
            'qr_token': ticket.qr_token,
            'scan_type': 'gate_in',
            'gate_name': 'North Gate'
        }, format='json')
        self.assertEqual(scan_res.status_code, status.HTTP_200_OK)
        self.assertEqual(scan_res.data['result'], 'success')
        self.assertEqual(scan_res.data['status'], 'gate_in')

        # 2. Duplicate Gate In Attempt (Fraud detection)
        dup_res = self.client.post(f'/api/events/{self.event.id}/gate/scan/', data={
            'qr_token': ticket.qr_token,
            'scan_type': 'gate_in',
            'gate_name': 'North Gate'
        }, format='json')
        self.assertEqual(dup_res.status_code, status.HTTP_200_OK)
        self.assertEqual(dup_res.data['result'], 'duplicate')
        self.assertIn('already inside', dup_res.data['message'])

        # 3. Gate Out Scan
        out_res = self.client.post(f'/api/events/{self.event.id}/gate/scan/', data={
            'qr_token': ticket.qr_token,
            'scan_type': 'gate_out',
            'gate_name': 'North Gate'
        }, format='json')
        self.assertEqual(out_res.status_code, status.HTTP_200_OK)
        self.assertEqual(out_res.data['result'], 'success')
        self.assertEqual(out_res.data['status'], 'gate_out')

        # 4. Re-Entry Gate In (Pass-back re-entry)
        reentry_res = self.client.post(f'/api/events/{self.event.id}/gate/scan/', data={
            'qr_token': ticket.qr_token,
            'scan_type': 'gate_in',
            'gate_name': 'North Gate'
        }, format='json')
        self.assertEqual(reentry_res.status_code, status.HTTP_200_OK)
        self.assertEqual(reentry_res.data['result'], 'success')
        self.assertEqual(reentry_res.data['status'], 're_entry')
        self.assertIn('Re-Entry', reentry_res.data['message'])

    def test_gate_scan_cross_event_wrong_checkpoint(self):
        """Scanning a ticket belonging to another event indicates wrong event checkpoint."""
        self.client.logout()
        other_event = Event.objects.create(
            organizer=self.organizer,
            title='Biratnagar Music Festival',
            slug='biratnagar-music-fest',
            location='Biratnagar',
            start_date=self.today,
            status=Event.Status.PUBLISHED,
        )
        other_ticket = EventTicket.generate_ticket(other_event, 'Pooja Karki', 'pooja@test.com')

        # Scan other_ticket at self.event gate
        res = self.client.post(f'/api/events/{self.event.id}/gate/scan/', data={
            'qr_token': other_ticket.qr_token,
            'scan_type': 'gate_in',
            'gate_name': 'Main Gate'
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['result'], 'wrong_event')
        self.assertIn('Biratnagar Music Festival', res.data['message'])

    def test_gate_scan_token_normalization_json(self):
        """Scanners encoding QR payload as JSON are normalized and validated."""
        self.client.logout()
        ticket = EventTicket.generate_ticket(self.event, 'Anil Thapa', 'anil@test.com')
        json_payload = json.dumps({'qr_token': ticket.qr_token, 'ticket_number': ticket.ticket_number})

        res = self.client.post(f'/api/events/{self.event.id}/gate/scan/', data={
            'qr_token': json_payload,
            'scan_type': 'gate_in',
            'gate_name': 'West Gate'
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['result'], 'success')
        self.assertEqual(res.data['attendee_name'], 'Anil Thapa')

    def test_gate_scan_cancelled_event_rejected(self):
        """Cancelled events reject gate scans."""
        self.client.logout()
        ticket = EventTicket.generate_ticket(self.event, 'Karan Rai', 'karan@test.com')
        self.event.status = Event.Status.CANCELLED
        self.event.save()

        res = self.client.post(f'/api/events/{self.event.id}/gate/scan/', data={
            'qr_token': ticket.qr_token,
            'scan_type': 'gate_in',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['result'], 'cancelled')
        self.assertIn('CANCELLED', res.data['message'])

    def test_gate_scan_cancelled_ticket_rejected(self):
        """Revoked or cancelled tickets are rejected."""
        self.client.logout()
        ticket = EventTicket.generate_ticket(self.event, 'Deepak KC', 'deepak@test.com')
        ticket.status = EventTicket.Status.CANCELLED
        ticket.save()

        res = self.client.post(f'/api/events/{self.event.id}/gate/scan/', data={
            'qr_token': ticket.qr_token,
            'scan_type': 'gate_in',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['result'], 'cancelled')
        self.assertIn('cancelled or revoked', res.data['message'])

    def test_gate_scan_expired_event_rejected(self):
        """Scanning tickets for events that ended in the past is rejected."""
        self.client.logout()
        past_event = Event.objects.create(
            organizer=self.organizer,
            title='Old Meetup 2024',
            slug='old-meetup-2024',
            location='Dharan',
            start_date=self.today - timedelta(days=30),
            end_date=self.today - timedelta(days=29),
            status=Event.Status.COMPLETED,
        )
        ticket = EventTicket.generate_ticket(past_event, 'Past Attendee', 'past@test.com')

        res = self.client.post(f'/api/events/{past_event.id}/gate/scan/', data={
            'qr_token': ticket.qr_token,
            'scan_type': 'gate_in',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['result'], 'expired')
        self.assertIn('Concluded', res.data['message'])
