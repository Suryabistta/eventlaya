from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.accounts.models import PlatformModule
from apps.accounts.modules import clear_cache
from .models import ListingStatus, VendorCategory, VendorInquiry, VendorProfile

User = get_user_model()
URL = '/api/marketplace/packages/'


class PackageTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username='v', email='v@x.com', password='pw-123456', role='vendor')
        self.other = User.objects.create_user(username='w', email='w@x.com', password='pw-123456', role='vendor')
        cat = VendorCategory.objects.create(name='Sound', slug='sound')
        self.vendor = VendorProfile.objects.create(user=self.owner, business_name='Boom', category=cat, phone='1',
                                                   description='d', listing_status=ListingStatus.APPROVED)
        self.addCleanup(clear_cache)

    def create(self, user=None, **extra):
        self.client.force_authenticate(user or self.owner)
        body = {'vendor': str(self.vendor.id), 'name': 'Gold', 'price': '50000', 'inclusions': ['Stage', ' DJ ', ''], **extra}
        return self.client.post(URL, body, format='json')

    def test_owner_creates_and_public_lists_active(self):
        r = self.create()
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['inclusions'], ['Stage', 'DJ'])
        self.create(name='Hidden', is_active=False)
        self.client.force_authenticate(None)
        self.assertEqual([p['name'] for p in self.client.get(f'{URL}?vendor={self.vendor.id}').data], ['Gold'])

    def test_other_user_cannot_add_or_edit(self):
        self.assertEqual(self.create(user=self.other).status_code, 403)
        pid = self.create().data['id']
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.patch(f'{URL}{pid}/', {'price': '1'}, format='json').status_code, 404)

    def test_pending_listing_hidden_from_public(self):
        self.create()
        self.vendor.listing_status = ListingStatus.PENDING
        self.vendor.save()
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f'{URL}?vendor={self.vendor.id}').data, [])
        self.client.force_authenticate(self.owner)
        self.assertEqual(len(self.client.get(f'{URL}?vendor={self.vendor.id}').data), 1)

    def test_inquiry_can_name_a_package_of_that_vendor_only(self):
        pid = self.create().data['id']
        self.client.force_authenticate(None)
        body = {'sender_name': 'A', 'sender_email': 'a@x.com', 'sender_phone': '98', 'message': 'Hi', 'event_date': '2030-01-01'}
        r = self.client.post(f'/api/marketplace/vendors/{self.vendor.id}/inquiries/', {**body, 'package': pid}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(VendorInquiry.objects.get().package_id is not None, True)
        self.assertEqual(r.data['package_name'], 'Gold')

    def test_module_off(self):
        PlatformModule.objects.filter(slug='packages').update(is_globally_enabled=False)
        clear_cache()
        self.assertEqual(self.client.get(f'{URL}?vendor={self.vendor.id}').status_code, 403)
