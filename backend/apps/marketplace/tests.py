from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import VenueInquiry, VenueListing, VenueSpace

User = get_user_model()


def make_venue(owner, name, slug, **extra):
    data = dict(
        owner=owner, name=name, slug=slug, city='Dharan', address='Main Road',
        contact_person='Ram', contact_phone='9800000000', description='Hall',
        capacity_min=50, capacity_max=500, price_per_day=30000,
        listing_status='approved',
    )
    data.update(extra)
    return VenueListing.objects.create(**data)


class VenueSlugLookupTests(APITestCase):
    def setUp(self):
        owner = User.objects.create_user(username='owner', email='owner@x.com', password='password123')
        make_venue(owner, 'Hall A', 'hall-a')
        make_venue(owner, 'Hall B', 'hall-b')

    def test_filter_by_slug_is_public(self):
        res = self.client.get('/api/marketplace/venues/', {'slug': 'hall-b'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual([v['slug'] for v in res.json()], ['hall-b'])

    def test_unknown_slug_returns_empty_list(self):
        res = self.client.get('/api/marketplace/venues/', {'slug': 'missing'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), [])


class VenueSpaceTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username='owner', email='owner@x.com', password='password123')
        self.other = User.objects.create_user(username='other', email='other@x.com', password='password123')
        self.admin = User.objects.create_user(username='admin', email='admin@x.com', password='password123', role='superadmin')
        self.venue = make_venue(self.owner, 'Royal Palace', 'royal-palace')
        self.other_venue = make_venue(self.other, 'Other Hall', 'other-hall')
        self.url = f'/api/marketplace/venues/{self.venue.id}/spaces/'

    def space_payload(self, **extra):
        data = {'name': 'Sagarmatha Hall', 'space_type': 'hall', 'capacity_seated': 600, 'price_per_day': '120000'}
        data.update(extra)
        return data

    def test_owner_can_add_edit_and_delete_spaces(self):
        self.client.force_authenticate(self.owner)
        res = self.client.post(self.url, self.space_payload(), format='json')
        self.assertEqual(res.status_code, 201, res.content)
        space_id = res.json()['id']

        res = self.client.patch(f'{self.url}{space_id}/', {'name': 'Sagarmatha Grand Hall', 'order': 3}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(VenueSpace.objects.get(id=space_id).name, 'Sagarmatha Grand Hall')

        res = self.client.delete(f'{self.url}{space_id}/')
        self.assertEqual(res.status_code, 204)
        self.assertFalse(VenueSpace.objects.filter(id=space_id).exists())

    def test_spaces_list_is_public_and_hides_inactive(self):
        VenueSpace.objects.create(venue=self.venue, name='Open', capacity_seated=100, price_per_day=1000)
        VenueSpace.objects.create(venue=self.venue, name='Closed', capacity_seated=100, price_per_day=1000, is_active=False)
        res = self.client.get(self.url)
        self.assertEqual(res.status_code, 200)
        self.assertEqual([s['name'] for s in res.json()], ['Open'])

    def test_non_owner_cannot_change_spaces(self):
        space = VenueSpace.objects.create(venue=self.venue, name='Hall A', capacity_seated=100, price_per_day=1000)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(self.url, self.space_payload(), format='json').status_code, 403)
        self.assertEqual(self.client.patch(f'{self.url}{space.id}/', {'name': 'x'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'{self.url}{space.id}/').status_code, 403)

    def test_anonymous_cannot_add_spaces(self):
        self.assertIn(self.client.post(self.url, self.space_payload(), format='json').status_code, (401, 403))

    def test_superadmin_can_add_spaces(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(self.url, self.space_payload(), format='json').status_code, 201)

    def test_space_needs_a_capacity(self):
        self.client.force_authenticate(self.owner)
        res = self.client.post(self.url, self.space_payload(capacity_seated=0), format='json')
        self.assertEqual(res.status_code, 400)

    def test_inquiry_with_space_from_another_venue_is_rejected(self):
        foreign = VenueSpace.objects.create(venue=self.other_venue, name='Foreign', capacity_seated=100, price_per_day=1000)
        own = VenueSpace.objects.create(venue=self.venue, name='Own', capacity_seated=100, price_per_day=1000)
        payload = {
            'sender_name': 'Asha', 'sender_email': 'asha@x.com', 'sender_phone': '9800000000',
            'event_type': 'Wedding', 'event_date': '2030-01-01', 'guest_count': 100, 'message': 'Hi',
        }
        inquiries_url = f'/api/marketplace/venues/{self.venue.id}/inquiries/'
        res = self.client.post(inquiries_url, {**payload, 'space': str(foreign.id)}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('space', res.json())

        res = self.client.post(inquiries_url, {**payload, 'space': str(own.id)}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(VenueInquiry.objects.get(id=res.json()['id']).space, own)

    def test_venue_capacity_and_price_derive_from_spaces(self):
        VenueSpace.objects.create(venue=self.venue, name='Small', capacity_seated=200, price_per_day=40000)
        VenueSpace.objects.create(venue=self.venue, name='Lawn', capacity_seated=0, capacity_standing=800, price_per_day=90000)
        VenueSpace.objects.create(venue=self.venue, name='Big', capacity_seated=600, price_per_day=120000)
        data = self.client.get(f'/api/marketplace/venues/{self.venue.id}/').json()
        self.assertEqual((data['capacity_min'], data['capacity_max']), (200, 800))
        self.assertEqual(float(data['price_from']), 40000)
        self.assertEqual(len(data['spaces']), 3)

    def test_venue_without_spaces_keeps_its_own_fields(self):
        data = self.client.get(f'/api/marketplace/venues/{self.other_venue.id}/').json()
        self.assertEqual((data['capacity_min'], data['capacity_max']), (50, 500))
        self.assertEqual(float(data['price_from']), 30000)
        self.assertEqual(data['spaces'], [])


class VenueListingPermissionTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username='owner', email='owner@x.com', password='password123', role='vendor')
        self.other = User.objects.create_user(username='other', email='other@x.com', password='password123')
        self.venue = make_venue(self.owner, 'Royal Palace', 'royal-palace')
        self.url = f'/api/marketplace/venues/{self.venue.id}/'

    def test_owner_cannot_set_trust_fields(self):
        self.client.force_authenticate(self.owner)
        res = self.client.patch(self.url, {'is_verified': True, 'is_featured': True, 'rating': '5.00', 'review_count': 999, 'name': 'Renamed'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.venue.refresh_from_db()
        self.assertEqual(self.venue.name, 'Renamed')
        self.assertFalse(self.venue.is_verified)
        self.assertFalse(self.venue.is_featured)
        self.assertEqual(self.venue.review_count, 0)

    def test_non_owner_cannot_edit_or_delete_venue(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.patch(self.url, {'name': 'Hijacked'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(self.url).status_code, 403)

    def test_create_generates_slug(self):
        self.client.force_authenticate(self.owner)
        res = self.client.post('/api/marketplace/venues/', {
            'name': 'New Hall', 'city': 'Itahari', 'address': 'Road', 'contact_person': 'Ram',
            'contact_phone': '9800000000', 'description': 'Nice', 'is_verified': True,
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()['slug'], 'new-hall')
        self.assertFalse(res.json()['is_verified'])
