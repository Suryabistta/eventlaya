from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.marketplace.models import ListingStatus, VendorCategory, VendorProfile
from apps.marketplace.tests import make_venue

User = get_user_model()


class FeaturedListingsTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='sa', email='sa@x.com', password='pw-123456', role='superadmin')
        owner = User.objects.create_user(username='o', email='o@x.com', password='pw-123456')
        self.venue = make_venue(owner, 'Hall A', 'hall-a')
        self.venue.listing_status = ListingStatus.APPROVED
        self.venue.save()
        cat = VendorCategory.objects.create(name='Catering', slug='catering')
        self.vendor = VendorProfile.objects.create(user=owner, business_name='Momo Co', category=cat, phone='9800000000',
                                                   description='x', listing_status=ListingStatus.APPROVED)

    def test_superadmin_features_and_public_lists_filter(self):
        self.client.force_authenticate(self.admin)
        rows = self.client.get('/api/platform/featured-listings/').data
        self.assertEqual({r['kind'] for r in rows}, {'venue', 'vendor'})
        self.assertEqual(self.client.post(f'/api/platform/featured-listings/venue/{self.venue.id}/feature/', {'is_featured': True}, format='json').status_code, 200)
        self.client.post(f'/api/platform/featured-listings/vendor/{self.vendor.id}/feature/', {'is_featured': True}, format='json')
        self.client.force_authenticate(None)
        self.assertEqual([v['slug'] for v in self.client.get('/api/marketplace/venues/', {'featured': '1'}).json()], ['hall-a'])
        self.assertEqual([v['business_name'] for v in self.client.get('/api/marketplace/vendors/', {'featured': '1'}).json()], ['Momo Co'])
        self.client.force_authenticate(self.admin)
        self.client.post(f'/api/platform/featured-listings/venue/{self.venue.id}/feature/', {'is_featured': False}, format='json')
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/marketplace/venues/', {'featured': '1'}).json(), [])

    def test_only_superadmin(self):
        other = User.objects.create_user(username='x', email='x@x.com', password='pw-123456', role='organizer')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get('/api/platform/featured-listings/').status_code, 403)
        self.assertEqual(self.client.post(f'/api/platform/featured-listings/venue/{self.venue.id}/feature/', {'is_featured': True}, format='json').status_code, 403)


class ServiceAreaTests(FeaturedListingsTests):
    def test_city_filter_matches_typed_service_areas(self):
        owner = self.vendor.user
        self.client.force_authenticate(owner)
        r = self.client.patch(f'/api/marketplace/vendors/{self.vendor.id}/', {'service_areas': ['Urlabari', ' urlabari ', 'Jhapa  district']}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['service_areas'], ['Urlabari', 'Jhapa district'])  # tidied, no duplicates
        self.client.force_authenticate(None)
        names = lambda city: [v['business_name'] for v in self.client.get('/api/marketplace/vendors/', {'city': city}).json()]  # noqa: E731
        self.assertEqual(names('urlabari'), ['Momo Co'])
        self.assertEqual(names('Biratnagar'), [])


class HidePriceTests(FeaturedListingsTests):
    def test_public_gets_no_price_owner_still_does(self):
        from apps.marketplace.models import VendorProfile, VenueListing
        VenueListing.objects.filter(pk=self.venue.pk).update(hide_price=True)
        VendorProfile.objects.filter(pk=self.vendor.pk).update(hide_price=True, starting_price=15000)
        venue = self.client.get('/api/marketplace/venues/', {'slug': 'hall-a'}).json()[0]
        self.assertEqual((venue['hide_price'], venue['price_per_day'], venue['price_from']), (True, None, None))
        self.assertIsNone(self.client.get(f'/api/marketplace/vendors/{self.vendor.id}/').json()['starting_price'])
        self.client.force_authenticate(self.vendor.user)
        self.assertEqual(self.client.get(f'/api/marketplace/vendors/{self.vendor.id}/').json()['starting_price'], '15000.00')
