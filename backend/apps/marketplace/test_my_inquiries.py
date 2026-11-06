from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.marketplace.models import (
    ListingStatus, VendorCategory, VendorInquiry, VendorProfile, VenueInquiry, VenueListing,
)

User = get_user_model()


class MyInquiriesTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username='v', email='v@x.com', password='pw-12345678', role='vendor')
        self.asha = User.objects.create_user(username='a', email='a@x.com', password='pw-12345678', role='attendee')
        cat = VendorCategory.objects.create(name='Sound', slug='sound')
        self.vendor = VendorProfile.objects.create(user=self.owner, business_name='Loud', category=cat, phone='1',
                                                   description='x', listing_status=ListingStatus.APPROVED)
        self.venue = VenueListing.objects.create(owner=self.owner, name='Hall', slug='hall', address='x',
                                                 contact_person='x', contact_phone='1', description='x',
                                                 listing_status=ListingStatus.APPROVED)

    def test_lists_both_kinds_for_sender_only(self):
        VenueInquiry.objects.create(venue=self.venue, user=self.asha, sender_name='A', sender_email='a@x.com',
                                    sender_phone='1', event_date='2030-01-01', message='hi')
        VendorInquiry.objects.create(vendor=self.vendor, user=self.asha, sender_name='A', sender_email='a@x.com',
                                     sender_phone='1', message='hi')
        VenueInquiry.objects.create(venue=self.venue, sender_name='G', sender_email='g@x.com',
                                    sender_phone='1', event_date='2030-01-01', message='guest')
        self.client.force_authenticate(self.asha)
        data = self.client.get('/api/me/inquiries/').data
        self.assertEqual(data['count'], 2)
        self.assertEqual([i['kind'] for i in data['results']], ['vendor', 'venue'])
        self.assertTrue(all(i['can_review'] for i in data['results']))
        self.assertEqual(self.client.get('/api/me/inquiries/', {'kind': 'venue'}).data['count'], 1)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get('/api/me/inquiries/').data['count'], 0)

    def test_vendor_owner_sees_and_updates_vendor_inquiries(self):
        res = self.client.post(f'/api/marketplace/vendors/{self.vendor.id}/inquiries/', {
            'sender_name': 'Guest', 'sender_email': 'g@x.com', 'sender_phone': '98', 'message': 'Price?'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertIsNone(VendorInquiry.objects.get().user)
        self.assertEqual(self.client.get(f'/api/marketplace/vendors/{self.vendor.id}/inquiries/').status_code, 403)
        self.client.force_authenticate(self.owner)
        self.assertEqual(len(self.client.get(f'/api/marketplace/vendors/{self.vendor.id}/inquiries/').data), 1)
        rows = self.client.get('/api/marketplace/my/vendor-inquiries/').data
        self.assertEqual(len(rows), 1)
        res = self.client.patch(f"/api/marketplace/my/vendor-inquiries/{rows[0]['id']}/", {'status': 'contacted'}, format='json')
        self.assertEqual(res.data['status'], 'contacted')

    def test_guest_vendor_inquiry_requires_contact(self):
        res = self.client.post(f'/api/marketplace/vendors/{self.vendor.id}/inquiries/', {'message': 'x'}, format='json')
        self.assertEqual(res.status_code, 400)
