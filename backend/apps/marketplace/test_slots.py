"""Availability slots, public availability calendars and booking requests (inquiries with a slot)."""
import datetime
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from rest_framework.test import APITestCase

from apps.accounts.models import FCMToken, PlatformModule
from apps.accounts.modules import clear_cache
from apps.reviews.rules import venue_review_block

from . import notifications
from .booking import today
from .models import (
    AvailabilitySlot, ListingStatus, VendorCategory, VendorInquiry, VendorProfile, VenueInquiry, VenueListing,
    VenueSpace,
)

User = get_user_model()
Slot = AvailabilitySlot


def day(n):
    return today() + datetime.timedelta(days=n)


def make_user(name, **extra):
    return User.objects.create_user(username=name, email=f'{name}@x.com', password='pw-12345678', **extra)


def make_venue(owner, slug, status=ListingStatus.APPROVED, **extra):
    return VenueListing.objects.create(
        owner=owner, name=slug.title(), slug=slug, address='Main Rd', contact_person='Ram', contact_phone='98',
        description='Hall', listing_status=status, price_per_day=50000, **extra)


def make_vendor(owner, name='Lens', status=ListingStatus.APPROVED):
    cat, _ = VendorCategory.objects.get_or_create(name='Photo', slug='photo')
    return VendorProfile.objects.create(user=owner, business_name=name, category=cat, phone='98',
                                        description='Photos', listing_status=status, starting_price=15000)


def slot(listing=None, d=1, start='10:00', end='14:00', **extra):
    key = 'venue' if isinstance(listing, VenueListing) else 'vendor'
    if start is not None:
        start = datetime.time.fromisoformat(start)
        end = datetime.time.fromisoformat(end)
    return Slot.objects.create(**{key: listing}, date=day(d) if isinstance(d, int) else d,
                               start_time=start, end_time=end, **extra)


class Base(APITestCase):
    def setUp(self):
        self.owner = make_user('owner', role='vendor')
        self.other = make_user('rival', role='vendor')
        self.customer = make_user('asha', role='attendee', phone='9811111111')
        self.admin = make_user('admin', role='superadmin')
        self.venue = make_venue(self.owner, 'palace', contact_email='palace@x.com')
        self.hall = VenueSpace.objects.create(venue=self.venue, name='Main Hall', capacity_seated=300, price_per_day=40000)
        self.lawn = VenueSpace.objects.create(venue=self.venue, name='Lawn', capacity_seated=500, price_per_day=30000)
        self.vendor = make_vendor(self.owner)
        self.rival_venue = make_venue(self.other, 'rival-hall')
        notifications.PUSH_IN_THREAD = False
        self.addCleanup(setattr, notifications, 'PUSH_IN_THREAD', True)
        push = mock.patch('apps.core.fcm.send_push_notification', return_value=True)  # tests patch again to inspect
        push.start()
        self.addCleanup(push.stop)

    def as_(self, user):
        self.client.force_authenticate(user)


