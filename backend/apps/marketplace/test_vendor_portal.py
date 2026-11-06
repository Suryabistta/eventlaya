"""Vendor accounts, marketplace access requests, listing approval and the business portal."""
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import MarketplaceAccessRequest, VendorCategory, VendorProfile, VenueInquiry, VenueListing

User = get_user_model()


def make_user(name, **extra):
    return User.objects.create_user(username=name, email=f'{name}@x.com', password='password123', **extra)


def make_venue(owner, slug, status='approved', **extra):
    data = dict(
        owner=owner, name=slug.replace('-', ' ').title(), slug=slug, city='Dharan', address='Main Road',
        contact_person='Ram', contact_phone='9800000000', description='Hall', listing_status=status,
    )
    data.update(extra)
    return VenueListing.objects.create(**data)


def make_vendor(user, name, category, status='approved'):
    return VendorProfile.objects.create(
        user=user, business_name=name, category=category, phone='9800000000',
        description='We do sound', listing_status=status,
    )


def inquiry(venue, name='Asha', status='pending'):
    return VenueInquiry.objects.create(
        venue=venue, sender_name=name, sender_email='a@x.com', sender_phone='9800000000',
        event_date='2030-01-01', message='Hi', status=status,
    )


class SignupTests(APITestCase):
    url = '/api/auth/register/'

    def payload(self, **extra):
        data = {'email': 'new@x.com', 'password': 'password123', 'organization_name': 'Biz', 'terms': True}
        data.update(extra)
        return data

    def test_default_signup_is_organizer_without_marketplace_access(self):
        res = self.client.post(self.url, self.payload(), format='json')
        self.assertEqual(res.status_code, 201, res.content)
        user = User.objects.get(email='new@x.com')
        self.assertEqual((user.role, user.marketplace_access), ('organizer', 'none'))
        self.assertEqual(res.json()['marketplace_access'], 'none')

    def vendor_payload(self, **extra):
        return self.payload(**{'account_type': 'vendor', 'phone': '9800000000', 'business_type': 'sound_stage', 'city': 'Dharan', **extra})

    def test_vendor_signup_gets_vendor_role_and_access(self):
        res = self.client.post(self.url, self.vendor_payload(), format='json')
        self.assertEqual(res.status_code, 201, res.content)
        user = User.objects.get(email='new@x.com')
        self.assertEqual((user.role, user.marketplace_access), ('vendor', 'approved'))
        self.assertEqual((user.business_type, user.city), ('sound_stage', 'Dharan'))

    def test_vendor_signup_needs_phone_and_business_type(self):
        res = self.client.post(self.url, self.payload(account_type='vendor'), format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(set(res.json()), {'phone', 'business_type'})
        res = self.client.post(self.url, self.vendor_payload(business_type='spaceship'), format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('business_type', res.json())

    def test_duplicate_email_is_reported_on_email_field(self):
        make_user('taken')
        res = self.client.post(self.url, self.payload(email='TAKEN@x.com'), format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['email'], ['An account with this email already exists.'])

    def test_email_available(self):
        make_user('taken')
        url = '/api/auth/email-available/'
        self.assertEqual(self.client.get(url, {'email': 'Taken@x.com'}).json(), {'available': False})
        self.assertEqual(self.client.get(url, {'email': 'free@x.com'}).json(), {'available': True})
        self.assertEqual(self.client.get(url, {'email': 'nope'}).status_code, 400)

    def test_signup_cannot_grant_admin_roles(self):
        for value in ('superadmin', 'staff'):
            res = self.client.post(self.url, self.payload(account_type=value, email=f'{value}@x.com'), format='json')
            self.assertEqual(res.status_code, 400)
        res = self.client.post(self.url, self.payload(role='superadmin'), format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(User.objects.get(email='new@x.com').role, 'organizer')

    def test_me_and_login_expose_marketplace_access(self):
        make_user('ven', role='vendor', marketplace_access='approved')
        res = self.client.post('/api/auth/login/', {'email': 'ven@x.com', 'password': 'password123'}, format='json')
        self.assertEqual(res.json()['user']['marketplace_access'], 'approved')
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.json()['access']}")
        me = self.client.get('/api/auth/me/').json()
        self.assertEqual((me['role'], me['marketplace_access']), ('vendor', 'approved'))


class AccessRequestTests(APITestCase):
    url = '/api/marketplace/access-requests/'
    payload = {'business_name': 'Palace', 'business_type': 'venue', 'city': 'Itahari', 'phone': '9800000000'}

    def setUp(self):
        self.organizer = make_user('org')

    def test_organizer_can_request_access(self):
        self.client.force_authenticate(self.organizer)
        res = self.client.post(self.url, self.payload, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.organizer.refresh_from_db()
        self.assertEqual(self.organizer.marketplace_access, 'pending')
        mine = self.client.get(self.url + 'mine/')
        self.assertEqual(mine.status_code, 200)
        self.assertEqual(mine.json()['status'], 'pending')

    def test_duplicate_pending_request_is_refused(self):
        self.client.force_authenticate(self.organizer)
        self.client.post(self.url, self.payload, format='json')
        self.assertEqual(self.client.post(self.url, self.payload, format='json').status_code, 400)

    def test_already_approved_organizer_cannot_request(self):
        self.organizer.marketplace_access = 'approved'
        self.organizer.save()
        self.client.force_authenticate(self.organizer)
        self.assertEqual(self.client.post(self.url, self.payload, format='json').status_code, 400)

    def test_vendor_and_anonymous_cannot_request(self):
        self.assertEqual(self.client.post(self.url, self.payload, format='json').status_code, 401)
        self.client.force_authenticate(make_user('ven', role='vendor', marketplace_access='approved'))
        self.assertEqual(self.client.post(self.url, self.payload, format='json').status_code, 403)

    def test_required_fields(self):
        self.client.force_authenticate(self.organizer)
        res = self.client.post(self.url, {'business_name': 'Palace'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('city', res.json())

    def test_mine_is_404_without_request(self):
        self.client.force_authenticate(self.organizer)
        self.assertEqual(self.client.get(self.url + 'mine/').status_code, 404)


class PublicVisibilityTests(APITestCase):
    def setUp(self):
        self.owner = make_user('owner', role='vendor', marketplace_access='approved')
        self.admin = make_user('admin', role='superadmin')
        self.cat = VendorCategory.objects.create(name='Sound', slug='sound')
        self.live = make_venue(self.owner, 'live-hall')
        self.pending = make_venue(self.owner, 'pending-hall', status='pending')
        self.rejected = make_venue(self.owner, 'rejected-hall', status='rejected')
        self.live_vendor = make_vendor(self.owner, 'Live Sound', self.cat)
        self.pending_vendor = make_vendor(self.owner, 'Pending Sound', self.cat, status='pending')

    def slugs(self, **params):
        return sorted(v['slug'] for v in self.client.get('/api/marketplace/venues/', params).json())

    def test_public_lists_only_approved(self):
        self.assertEqual(self.slugs(), ['live-hall'])
        names = [v['business_name'] for v in self.client.get('/api/marketplace/vendors/').json()]
        self.assertEqual(names, ['Live Sound'])
        cats = self.client.get('/api/marketplace/categories/').json()
        self.assertEqual(cats[0]['vendors_count'], 1)

    def test_owner_and_admin_still_see_only_approved_in_public_directory(self):
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.slugs(), ['live-hall'])
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.slugs(), ['live-hall'])

    def test_unapproved_detail_hidden_from_public(self):
        self.assertEqual(self.slugs(slug='pending-hall'), [])
        self.assertEqual(self.client.get(f'/api/marketplace/venues/{self.pending.id}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/marketplace/vendors/{self.pending_vendor.id}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/marketplace/venues/{self.pending.id}/spaces/').status_code, 404)

    def test_owner_and_admin_can_open_unapproved_detail(self):
        for user in (self.owner, self.admin):
            self.client.force_authenticate(user)
            self.assertEqual(self.slugs(slug='pending-hall'), ['pending-hall'])
            res = self.client.get(f'/api/marketplace/venues/{self.pending.id}/')
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()['listing_status'], 'pending')
            self.assertEqual(self.client.get(f'/api/marketplace/vendors/{self.pending_vendor.id}/').status_code, 200)

    def test_inquiry_to_unapproved_venue_is_refused(self):
        res = self.client.post(f'/api/marketplace/venues/{self.pending.id}/inquiries/', {
            'sender_name': 'A', 'sender_email': 'a@x.com', 'sender_phone': '98', 'event_date': '2030-01-01', 'message': 'Hi',
        }, format='json')
        self.assertEqual(res.status_code, 404)


class ListingWriteTests(APITestCase):
    venue_payload = {
        'name': 'New Hall', 'city': 'Itahari', 'address': 'Road', 'contact_person': 'Ram',
        'contact_phone': '9800000000', 'description': 'Nice',
    }

    def setUp(self):
        self.cat = VendorCategory.objects.create(name='Sound', slug='sound')
        self.vendor = make_user('ven', role='vendor', marketplace_access='approved')

    def vendor_payload(self, **extra):
        data = {'business_name': 'Waves', 'category': str(self.cat.id), 'phone': '98', 'description': 'Sound'}
        data.update(extra)
        return data

    def test_organizer_without_access_cannot_create_listings(self):
        self.client.force_authenticate(make_user('org'))
        self.assertEqual(self.client.post('/api/marketplace/venues/', self.venue_payload, format='json').status_code, 403)
        self.assertEqual(self.client.post('/api/marketplace/vendors/', self.vendor_payload(), format='json').status_code, 403)

    def test_approved_organizer_can_create(self):
        self.client.force_authenticate(make_user('palace', marketplace_access='approved'))
        self.assertEqual(self.client.post('/api/marketplace/venues/', self.venue_payload, format='json').status_code, 201)

    def test_new_listings_start_pending_and_status_is_read_only(self):
        self.client.force_authenticate(self.vendor)
        res = self.client.post('/api/marketplace/venues/', {**self.venue_payload, 'listing_status': 'approved'}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()['listing_status'], 'pending')
        res = self.client.post('/api/marketplace/vendors/', self.vendor_payload(listing_status='approved', is_verified=True), format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual((res.json()['listing_status'], res.json()['is_verified']), ('pending', False))
        res = self.client.patch(f"/api/marketplace/vendors/{res.json()['id']}/", {'listing_status': 'approved'}, format='json')
        self.assertEqual(res.json()['listing_status'], 'pending')

    def test_mine_lists_own_vendor_profiles_in_any_status(self):
        make_vendor(self.vendor, 'Mine pending', self.cat, status='pending')
        make_vendor(make_user('other', role='vendor'), 'Theirs', self.cat)
        self.client.force_authenticate(self.vendor)
        names = [v['business_name'] for v in self.client.get('/api/marketplace/vendors/', {'mine': 1}).json()]
        self.assertEqual(names, ['Mine pending'])

    def test_non_owner_cannot_edit_vendor_profile(self):
        profile = make_vendor(self.vendor, 'Waves', self.cat)
        self.client.force_authenticate(make_user('other', role='vendor', marketplace_access='approved'))
        url = f'/api/marketplace/vendors/{profile.id}/'
        self.assertEqual(self.client.patch(url, {'business_name': 'x'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(url).status_code, 403)

    def test_editing_rejected_listing_resubmits_it(self):
        venue = make_venue(self.vendor, 'fix-me', status='rejected', review_note='Add photos')
        profile = make_vendor(self.vendor, 'Waves', self.cat, status='rejected')
        approved = make_venue(self.vendor, 'stays-live')
        self.client.force_authenticate(self.vendor)
        self.client.patch(f'/api/marketplace/venues/{venue.id}/', {'name': 'Fixed'}, format='json')
        self.client.patch(f'/api/marketplace/vendors/{profile.id}/', {'business_name': 'Fixed'}, format='json')
        self.client.patch(f'/api/marketplace/venues/{approved.id}/', {'name': 'Renamed'}, format='json')
        venue.refresh_from_db(); profile.refresh_from_db(); approved.refresh_from_db()
        self.assertEqual((venue.listing_status, profile.listing_status, approved.listing_status),
                         ('pending', 'pending', 'approved'))


class BusinessPortalTests(APITestCase):
    def setUp(self):
        self.cat = VendorCategory.objects.create(name='Sound', slug='sound')
        self.vendor = make_user('ven', role='vendor', marketplace_access='approved')
        self.other = make_user('other', role='vendor', marketplace_access='approved')
        self.venue = make_venue(self.vendor, 'my-hall', status='pending')
        self.other_venue = make_venue(self.other, 'their-hall')
        make_vendor(self.vendor, 'My Sound', self.cat, status='rejected')
        self.mine = inquiry(self.venue, 'Mine')
        self.theirs = inquiry(self.other_venue, 'Theirs')

    def test_my_listings_returns_own_listings_with_status(self):
        self.client.force_authenticate(self.vendor)
        data = self.client.get('/api/marketplace/my/listings/').json()
        self.assertEqual([(v['slug'], v['listing_status']) for v in data['venues']], [('my-hall', 'pending')])
        self.assertEqual([(v['business_name'], v['listing_status']) for v in data['vendor_profiles']],
                         [('My Sound', 'rejected')])

    def test_portal_requires_marketplace_access(self):
        self.assertEqual(self.client.get('/api/marketplace/my/listings/').status_code, 401)
        for access in ('none', 'pending', 'rejected'):
            self.client.force_authenticate(make_user(f'org-{access}', marketplace_access=access))
            self.assertEqual(self.client.get('/api/marketplace/my/listings/').status_code, 403)
            self.assertEqual(self.client.get('/api/marketplace/my/inquiries/').status_code, 403)
        self.client.force_authenticate(make_user('palace', marketplace_access='approved'))
        self.assertEqual(self.client.get('/api/marketplace/my/listings/').status_code, 200)

    def test_my_inquiries_only_for_own_venues(self):
        self.client.force_authenticate(self.vendor)
        names = [i['sender_name'] for i in self.client.get('/api/marketplace/my/inquiries/').json()]
        self.assertEqual(names, ['Mine'])

    def test_owner_updates_inquiry_status(self):
        self.client.force_authenticate(self.vendor)
        res = self.client.patch(f'/api/marketplace/my/inquiries/{self.mine.id}/', {'status': 'contacted'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.mine.refresh_from_db()
        self.assertEqual(self.mine.status, 'contacted')
        contacted = self.client.get('/api/marketplace/my/inquiries/', {'status': 'contacted'}).json()
        self.assertEqual(len(contacted), 1)

    def test_invalid_status_and_foreign_inquiry(self):
        self.client.force_authenticate(self.vendor)
        url = f'/api/marketplace/my/inquiries/{self.mine.id}/'
        self.assertEqual(self.client.patch(url, {'status': 'paid'}, format='json').status_code, 400)
        res = self.client.patch(f'/api/marketplace/my/inquiries/{self.theirs.id}/', {'status': 'booked'}, format='json')
        self.assertEqual(res.status_code, 404)
        self.theirs.refresh_from_db()
        self.assertEqual(self.theirs.status, 'pending')


class PlatformReviewTests(APITestCase):
    def setUp(self):
        self.admin = make_user('admin', role='superadmin')
        self.organizer = make_user('org', marketplace_access='pending')
        self.vendor = make_user('ven', role='vendor', marketplace_access='approved')
        self.cat = VendorCategory.objects.create(name='Sound', slug='sound')
        self.request = MarketplaceAccessRequest.objects.create(
            user=self.organizer, business_name='Palace', business_type='venue', city='Itahari', phone='98',
        )
        self.venue = make_venue(self.vendor, 'new-hall', status='pending')
        self.profile = make_vendor(self.vendor, 'New Sound', self.cat, status='pending')
        make_venue(self.vendor, 'old-hall')

    ADMIN_URLS = [
        ('get', '/api/platform/marketplace-requests/'),
        ('post', '/api/platform/marketplace-requests/{req}/approve/'),
        ('post', '/api/platform/marketplace-requests/{req}/reject/'),
        ('get', '/api/platform/listings/'),
        ('post', '/api/platform/listings/venue/{venue}/approve/'),
        ('post', '/api/platform/listings/vendor/{vendor}/reject/'),
    ]

    def admin_urls(self):
        for method, url in self.ADMIN_URLS:
            yield method, url.format(req=self.request.id, venue=self.venue.id, vendor=self.profile.id)

    def test_admin_endpoints_need_superadmin(self):
        for method, url in self.admin_urls():
            self.client.force_authenticate(None)
            self.assertEqual(getattr(self.client, method)(url, {'note': 'x'}, format='json').status_code, 401, url)
            for user in (self.organizer, self.vendor):
                self.client.force_authenticate(user)
                self.assertEqual(getattr(self.client, method)(url, {'note': 'x'}, format='json').status_code, 403, url)
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, 'pending')

    def test_list_requests_by_status(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(len(self.client.get('/api/platform/marketplace-requests/').json()), 1)
        self.assertEqual(self.client.get('/api/platform/marketplace-requests/', {'status': 'approved'}).json(), [])
        row = self.client.get('/api/platform/marketplace-requests/', {'status': 'all'}).json()[0]
        self.assertEqual((row['user_email'], row['business_type_display']), ('org@x.com', 'Venue or party palace'))

    def test_approve_request_grants_access(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post(f'/api/platform/marketplace-requests/{self.request.id}/approve/', {}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.request.refresh_from_db(); self.organizer.refresh_from_db()
        self.assertEqual((self.request.status, self.request.reviewed_by), ('approved', self.admin))
        self.assertIsNotNone(self.request.reviewed_at)
        self.assertEqual(self.organizer.marketplace_access, 'approved')
        self.assertEqual(self.organizer.role, 'organizer')

    def test_reject_request_needs_note(self):
        self.client.force_authenticate(self.admin)
        url = f'/api/platform/marketplace-requests/{self.request.id}/reject/'
        self.assertEqual(self.client.post(url, {'note': '  '}, format='json').status_code, 400)
        res = self.client.post(url, {'note': 'Add your business registration'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.organizer.refresh_from_db()
        self.assertEqual(self.organizer.marketplace_access, 'rejected')
        # The organizer can then ask again.
        self.client.force_authenticate(self.organizer)
        again = self.client.post('/api/marketplace/access-requests/', {
            'business_name': 'Palace', 'business_type': 'venue', 'city': 'Itahari', 'phone': '98',
        }, format='json')
        self.assertEqual(again.status_code, 201)
        self.assertEqual(self.client.get('/api/marketplace/access-requests/mine/').json()['status'], 'pending')

    def test_unknown_request_is_404(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post('/api/platform/marketplace-requests/00000000-0000-0000-0000-000000000000/approve/')
        self.assertEqual(res.status_code, 404)

    def test_list_listings_by_kind_and_status(self):
        self.client.force_authenticate(self.admin)
        rows = self.client.get('/api/platform/listings/', {'status': 'pending'}).json()
        self.assertEqual(sorted((r['kind'], r['name']) for r in rows), [('vendor', 'New Sound'), ('venue', 'New Hall')])
        rows = self.client.get('/api/platform/listings/', {'status': 'pending', 'kind': 'venue'}).json()
        self.assertEqual([r['kind'] for r in rows], ['venue'])
        self.assertEqual(len(self.client.get('/api/platform/listings/', {'status': 'all'}).json()), 3)

    def test_approve_listing_makes_it_public(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post(f'/api/platform/listings/venue/{self.venue.id}/approve/', {}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.client.force_authenticate(None)
        slugs = [v['slug'] for v in self.client.get('/api/marketplace/venues/').json()]
        self.assertIn('new-hall', slugs)

    def test_reject_listing_needs_note_and_stays_hidden(self):
        self.client.force_authenticate(self.admin)
        url = f'/api/platform/listings/vendor/{self.profile.id}/reject/'
        self.assertEqual(self.client.post(url, {}, format='json').status_code, 400)
        res = self.client.post(url, {'note': 'Add a phone number we can reach'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.profile.refresh_from_db()
        self.assertEqual((self.profile.listing_status, self.profile.review_note),
                         ('rejected', 'Add a phone number we can reach'))
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/marketplace/vendors/').json(), [])

    def test_unknown_kind_or_id_is_404(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(f'/api/platform/listings/event/{self.venue.id}/approve/').status_code, 404)
        # A venue id under the vendor kind does not match anything.
        self.assertEqual(self.client.post(f'/api/platform/listings/vendor/{self.venue.id}/approve/').status_code, 404)
