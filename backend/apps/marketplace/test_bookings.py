"""Booking management: agreed amount, offline payments, completing, owner cancel, manual bookings, slot presets."""
from django.core import mail

from .booking import today
from .models import AvailabilitySlot, VenueInquiry
from .test_slots import Base, BookingRequestTests, day, slot

B = '/api/marketplace/my/bookings/'


class BookingManagementTests(BookingRequestTests):
    def confirmed(self):
        s = slot(self.venue, d=5, space=self.hall, price=50000)
        self.as_(self.customer)
        self.book_venue(s)
        inquiry = VenueInquiry.objects.get(slot=s)
        self.as_(self.owner)
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(f'/api/marketplace/my/inquiries/{inquiry.id}/confirm/')
        inquiry.refresh_from_db()
        return inquiry

    def test_confirmed_request_is_a_booking_with_payments_and_balance(self):
        b = self.confirmed()
        self.assertEqual(str(b.agreed_amount), '50000.00')  # from the slot price
        rows = self.client.get(B).data
        self.assertEqual([r['id'] for r in rows['results']], [str(b.id)])
        self.assertEqual((rows['results'][0]['payment_state'], rows['totals']['due']), ('unpaid', '50000.00'))
        url = f'{B}venue/{b.id}/'
        self.assertEqual(self.client.post(f'{url}payments/', {'amount': '-5'}, format='json').status_code, 409)
        r = self.client.post(f'{url}payments/', {'amount': '20000', 'method': 'bank', 'note': 'Advance'}, format='json')
        self.assertEqual((r.status_code, r.data['paid'], r.data['balance'], r.data['payment_state']), (201, '20000.00', '30000.00', 'part_paid'))
        pid = r.data['payments'][0]['id']
        r = self.client.patch(url, {'agreed_amount': '45000'}, format='json')
        self.assertEqual(r.data['balance'], '25000.00')
        self.client.post(f'{url}payments/', {'amount': '25000'}, format='json')
        self.assertEqual(self.client.get(url).data['payment_state'], 'paid')
        r = self.client.delete(f'{url}payments/{pid}/')
        self.assertEqual(r.data['balance'], '20000.00')
        # Customer sees the agreed amount and what's paid
        self.as_(self.customer)
        mine = self.client.get('/api/me/inquiries/').data
        item = (mine['results'] if isinstance(mine, dict) else mine)[0]
        self.assertEqual((item['agreed_amount'], item['paid']), ('45000.00', '25000.00'))
        # PDF receipt for the business and the customer (BS dates); not for others
        self.as_(self.owner)
        pdf = self.client.get(f'{url}receipt/')
        self.assertEqual((pdf.status_code, pdf['Content-Type'], pdf.content[:5]), (200, 'application/pdf', b'%PDF-'))
        self.as_(self.customer)
        self.assertEqual(self.client.get(f'/api/me/inquiries/venue/{b.id}/receipt/').status_code, 200)
        self.as_(self.other)
        self.assertEqual(self.client.get(f'/api/me/inquiries/venue/{b.id}/receipt/').status_code, 404)
        # Someone else's booking is not reachable
        self.as_(self.other)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_complete_only_from_the_day_and_owner_cancel_frees_the_slot(self):
        b = self.confirmed()
        url = f'{B}venue/{b.id}/'
        self.assertEqual(self.client.post(f'{url}complete/').status_code, 400)  # booked day is in the future
        with self.captureOnCommitCallbacks(execute=True):
            r = self.client.post(f'{url}cancel/', {'note': 'Hall under repair'}, format='json')
        self.assertEqual(r.data['state'], 'cancelled')
        self.assertEqual(AvailabilitySlot.objects.get(pk=b.slot_id).status, 'open')
        self.assertIn('was cancelled', mail.outbox[-1].subject)
        self.assertIn('Hall under repair', mail.outbox[-1].body)


class ManualBookingTests(Base):
    def test_manual_booking_blocks_the_time_and_refuses_overlaps(self):
        self.as_(self.owner)
        body = {'kind': 'venue', 'listing_id': str(self.venue.id), 'space_id': str(self.hall.id), 'date': str(day(7)),
                'name': 'Ram KC', 'phone': '9811111111', 'agreed_amount': '60000'}
        r = self.client.post(B, body, format='json')
        self.assertEqual((r.status_code, r.data['source'], r.data['start_time']), (201, 'manual', None))  # whole day
        self.assertEqual(AvailabilitySlot.objects.get(date=day(7), venue=self.venue).status, 'booked')
        r = self.client.post(B, {**body, 'start_time': '18:00', 'end_time': '22:00'}, format='json')
        self.assertEqual(r.status_code, 409)  # whole day already booked for the hall
        r = self.client.post(B, {**body, 'space_id': str(self.lawn.id), 'start_time': '18:00', 'end_time': '22:00'}, format='json')
        self.assertEqual(r.status_code, 201)  # another space is free
        open_slot = slot(self.venue, d=8, start='07:00', end='11:00')
        r = self.client.post(B, {**body, 'space_id': '', 'date': str(day(8)), 'start_time': '07:00', 'end_time': '11:00'}, format='json')
        self.assertEqual(r.status_code, 201)  # took the owner's own open slot
        open_slot.refresh_from_db()
        self.assertEqual(open_slot.status, 'booked')
        self.as_(self.other)
        self.assertEqual(self.client.post(B, body, format='json').status_code, 404)

    def test_slot_presets_saved_on_the_listing(self):
        self.as_(self.owner)
        url = f'/api/marketplace/venues/{self.venue.id}/'
        r = self.client.patch(url, {'slot_presets': [{'name': 'Morning', 'start': '07:00', 'end': '11:00'}]}, format='json')
        self.assertEqual((r.status_code, r.data['slot_presets']), (200, [{'name': 'Morning', 'start': '07:00', 'end': '11:00'}]))
        r = self.client.patch(url, {'slot_presets': [{'name': 'Bad', 'start': '11:00', 'end': '07:00'}]}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertLessEqual(today(), day(1))