class OwnerSlotTests(Base):
    url = '/api/marketplace/my/slots/'

    def test_create_timed_and_full_day_slots(self):
        self.as_(self.owner)
        res = self.client.post(self.url, {'venue': str(self.venue.id), 'space': str(self.hall.id), 'date': str(day(5)),
                                          'start_time': '10:00', 'end_time': '14:00', 'note': 'Morning'}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertEqual((data['kind'], data['space_name'], data['start_time'], data['end_time'], data['status']),
                         ('venue', 'Main Hall', '10:00', '14:00', 'open'))
        self.assertIsNone(data['price'])
        self.assertEqual(data['effective_price'], '40000.00')  # falls back to the space price
        self.assertFalse(data['is_full_day'])
        self.assertIsNone(data['request'])
        res = self.client.post(self.url, {'vendor': str(self.vendor.id), 'date': str(day(5)), 'price': '20000'},
                               format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(res.json()['is_full_day'])
        self.assertEqual((res.json()['start_time'], res.json()['effective_price']), (None, '20000.00'))

    def test_validation(self):
        self.as_(self.owner)
        base = {'venue': str(self.venue.id), 'date': str(day(3))}
        cases = [
            {**base, 'vendor': str(self.vendor.id)},
            {'date': str(day(3))},
            {**base, 'start_time': '10:00'},
            {**base, 'start_time': '10:00', 'end_time': '09:00'},
            {**base, 'date': str(day(-1))},
            {**base, 'space': str(VenueSpace.objects.create(venue=self.rival_venue, name='X', capacity_seated=5).id)},
            {'vendor': str(self.vendor.id), 'date': str(day(3)), 'space': str(self.hall.id)},
            {**base, 'status': 'booked'},
        ]
        for payload in cases:
            res = self.client.post(self.url, payload, format='json')
            self.assertEqual(res.status_code, 400, (payload, res.content))
        self.assertFalse(Slot.objects.exists())

    def test_overlap_rules(self):
        self.as_(self.owner)
        post = lambda **kw: self.client.post(self.url, {'venue': str(self.venue.id), 'date': str(day(4)), **kw},
                                             format='json')
        self.assertEqual(post(space=str(self.hall.id), start_time='10:00', end_time='14:00').status_code, 201)
        res = post(space=str(self.hall.id), start_time='13:00', end_time='16:00')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'slot_overlap')
        self.assertEqual(post(space=str(self.hall.id), start_time='14:00', end_time='18:00').status_code, 201)  # adjacent
        self.assertEqual(post(space=str(self.lawn.id), start_time='10:00', end_time='14:00').status_code, 201)  # other space
        self.assertEqual(post(start_time='08:00', end_time='09:00').status_code, 201)  # whole venue, free hour
        self.assertEqual(post(start_time='11:00', end_time='12:00').status_code, 400)  # whole venue vs hall
        self.assertEqual(post(space=str(self.lawn.id)).status_code, 400)  # full day vs lawn slot
        self.assertEqual(self.client.post(self.url, {'venue': str(self.venue.id), 'date': str(day(5))},
                                          format='json').status_code, 201)  # different date is fine

    def test_other_vendors_cannot_see_or_touch_slots(self):
        mine = slot(self.venue)
        self.as_(self.other)
        self.assertEqual(self.client.get(self.url).json()['count'], 0)
        self.assertEqual(self.client.get(self.url, {'venue': str(self.venue.id)}).status_code, 404)
        self.assertEqual(self.client.get(f'{self.url}{mine.id}/').status_code, 404)
        self.assertEqual(self.client.patch(f'{self.url}{mine.id}/', {'note': 'x'}, format='json').status_code, 404)
        self.assertEqual(self.client.delete(f'{self.url}{mine.id}/').status_code, 404)
        res = self.client.post(self.url, {'venue': str(self.venue.id), 'date': str(day(3))}, format='json')
        self.assertEqual(res.status_code, 404)
        res = self.client.post(self.url + 'bulk/', {'vendor': str(self.vendor.id), 'start_date': str(day(1)),
                                                    'end_date': str(day(3))}, format='json')
        self.assertEqual(res.status_code, 404)
        res = self.client.post(self.url + 'block/', {'venue': str(self.venue.id), 'dates': [str(day(2))]}, format='json')
        self.assertEqual(res.status_code, 404)
        # Accounts without marketplace access are refused outright.
        self.as_(self.customer)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_superadmin_manages_any_listing(self):
        mine = slot(self.venue)
        self.as_(self.admin)
        self.assertEqual(self.client.get(self.url, {'venue': str(self.venue.id)}).json()['count'], 1)
        self.assertEqual(self.client.patch(f'{self.url}{mine.id}/', {'note': 'admin'}, format='json').status_code, 200)
        res = self.client.post(self.url, {'venue': str(self.venue.id), 'date': str(day(9))}, format='json')
        self.assertEqual(res.status_code, 201)

    def test_list_filters_and_range(self):
        slot(self.venue, d=1, space=self.hall)
        slot(self.venue, d=2, space=self.lawn)
        slot(self.venue, d=90)
        slot(self.vendor, d=1)
        slot(self.rival_venue, d=1)
        self.as_(self.owner)
        self.assertEqual(self.client.get(self.url).json()['count'], 3)  # default today..+60, all own listings
        self.assertEqual(self.client.get(self.url, {'venue': str(self.venue.id)}).json()['count'], 2)
        self.assertEqual(self.client.get(self.url, {'venue': str(self.venue.id), 'space': str(self.lawn.id)}).json()['count'], 1)
        self.assertEqual(self.client.get(self.url, {'vendor': str(self.vendor.id)}).json()['count'], 1)
        res = self.client.get(self.url, {'venue': str(self.venue.id), 'from': str(day(0)), 'to': str(day(100))})
        self.assertEqual(res.json()['count'], 3)
        self.assertEqual(self.client.get(self.url, {'from': str(day(0)), 'to': str(day(400))}).status_code, 400)
        self.assertEqual(self.client.get(self.url, {'from': 'tomorrow'}).status_code, 400)
        self.assertEqual(self.client.get(self.url, {'status': 'open'}).json()['count'], 3)

    def test_patch_and_delete(self):
        s = slot(self.venue, space=self.hall)
        slot(self.venue, space=self.hall, start='15:00', end='18:00')
        self.as_(self.owner)
        url = f'{self.url}{s.id}/'
        res = self.client.patch(url, {'start_time': '09:00', 'end_time': '13:00', 'price': '45000', 'status': 'blocked'},
                                format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.json()['start_time'], res.json()['price'], res.json()['status']), ('09:00', '45000.00', 'blocked'))
        self.assertEqual(self.client.patch(url, {'end_time': '16:00'}, format='json').status_code, 400)  # overlap
        self.assertEqual(self.client.patch(url, {'status': 'held'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, {'status': 'open'}, format='json').json()['status'], 'open')
        self.assertEqual(self.client.patch(url, {'date': str(day(-2))}, format='json').status_code, 400)
        res = self.client.patch(url, {'start_time': None, 'date': str(day(7))}, format='json')
        self.assertTrue(res.json()['is_full_day'], res.content)
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertFalse(Slot.objects.filter(pk=s.pk).exists())

    def test_held_or_booked_slots_are_locked(self):
        for st in (Slot.Status.HELD, Slot.Status.BOOKED):
            s = slot(self.venue, d=3 if st == 'held' else 4, status=st)
            self.as_(self.owner)
            url = f'{self.url}{s.id}/'
            res = self.client.delete(url)
            self.assertEqual(res.status_code, 409)
            self.assertEqual(res.json()['code'], 'slot_locked')
            self.assertEqual(self.client.patch(url, {'price': '1'}, format='json').status_code, 409)
            self.assertEqual(self.client.patch(url, {'status': 'blocked'}, format='json').status_code, 409)
            self.assertEqual(self.client.patch(url, {'note': 'VIP'}, format='json').status_code, 200)


class BulkAndBlockTests(Base):
    bulk = '/api/marketplace/my/slots/bulk/'
    block = '/api/marketplace/my/slots/block/'

    def test_bulk_weekdays_and_skips(self):
        start = day(1)
        end = start + datetime.timedelta(days=13)
        expected = [start + datetime.timedelta(days=i) for i in range(14)]
        expected = [d for d in expected if d.weekday() in (0, 5)]  # Mondays and Saturdays
        clash = expected[0]
        slot(self.venue, d=clash, space=self.hall, start='12:00', end='13:00')
        self.as_(self.owner)
        res = self.client.post(self.bulk, {
            'venue': str(self.venue.id), 'space': str(self.hall.id), 'start_date': str(start), 'end_date': str(end),
            'weekdays': [0, 5], 'start_time': '10:00', 'end_time': '16:00', 'price': '35000', 'note': 'Day'}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertEqual((data['created'], data['skipped']), (len(expected) - 1, 1))
        self.assertEqual(data['skipped_dates'], [str(clash)])
        self.assertEqual(sorted(s['date'] for s in data['slots']), [str(d) for d in expected[1:]])
        self.assertTrue(all(s['price'] == '35000.00' and s['start_time'] == '10:00' for s in data['slots']))
        # Running it again creates nothing new.
        res = self.client.post(self.bulk, {
            'venue': str(self.venue.id), 'space': str(self.hall.id), 'start_date': str(start), 'end_date': str(end),
            'weekdays': [0, 5], 'start_time': '10:00', 'end_time': '16:00'}, format='json')
        self.assertEqual((res.json()['created'], res.json()['skipped']), (0, len(expected)))

    def test_bulk_every_day_full_day_and_limits(self):
        self.as_(self.owner)
        res = self.client.post(self.bulk, {'vendor': str(self.vendor.id), 'start_date': str(day(0)),
                                           'end_date': str(day(6))}, format='json')
        self.assertEqual(res.json()['created'], 7)
        self.assertTrue(all(s['is_full_day'] for s in res.json()['slots']))
        for payload in (
            {'vendor': str(self.vendor.id), 'start_date': str(day(1)), 'end_date': str(day(400))},
            {'vendor': str(self.vendor.id), 'start_date': str(day(-3)), 'end_date': str(day(1))},
            {'vendor': str(self.vendor.id), 'start_date': str(day(5)), 'end_date': str(day(1))},
            {'vendor': str(self.vendor.id), 'start_date': str(day(1)), 'end_date': str(day(3)), 'weekdays': [7]},
            {'vendor': str(self.vendor.id), 'start_date': str(day(1)), 'end_date': str(day(3)), 'weekdays': []},
        ):
            self.assertEqual(self.client.post(self.bulk, payload, format='json').status_code, 400, payload)

    def test_block_dates(self):
        open_slot = slot(self.venue, d=2, space=self.hall)
        held = slot(self.venue, d=3, space=self.hall, status=Slot.Status.HELD)
        lawn_open = slot(self.venue, d=3, space=self.lawn, start='18:00', end='22:00')
        self.as_(self.owner)
        res = self.client.post(self.block, {'venue': str(self.venue.id), 'space': str(self.hall.id),
                                            'dates': [str(day(1)), str(day(2)), str(day(3))], 'note': 'Puja'},
                               format='json')
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()
        self.assertEqual((data['created'], data['blocked']), (1, 1))
        self.assertEqual(data['skipped'], [{'date': str(day(3)), 'slot_id': str(held.id), 'reason': 'has_booking_request'}])
        new = Slot.objects.get(date=day(1))
        self.assertEqual((new.status, new.is_full_day, new.space_id, new.note), ('blocked', True, self.hall.id, 'Puja'))
        open_slot.refresh_from_db()
        lawn_open.refresh_from_db()
        self.assertEqual((open_slot.status, open_slot.note), ('blocked', 'Puja'))
        self.assertEqual(lawn_open.status, 'open')  # other space untouched
        # Blocking the whole venue also closes the lawn; past dates are refused.
        res = self.client.post(self.block, {'venue': str(self.venue.id), 'dates': [str(day(3))]}, format='json')
        lawn_open.refresh_from_db()
        self.assertEqual((res.json()['blocked'], lawn_open.status), (1, 'blocked'))
        res = self.client.post(self.block, {'venue': str(self.venue.id), 'dates': [str(day(-1))]}, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.post(self.block, {'vendor': str(self.vendor.id), 'dates': [str(day(4))]}, format='json')
        self.assertEqual(res.json()['created'], 1)


class PublicAvailabilityTests(Base):
    def url(self, listing):
        kind = 'venues' if isinstance(listing, VenueListing) else 'vendors'
        return f'/api/marketplace/{kind}/{listing.id}/availability/'

    def test_open_slots_only_by_default_without_private_data(self):
        o = slot(self.venue, d=1, space=self.hall, note='Morning')
        held = slot(self.venue, d=2, status=Slot.Status.HELD, note='Ram wedding')
        VenueInquiry.objects.create(venue=self.venue, slot=held, sender_name='Secret Person', sender_email='s@x.com',
                                    sender_phone='98', event_date=held.date, message='m')
        slot(self.venue, d=3, status=Slot.Status.BOOKED)
        slot(self.venue, d=4, status=Slot.Status.BLOCKED, note='Private')
        slot(self.venue, d=-1)  # past
        slot(self.venue, d=100)  # outside the default 60 days
        res = self.client.get(self.url(self.venue))
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual([s['id'] for s in data['results']], [str(o.id)])
        self.assertEqual((data['results'][0]['price'], data['results'][0]['note'], data['results'][0]['available']),
                         ('40000.00', 'Morning', True))
        res = self.client.get(self.url(self.venue), {'include_unavailable': '1'})
        rows = res.json()['results']
        self.assertEqual([r['status'] for r in rows], ['open', 'held', 'booked', 'blocked'])
        self.assertNotIn('Secret', res.content.decode())
        self.assertNotIn('Ram wedding', res.content.decode())
        self.assertNotIn('Private', res.content.decode())
        for r in rows[1:]:
            self.assertEqual((r['available'], r['price'], r['note']), (False, None, ''))
            self.assertNotIn('request', r)
        self.assertEqual(self.client.get(self.url(self.venue), {'to': str(day(120))}).json()['count'], 2)

    def test_ranges_spaces_and_inactive_spaces(self):
        slot(self.venue, d=1, space=self.hall)
        lawn = slot(self.venue, d=1, space=self.lawn)
        self.assertEqual(self.client.get(self.url(self.venue), {'space': str(self.lawn.id)}).json()['results'][0]['id'],
                         str(lawn.id))
        self.assertEqual(self.client.get(self.url(self.venue), {'from': str(day(0)), 'to': str(day(200))}).status_code, 400)
        res = self.client.get(self.url(self.venue), {'from': str(day(-30))})
        self.assertEqual(res.json()['from'], str(day(0)))  # clamped to today
        self.lawn.is_active = False
        self.lawn.save()
        self.assertEqual(self.client.get(self.url(self.venue)).json()['count'], 1)

    def test_only_approved_listings(self):
        pending = make_venue(self.owner, 'new-hall', status=ListingStatus.PENDING)
        slot(pending, d=1)
        self.as_(self.owner)  # even the owner gets 404 here (they use /my/slots/)
        self.assertEqual(self.client.get(self.url(pending)).status_code, 404)
        pending_vendor = make_vendor(self.owner, 'Draft', status=ListingStatus.PENDING)
        self.assertEqual(self.client.get(self.url(pending_vendor)).status_code, 404)

    def test_vendor_availability(self):
        s = slot(self.vendor, d=2, start=None, end=None)
        res = self.client.get(self.url(self.vendor))
        self.assertEqual(res.json()['results'][0]['id'], str(s.id))
        self.assertEqual((res.json()['results'][0]['is_full_day'], res.json()['results'][0]['price']), (True, '15000.00'))


class BookingRequestTests(Base):
    def venue_inquiry_url(self, venue=None):
        return f'/api/marketplace/venues/{(venue or self.venue).id}/inquiries/'

    def vendor_inquiry_url(self):
        return f'/api/marketplace/vendors/{self.vendor.id}/inquiries/'

    def book_venue(self, s, **extra):
        payload = {'slot_id': str(s.id), 'message': 'Wedding reception', 'guest_count': 250, **extra}
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(self.venue_inquiry_url(), payload, format='json')

    def test_customer_books_a_slot(self):
        s = slot(self.venue, d=10, space=self.hall)
        FCMToken.objects.create(user=self.owner, token='owner-token')
        self.as_(self.customer)
        with mock.patch('apps.core.fcm.send_push_notification', return_value=True) as push:
            res = self.book_venue(s)
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertEqual((data['status'], data['event_date'], data['space'], data['space_name']),
                         ('pending', str(s.date), str(self.hall.id), 'Main Hall'))
        self.assertEqual(data['slot']['id'], str(s.id))
        self.assertEqual((data['slot']['start_time'], data['slot']['price'], data['slot']['status']),
                         ('10:00', '40000.00', 'held'))
        s.refresh_from_db()
        self.assertEqual(s.status, 'held')
        inquiry = VenueInquiry.objects.get()
        self.assertEqual((inquiry.slot_id, inquiry.user_id, inquiry.sender_email), (s.id, self.customer.id, 'asha@x.com'))
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['palace@x.com'])
        self.assertIn('New booking request', mail.outbox[0].subject)
        push.assert_called_once()
        self.assertEqual(push.call_args.args[0], 'owner-token')
        self.assertEqual(push.call_args.args[3]['type'], 'booking_request')
        # The owner sees the request on the slot and on the inquiry list.
        self.as_(self.owner)
        row = self.client.get('/api/marketplace/my/slots/', {'venue': str(self.venue.id)}).json()['results'][0]
        self.assertEqual((row['status'], row['request']['sender_name'], row['request']['id']),
                         ('held', inquiry.sender_name, str(inquiry.id)))
        inq = self.client.get('/api/marketplace/my/inquiries/', {'has_slot': '1'}).json()
        self.assertEqual(inq[0]['slot']['id'], str(s.id))
        # Booking requests are inquiries, so the customer may review the venue.
        self.assertIsNone(venue_review_block(self.customer, self.venue))

    def test_second_request_on_held_slot_conflicts(self):
        s = slot(self.venue, d=10)
        self.as_(self.customer)
        self.assertEqual(self.book_venue(s).status_code, 201)
        self.as_(make_user('bina', phone='9822222222'))
        res = self.book_venue(s)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()['code'], 'slot_unavailable')
        self.assertEqual(VenueInquiry.objects.count(), 1)
        blocked = slot(self.venue, d=11, status=Slot.Status.BLOCKED)
        self.assertEqual(self.book_venue(blocked).status_code, 409)

    def test_race_lost_between_lock_and_claim(self):
        """Even if the slot changes after it was read, the conditional claim refuses it."""
        s = slot(self.venue, d=10)
        self.as_(self.customer)
        real_filter = Slot.objects.filter

        def sneaky_filter(*args, **kwargs):
            if kwargs.get('status') == Slot.Status.OPEN and 'pk' in kwargs:
                Slot.objects.filter(pk=s.pk).update(status=Slot.Status.HELD)  # someone else got there first
            return real_filter(*args, **kwargs)

        with mock.patch.object(Slot.objects, 'filter', side_effect=sneaky_filter):
            res = self.book_venue(s)
        self.assertEqual(res.status_code, 409)
        self.assertFalse(VenueInquiry.objects.exists())

    def test_invalid_slot_requests(self):
        self.as_(self.customer)
        past = slot(self.venue, d=-1)
        self.assertEqual(self.book_venue(past).status_code, 400)
        foreign = slot(self.rival_venue, d=5)
        self.assertEqual(self.book_venue(foreign).status_code, 400)
        hall_slot = slot(self.venue, d=6, space=self.hall)
        res = self.book_venue(hall_slot, space=str(self.lawn.id))
        self.assertEqual(res.status_code, 400)
        self.assertIn('space', res.json())
        vendor_slot = slot(self.vendor, d=6)
        self.assertEqual(self.book_venue(vendor_slot).status_code, 400)
        self.as_(self.owner)  # owners can't book their own listing
        self.assertEqual(self.book_venue(slot(self.venue, d=7)).status_code, 400)
        self.assertFalse(VenueInquiry.objects.exists())
        self.assertEqual(Slot.objects.filter(status='held').count(), 0)

    def test_vendor_booking_takes_date_from_slot_and_guest_can_book(self):
        s = slot(self.vendor, d=8, start='16:00', end='20:00')
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post(self.vendor_inquiry_url(), {
                'slot_id': str(s.id), 'sender_name': 'Guest', 'sender_email': 'g@x.com', 'sender_phone': '98',
                'message': 'Reception shoot'}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual((res.json()['event_date'], res.json()['slot']['end_time']), (str(s.date), '20:00'))
        inquiry = VendorInquiry.objects.get()
        self.assertIsNone(inquiry.user)
        self.assertEqual(mail.outbox[0].to, ['owner@x.com'])  # vendor has no business email -> account email

    def test_legacy_inquiries_unchanged(self):
        self.as_(self.customer)
        res = self.client.post(self.venue_inquiry_url(), {'event_date': '2030-01-01', 'message': 'hi'}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertIsNone(res.json()['slot'])
        self.assertEqual(res.json()['status'], 'pending')
        res = self.client.post(self.venue_inquiry_url(), {'message': 'no date'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('event_date', res.json())
        res = self.client.post(self.vendor_inquiry_url(), {'message': 'Price?'}, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertIsNone(res.json()['event_date'])
        self.assertEqual(len(mail.outbox), 0)  # plain inquiries don't send booking emails
        # The owner can still move plain inquiries through any status.
        self.as_(self.owner)
        inquiry = VenueInquiry.objects.get()
        res = self.client.patch(f'/api/marketplace/my/inquiries/{inquiry.id}/', {'status': 'contacted'}, format='json')
        self.assertEqual(res.json()['status'], 'contacted')

    def test_slot_id_cannot_be_attached_without_reserving(self):
        s = slot(self.venue, d=5)
        inquiry = VenueInquiry.objects.create(venue=self.venue, sender_name='A', sender_email='a@x.com',
                                              sender_phone='1', event_date=day(5), message='m')
        self.as_(self.owner)
        res = self.client.patch(f'/api/marketplace/inquiries/{inquiry.id}/', {'slot_id': str(s.id)}, format='json')
        self.assertEqual(res.status_code, 200)
        inquiry.refresh_from_db()
        self.assertIsNone(inquiry.slot_id)


class DecisionTests(Base):
    def setUp(self):
        super().setUp()
        self.slot = slot(self.venue, d=10, space=self.hall)
        self.as_(self.customer)
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post(f'/api/marketplace/venues/{self.venue.id}/inquiries/',
                                   {'slot_id': str(self.slot.id), 'message': 'Hi'}, format='json')
        self.inquiry = VenueInquiry.objects.get(pk=res.json()['id'])
        FCMToken.objects.create(user=self.customer, token='asha-phone')
        mail.outbox = []

    def decide(self, action, user=None, note=None, kind='inquiries', pk=None):
        self.as_(user or self.owner)
        body = {'note': note} if note is not None else {}
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(f'/api/marketplace/my/{kind}/{pk or self.inquiry.id}/{action}/', body, format='json')

    def test_confirm_books_slot_and_notifies_customer(self):
        with mock.patch('apps.core.fcm.send_push_notification', return_value=True) as push:
            res = self.decide('confirm', note='See you there')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.json()['status'], res.json()['owner_note'], res.json()['slot']['status']),
                         ('booked', 'See you there', 'booked'))
        self.slot.refresh_from_db()
        self.assertEqual(self.slot.status, 'booked')
        self.assertEqual(mail.outbox[0].to, ['asha@x.com'])
        self.assertIn('confirmed', mail.outbox[0].subject)
        self.assertIn('See you there', mail.outbox[0].body)
        self.assertEqual((push.call_args.args[0], push.call_args.args[3]['type']), ('asha-phone', 'booking_confirmed'))
        # Confirming again is a no-op without a second email.
        self.assertEqual(self.decide('confirm').status_code, 200)
        self.assertEqual(len(mail.outbox), 1)

    def test_decline_reopens_slot(self):
        res = self.decide('decline', note='Fully booked by family')
        self.assertEqual(res.json()['status'], 'rejected')
        self.slot.refresh_from_db()
        self.assertEqual(self.slot.status, 'open')
        self.assertIn('declined', mail.outbox[0].subject)
        # The slot can be requested again by someone else.
        self.as_(make_user('bina', phone='9822222222'))
        res = self.client.post(f'/api/marketplace/venues/{self.venue.id}/inquiries/',
                               {'slot_id': str(self.slot.id), 'message': 'Hi'}, format='json')
        self.assertEqual(res.status_code, 201)
        # Re-opening the first (declined) request now fails: the slot is taken.
        self.as_(self.owner)
        res = self.client.patch(f'/api/marketplace/my/inquiries/{self.inquiry.id}/', {'status': 'pending'}, format='json')
        self.assertEqual(res.status_code, 409)
        self.assertEqual(self.decide('confirm').status_code, 409)

    def test_decline_after_confirm_and_patch_statuses_track_slot(self):
        self.decide('confirm')
        url = f'/api/marketplace/my/inquiries/{self.inquiry.id}/'
        self.as_(self.owner)
        self.assertEqual(self.client.patch(url, {'status': 'contacted'}, format='json').status_code, 200)
        self.slot.refresh_from_db()
        self.assertEqual(self.slot.status, 'held')
        with self.captureOnCommitCallbacks(execute=True):
            self.client.patch(url, {'status': 'rejected'}, format='json')
        self.slot.refresh_from_db()
        self.assertEqual(self.slot.status, 'open')
        self.assertIn('declined', mail.outbox[-1].subject)
        # Back to booked while the slot is still free works.
        self.assertEqual(self.client.patch(url, {'status': 'booked'}, format='json').status_code, 200)
        self.slot.refresh_from_db()
        self.assertEqual(self.slot.status, 'booked')

    def test_only_the_owner_decides(self):
        self.assertEqual(self.decide('confirm', user=self.other).status_code, 404)
        self.assertEqual(self.decide('confirm', user=self.customer).status_code, 403)
        self.assertEqual(self.decide('confirm', kind='vendor-inquiries').status_code, 404)  # wrong kind
        self.slot.refresh_from_db()
        self.assertEqual(self.slot.status, 'held')

    def test_vendor_confirm_and_decline(self):
        s = slot(self.vendor, d=12)
        self.as_(self.customer)
        res = self.client.post(f'/api/marketplace/vendors/{self.vendor.id}/inquiries/',
                               {'slot_id': str(s.id), 'message': 'Hi'}, format='json')
        pk = res.json()['id']
        res = self.decide('confirm', kind='vendor-inquiries', pk=pk)
        self.assertEqual((res.status_code, res.json()['status']), (200, 'booked'))
        s.refresh_from_db()
        self.assertEqual(s.status, 'booked')
        res = self.decide('decline', kind='vendor-inquiries', pk=pk)
        s.refresh_from_db()
        self.assertEqual((res.json()['status'], s.status), ('rejected', 'open'))

    def test_notification_failures_never_break_requests(self):
        with mock.patch('apps.marketplace.notifications.send_mail', side_effect=RuntimeError('smtp down')), \
                mock.patch('apps.core.fcm.send_push_notification', side_effect=RuntimeError('fcm down')), \
                self.assertLogs('apps.marketplace.notifications', 'ERROR') as logs:
            res = self.decide('confirm')
        self.assertEqual(len(logs.records), 2)  # one email, one push failure, both swallowed
        self.assertEqual(res.status_code, 200)
        self.slot.refresh_from_db()
        self.assertEqual(self.slot.status, 'booked')


class CustomerCancelTests(Base):
    def setUp(self):
        super().setUp()
        self.slot = slot(self.venue, d=10)
        self.inquiry = VenueInquiry.objects.create(
            venue=self.venue, slot=self.slot, user=self.customer, sender_name='Asha', sender_email='asha@x.com',
            sender_phone='98', event_date=self.slot.date, message='m')
        Slot.objects.filter(pk=self.slot.pk).update(status=Slot.Status.HELD)

    def cancel(self, kind='venue', pk=None, user=None):
        self.as_(user or self.customer)
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(f'/api/me/inquiries/{kind}/{pk or self.inquiry.id}/cancel/')

    def test_cancel_pending_reopens_slot_and_tells_owner(self):
        res = self.cancel()
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.json()['status'], res.json()['can_cancel'], res.json()['slot']['status']),
                         ('cancelled', False, 'open'))
        self.slot.refresh_from_db()
        self.assertEqual(self.slot.status, 'open')
        self.assertIn('cancelled', mail.outbox[0].subject)
        self.assertEqual(mail.outbox[0].to, ['palace@x.com'])  # the venue's contact email
        res = self.cancel()
        self.assertEqual((res.status_code, res.json()['code']), (409, 'cannot_cancel'))
        # The owner can't revive a cancelled request.
        self.as_(self.owner)
        res = self.client.post(f'/api/marketplace/my/inquiries/{self.inquiry.id}/confirm/')
        self.assertEqual((res.status_code, res.json()['code']), (409, 'request_cancelled'))
        res = self.client.patch(f'/api/marketplace/my/inquiries/{self.inquiry.id}/', {'status': 'booked'}, format='json')
        self.assertEqual(res.status_code, 409)

    def test_cancel_confirmed_only_before_the_day(self):
        VenueInquiry.objects.filter(pk=self.inquiry.pk).update(status='booked')
        Slot.objects.filter(pk=self.slot.pk).update(status='booked')
        self.assertEqual(self.cancel().status_code, 200)
        self.slot.refresh_from_db()
        self.assertEqual(self.slot.status, 'open')
        today_slot = slot(self.venue, d=0, start='23:00', end='23:30', status=Slot.Status.BOOKED)
        booked_today = VenueInquiry.objects.create(
            venue=self.venue, slot=today_slot, user=self.customer, sender_name='A', sender_email='a@x.com',
            sender_phone='1', event_date=today_slot.date, message='m', status='booked')
        res = self.cancel(pk=booked_today.id)
        self.assertEqual(res.status_code, 409)
        today_slot.refresh_from_db()
        self.assertEqual(today_slot.status, 'booked')

    def test_cannot_cancel_other_peoples_requests(self):
        self.assertEqual(self.cancel(user=make_user('bina', phone='9822222222')).status_code, 404)
        self.assertEqual(self.cancel(kind='vendor').status_code, 404)
        self.assertEqual(self.cancel(kind='nope').status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(f'/api/me/inquiries/venue/{self.inquiry.id}/cancel/').status_code, 401)

    def test_my_inquiries_show_slot_and_cancel_flag(self):
        legacy = VendorInquiry.objects.create(vendor=self.vendor, user=self.customer, sender_name='A',
                                              sender_email='a@x.com', sender_phone='1', message='hi')
        self.as_(self.customer)
        rows = {r['id']: r for r in self.client.get('/api/me/inquiries/').json()['results']}
        mine = rows[str(self.inquiry.id)]
        self.assertEqual((mine['slot']['id'], mine['slot']['is_full_day'], mine['can_cancel']), (str(self.slot.id), False, True))
        self.assertIsNone(rows[str(legacy.id)]['slot'])
        self.assertTrue(rows[str(legacy.id)]['can_cancel'])
        res = self.cancel(kind='vendor', pk=legacy.id)  # plain inquiries can be withdrawn too
        self.assertEqual(res.json()['status'], 'cancelled')


class ModuleSwitchTests(Base):
    def test_marketplace_off_blocks_slot_and_booking_endpoints(self):
        s = slot(self.venue, d=5)
        inquiry = VenueInquiry.objects.create(venue=self.venue, user=self.customer, sender_name='A',
                                              sender_email='asha@x.com', sender_phone='1', event_date=day(5),
                                              message='m')
        clear_cache()
        PlatformModule.objects.update_or_create(slug='marketplace', defaults={
            'name': 'Marketplace', 'is_globally_enabled': False})
        clear_cache()
        self.addCleanup(clear_cache)

        def login(user):
            token = self.client.post('/api/auth/login/', {'email': user.email, 'password': 'pw-12345678'},
                                     format='json').data['access']
            self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        login(self.owner)
        for method, url in (('get', '/api/marketplace/my/slots/'), ('post', '/api/marketplace/my/slots/bulk/'),
                            ('post', '/api/marketplace/my/slots/block/'),
                            ('post', f'/api/marketplace/my/inquiries/{inquiry.id}/confirm/')):
            res = getattr(self.client, method)(url, {}, format='json')
            self.assertEqual(res.status_code, 403, url)
            self.assertEqual(res.json()['code'], 'module_disabled')
        login(self.customer)
        res = self.client.post(f'/api/me/inquiries/venue/{inquiry.id}/cancel/')
        self.assertEqual((res.status_code, res.json()['code']), (403, 'module_disabled'))
        self.client.credentials()
        res = self.client.get(f'/api/marketplace/venues/{self.venue.id}/availability/')
        self.assertEqual(res.status_code, 403)
        s.refresh_from_db()
        self.assertEqual(s.status, 'open')
