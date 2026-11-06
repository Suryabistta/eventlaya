"""Owner pause on venue listings / vendor profiles: hidden from the directory, no new requests, owner keeps working."""
from apps.accounts.models import PlatformModule
from apps.accounts.modules import clear_cache

from .models import ListingStatus, VendorInquiry, VenueInquiry
from .test_slots import Base, Slot, day, slot


class ListingPauseTests(Base):
    def venue_url(self, venue=None):
        return f'/api/marketplace/venues/{(venue or self.venue).id}/'

    def vendor_url(self, vendor=None):
        return f'/api/marketplace/vendors/{(vendor or self.vendor).id}/'

    def pause(self, url, value=True):
        self.as_(self.owner)
        res = self.client.patch(url, {'is_paused': value}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['is_paused'], value)
        self.client.force_authenticate(None)
        return res

    def test_new_listings_are_not_paused(self):
        self.assertFalse(self.venue.is_paused)
        self.assertFalse(self.vendor.is_paused)
        self.assertFalse(self.client.get(self.venue_url()).json()['is_paused'])
        self.assertFalse(self.client.get(self.vendor_url()).json()['is_paused'])

    def test_owner_pauses_and_resumes_both_kinds(self):
        self.pause(self.venue_url())
        self.pause(self.vendor_url())
        self.venue.refresh_from_db()
        self.vendor.refresh_from_db()
        self.assertTrue(self.venue.is_paused and self.vendor.is_paused)
        self.as_(self.owner)
        mine = self.client.get('/api/marketplace/my/listings/').json()
        self.assertTrue(mine['venues'][0]['is_paused'])
        self.assertTrue(mine['vendor_profiles'][0]['is_paused'])
        self.pause(self.venue_url(), False)
        self.pause(self.vendor_url(), False)
        self.venue.refresh_from_db()
        self.assertFalse(self.venue.is_paused)

    def test_only_owner_can_pause(self):
        self.as_(self.other)
        self.assertEqual(self.client.patch(self.venue_url(), {'is_paused': True}, format='json').status_code, 403)
        self.assertEqual(self.client.patch(self.vendor_url(), {'is_paused': True}, format='json').status_code, 403)
        self.client.force_authenticate(None)
        self.assertIn(self.client.patch(self.venue_url(), {'is_paused': True}, format='json').status_code, (401, 403))
        self.venue.refresh_from_db()
        self.assertFalse(self.venue.is_paused)

    def test_pausing_a_rejected_listing_does_not_resubmit_it(self):
        self.venue.listing_status = ListingStatus.REJECTED
        self.venue.save()
        self.pause(self.venue_url())
        self.venue.refresh_from_db()
        self.assertEqual(self.venue.listing_status, ListingStatus.REJECTED)

    def test_paused_listings_are_hidden_from_public_lists(self):
        self.pause(self.venue_url())
        self.pause(self.vendor_url())
        venues = [v['id'] for v in self.client.get('/api/marketplace/venues/').json()]
        self.assertNotIn(str(self.venue.id), venues)
        self.assertIn(str(self.rival_venue.id), venues)
        self.assertEqual(self.client.get('/api/marketplace/venues/', {'search': 'palace'}).json(), [])
        self.assertNotIn(str(self.vendor.id), [v['id'] for v in self.client.get('/api/marketplace/vendors/').json()])
        photo = next(c for c in self.client.get('/api/marketplace/categories/').json() if c['slug'] == 'photo')
        self.assertEqual(photo['vendors_count'], 0)
        # The owner still finds them in their own lists.
        self.as_(self.owner)
        self.assertEqual(len(self.client.get('/api/marketplace/venues/', {'my_venues': 1}).json()), 1)
        self.assertEqual(len(self.client.get('/api/marketplace/vendors/', {'mine': 1}).json()), 1)

    def test_paused_detail_still_loads_publicly(self):
        self.pause(self.venue_url())
        self.pause(self.vendor_url())
        res = self.client.get(self.venue_url())
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()['is_paused'])
        by_slug = self.client.get('/api/marketplace/venues/', {'slug': 'palace'}).json()
        self.assertEqual([v['is_paused'] for v in by_slug], [True])
        self.assertTrue(self.client.get(self.vendor_url()).json()['is_paused'])

    def test_paused_listing_refuses_inquiries_and_bookings(self):
        venue_slot = slot(self.venue, d=3, space=self.hall)
        vendor_slot = slot(self.vendor, d=3)
        self.pause(self.venue_url())
        self.pause(self.vendor_url())
        self.as_(self.customer)
        cases = [
            (f'{self.venue_url()}inquiries/', {'event_date': str(day(5)), 'message': 'Hi', 'sender_phone': '98'}),
            (f'{self.venue_url()}inquiries/', {'slot_id': str(venue_slot.id), 'message': 'Hi'}),
            (f'{self.vendor_url()}inquiries/', {'message': 'Hi'}),
            (f'{self.vendor_url()}inquiries/', {'slot_id': str(vendor_slot.id), 'message': 'Hi'}),
        ]
        for url, payload in cases:
            res = self.client.post(url, payload, format='json')
            self.assertEqual(res.status_code, 409, (url, payload, res.content))
            self.assertEqual(res.json()['code'], 'listing_paused')
        self.client.force_authenticate(None)  # guests too
        res = self.client.post(f'{self.venue_url()}inquiries/', {
            'event_date': str(day(5)), 'message': 'Hi', 'sender_name': 'G', 'sender_email': 'g@x.com',
            'sender_phone': '98'}, format='json')
        self.assertEqual((res.status_code, res.json()['code']), (409, 'listing_paused'))
        self.assertFalse(VenueInquiry.objects.exists() or VendorInquiry.objects.exists())
        self.assertEqual(set(Slot.objects.values_list('status', flat=True)), {Slot.Status.OPEN})

    def test_paused_availability_is_empty(self):
        slot(self.venue, d=3)
        self.pause(self.venue_url())
        res = self.client.get(f'{self.venue_url()}availability/', {'include_unavailable': 1})
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.json()['paused'], res.json()['count'], res.json()['results']), (True, 0, []))
        self.pause(self.venue_url(), False)
        res = self.client.get(f'{self.venue_url()}availability/')
        self.assertEqual(res.json()['count'], 1)
        self.assertNotIn('paused', res.json())

    def test_existing_requests_and_slots_keep_working_for_owner(self):
        held = slot(self.venue, d=4, space=self.hall)
        self.as_(self.customer)
        res = self.client.post(f'{self.venue_url()}inquiries/', {'slot_id': str(held.id), 'message': 'Hi'},
                               format='json')
        self.assertEqual(res.status_code, 201, res.content)
        inquiry_id = res.json()['id']
        self.pause(self.venue_url())
        self.as_(self.owner)
        res = self.client.post(f'/api/marketplace/my/inquiries/{inquiry_id}/confirm/', {'note': 'See you'},
                               format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['status'], 'booked')
        res = self.client.post('/api/marketplace/my/slots/', {'venue': str(self.venue.id), 'date': str(day(6))},
                               format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(self.client.get('/api/marketplace/my/slots/', {'venue': str(self.venue.id)}).json()['count'], 2)
        self.assertEqual(len(self.client.get('/api/marketplace/my/inquiries/').json()), 1)

    def test_pause_rides_on_the_marketplace_module(self):
        clear_cache()
        PlatformModule.objects.update_or_create(slug='marketplace', defaults={
            'name': 'Marketplace', 'is_globally_enabled': False})
        clear_cache()
        self.addCleanup(clear_cache)
        token = self.client.post('/api/auth/login/', {'email': self.owner.email, 'password': 'pw-12345678'},
                                 format='json').data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        res = self.client.patch(self.venue_url(), {'is_paused': True}, format='json')
        self.assertEqual((res.status_code, res.json()['code']), (403, 'module_disabled'))
        self.venue.refresh_from_db()
        self.assertFalse(self.venue.is_paused)
