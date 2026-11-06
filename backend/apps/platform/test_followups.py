from rest_framework.test import APITestCase

from apps.accounts.models import TenantBranding
from apps.marketplace.models import MarketplaceAccessRequest, VendorCategory, VendorProfile, VenueListing
from .models import WhiteLabelRequest
from .tests import make_user

WL = '/api/platform/white-label/requests/'


class FollowupTests(APITestCase):
    def setUp(self):
        self.admin = make_user('admin@x.com', 'superadmin')
        self.org = make_user('org@x.com', 'organizer', organization_name='Dharan Club')

    def as_(self, u):
        self.client.force_authenticate(user=u)

    def _approved(self):
        req = WhiteLabelRequest.objects.create(organizer=self.org, brand_name='DC', requested_domain='e.dc.com', remove_watermark=True)
        self.as_(self.admin)
        self.client.post(f'{WL}{req.id}/approve/')
        return req

    def test_revoke_white_label(self):
        req = self._approved()
        self.assertEqual(self.client.get(f'{WL}?status=approved').data[0]['tenant']['custom_domain'], 'e.dc.com')
        self.as_(self.org)
        self.assertEqual(self.client.post(f'{WL}{req.id}/revoke/', {'note': 'x'}, format='json').status_code, 403)
        self.as_(self.admin)
        self.assertEqual(self.client.post(f'{WL}{req.id}/revoke/', {}, format='json').status_code, 400)
        res = self.client.post(f'{WL}{req.id}/revoke/', {'note': 'Unpaid'}, format='json')
        self.assertEqual(res.data['status'], 'revoked')
        b = TenantBranding.objects.get(organizer=self.org)
        self.assertIsNone(b.custom_domain)
        self.assertFalse(b.remove_watermark)
        self.assertIsNone(WhiteLabelRequest.approved_for(self.org))
        self.as_(self.org)
        self.assertEqual(self.client.post('/api/auth/tenant-branding/verify-domain/').status_code, 403)

    def test_reopen(self):
        req = WhiteLabelRequest.objects.create(organizer=self.org, brand_name='DC', status='rejected', review_note='no')
        self.as_(self.admin)
        res = self.client.post(f'{WL}{req.id}/reopen/')
        self.assertEqual((res.data['status'], res.data['review_note']), ('pending', ''))
        self.assertEqual(self.client.post(f'{WL}{req.id}/reopen/').status_code, 400)
        other = WhiteLabelRequest.objects.create(organizer=self.org, brand_name='DC2', status='rejected')
        self.assertEqual(self.client.post(f'{WL}{other.id}/reopen/').status_code, 400)  # one pending already

    def test_marketplace_businesses_and_revoke(self):
        self.org.marketplace_access = 'approved'
        self.org.save()
        MarketplaceAccessRequest.objects.create(user=self.org, business_name='Palace', business_type='venue', city='Itahari', status='approved')
        venue = VenueListing.objects.create(owner=self.org, name='Hall', slug='hall', city='Itahari', listing_status='approved')
        vendor = make_user('v@x.com', 'vendor')
        self.as_(self.org)
        self.assertEqual(self.client.get('/api/platform/marketplace-businesses/').status_code, 403)
        self.as_(self.admin)
        rows = {r['email']: r for r in self.client.get('/api/platform/marketplace-businesses/').data}
        self.assertEqual(set(rows), {'org@x.com', 'v@x.com'})
        self.assertEqual(rows['org@x.com']['listings']['live'], 1)
        url = f'/api/platform/marketplace-businesses/{self.org.id}/revoke/'
        self.assertEqual(self.client.post(url, {}, format='json').status_code, 400)
        self.assertEqual(self.client.post(f'/api/platform/marketplace-businesses/{vendor.id}/revoke/', {'note': 'x'}, format='json').status_code, 400)
        res = self.client.post(url, {'note': 'Fake business'}, format='json')
        self.assertEqual(res.data['listings_hidden'], 1)
        self.org.refresh_from_db()
        venue.refresh_from_db()
        self.assertEqual((self.org.marketplace_access, venue.listing_status), ('rejected', 'rejected'))
        self.assertEqual(MarketplaceAccessRequest.objects.get(user=self.org).status, 'rejected')

    def test_unpublish_listing(self):
        cat = VendorCategory.objects.create(name='Sound', slug='sound')
        v = make_user('v@x.com', 'vendor')
        prof = VendorProfile.objects.create(user=v, business_name='Boom', category=cat, listing_status='approved')
        url = f'/api/platform/listings/vendor/{prof.id}/unpublish/'
        self.as_(self.org)
        self.assertEqual(self.client.post(url, {'note': 'x'}, format='json').status_code, 403)
        self.as_(self.admin)
        self.assertEqual(self.client.post(url, {}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url, {'note': 'x', 'to': 'approved'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/platform/listings/boat/' + str(prof.id) + '/unpublish/', {'note': 'x'}, format='json').status_code, 404)
        res = self.client.post(url, {'note': 'Photos are stock images'}, format='json')
        self.assertEqual(res.data['listing_status'], 'pending')
        self.assertEqual(self.client.post(url, {'note': 'again'}, format='json').status_code, 400)
