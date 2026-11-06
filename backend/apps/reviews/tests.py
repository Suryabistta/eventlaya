from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import PlatformModule, RoleModulePermission
from apps.accounts.modules import clear_cache
from apps.events.models import Event, EventTicket
from apps.marketplace.models import (
    ListingStatus, VendorCategory, VendorInquiry, VendorProfile, VenueInquiry, VenueListing,
)

from .models import Review

User = get_user_model()


def make_user(email, role='attendee', **kw):
    return User.objects.create_user(username=email, email=email, password='pw-12345678', role=role, **kw)


class ReviewBase(APITestCase):
    def setUp(self):
        clear_cache()
        self.addCleanup(clear_cache)  # module switches are cached outside the test transaction
        self.org = make_user('org@x.com', 'organizer')
        self.vendor_owner = make_user('vend@x.com', 'vendor')
        self.admin = make_user('admin@x.com', 'superadmin')
        self.asha = make_user('asha@x.com', first_name='Asha', last_name='Rai')
        self.bikash = make_user('bikash@x.com')
        self.event = Event.objects.create(
            organizer=self.org, title='Fest', slug='fest', location='Dharan',
            start_date=timezone.localdate() - timedelta(days=2), status=Event.Status.PUBLISHED,
        )
        self.ticket = EventTicket.generate_ticket(self.event, 'Asha', 'asha@x.com', user=self.asha,
                                                  is_attended=True, first_check_in=timezone.now())
        EventTicket.generate_ticket(self.event, 'Bikash', 'bikash@x.com', user=self.bikash)  # never checked in
        cat = VendorCategory.objects.create(name='Sound', slug='sound')
        self.vendor = VendorProfile.objects.create(user=self.vendor_owner, business_name='Loud', category=cat,
                                                   phone='1', description='x', listing_status=ListingStatus.APPROVED)
        self.venue = VenueListing.objects.create(owner=self.vendor_owner, name='Hall', slug='hall', address='x',
                                                 contact_person='x', contact_phone='1', description='x',
                                                 listing_status=ListingStatus.APPROVED, rating='4.80', review_count=12)

    def as_(self, user):
        self.client.force_authenticate(user)

    def post_event_review(self, rating=5, text='Great'):
        return self.client.post('/api/reviews/events/fest/', {'rating': rating, 'text': text}, format='json')


class EventReviewTests(ReviewBase):
    def test_checked_in_attendee_reviews_once_and_edits(self):
        self.as_(self.asha)
        res = self.post_event_review()
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['author']['name'], 'Asha R.')
        self.assertEqual(self.post_event_review().status_code, 409)
        rid = res.data['id']
        res = self.client.patch(f'/api/reviews/{rid}/', {'rating': 3}, format='json')
        self.assertEqual((res.data['rating'], res.data['text']), (3, 'Great'))
        self.assertIsNotNone(res.data['edited_at'])
        self.as_(self.bikash)
        self.assertEqual(self.client.patch(f'/api/reviews/{rid}/', {'rating': 1}, format='json').status_code, 403)

    def test_eligibility(self):
        self.as_(self.bikash)  # ticket but not checked in
        res = self.post_event_review()
        self.assertEqual((res.status_code, res.data['code']), (403, 'not_eligible'))
        self.as_(make_user('nobody@x.com'))
        self.assertEqual(self.post_event_review().status_code, 403)
        self.as_(self.org)
        self.assertEqual(self.post_event_review().status_code, 403)
        self.as_(None)
        self.assertEqual(self.post_event_review().status_code, 401)
        self.as_(self.asha)
        EventTicket.objects.filter(pk=self.ticket.pk).update(status='cancelled')
        self.assertEqual(self.post_event_review().status_code, 403)

    def test_validation(self):
        self.as_(self.asha)
        self.assertEqual(self.post_event_review(rating=6).status_code, 400)
        self.assertEqual(self.post_event_review(rating=0).status_code, 400)
        self.assertEqual(self.post_event_review(text='x' * 1001).status_code, 400)

    def test_public_list_summary_and_viewer(self):
        self.as_(self.asha)
        self.post_event_review(rating=4)
        Review.objects.create(kind='event', event=self.event, author=self.bikash, rating=2)
        self.as_(None)
        data = self.client.get('/api/reviews/events/fest/').data
        self.assertEqual(data['count'], 2)
        self.assertEqual(data['summary']['average'], 3.0)
        self.assertEqual(data['summary']['distribution']['4'], 1)
        self.assertIsNone(data['viewer'])
        self.assertNotIn('hidden_reason', data['results'][0])
        self.assertEqual(data['results'][0]['rating'], 2)  # newest first
        self.as_(self.asha)
        viewer = self.client.get('/api/reviews/events/fest/').data['viewer']
        self.assertFalse(viewer['can_review'])
        self.assertEqual(viewer['my_review']['rating'], 4)
        self.as_(make_user('new@x.com'))
        self.assertIn('ticket', self.client.get('/api/reviews/events/fest/').data['viewer']['reason'])

    def test_organizer_hides_and_replies_vendor_owner_cannot_hide(self):
        self.as_(self.asha)
        rid = self.post_event_review(rating=1, text='Bad').data['id']
        self.as_(self.vendor_owner)
        self.assertEqual(self.client.post(f'/api/reviews/{rid}/hide/', {}, format='json').status_code, 403)
        self.as_(self.org)
        res = self.client.post(f'/api/reviews/{rid}/hide/', {'hidden': True, 'reason': 'abuse'}, format='json')
        self.assertTrue(res.data['is_hidden'])
        self.assertEqual(res.data['hidden_reason'], 'abuse')
        self.as_(None)
        self.assertEqual(self.client.get('/api/reviews/events/fest/').data['count'], 0)
        self.assertEqual(self.client.get(f'/api/reviews/{rid}/').status_code, 404)
        self.as_(self.asha)
        mine = self.client.get('/api/reviews/mine/').data
        self.assertEqual(mine['count'], 1)
        self.assertTrue(mine['results'][0]['is_hidden'])
        self.as_(self.org)
        self.assertEqual(self.client.get('/api/reviews/manage/', {'hidden': '1'}).data['count'], 1)
        res = self.client.post(f'/api/reviews/{rid}/reply/', {'text': 'Sorry!'}, format='json')
        self.assertEqual(res.data['reply']['text'], 'Sorry!')
        res = self.client.post(f'/api/reviews/{rid}/hide/', {'hidden': False}, format='json')
        self.assertFalse(res.data['is_hidden'])
        self.as_(self.admin)
        self.assertEqual(self.client.post(f'/api/reviews/{rid}/hide/', {}, format='json').status_code, 200)

    def test_author_deletes(self):
        self.as_(self.asha)
        rid = self.post_event_review().data['id']
        self.as_(self.org)
        self.assertEqual(self.client.delete(f'/api/reviews/{rid}/').status_code, 403)
        self.as_(self.asha)
        self.assertEqual(self.client.delete(f'/api/reviews/{rid}/').status_code, 204)

    def test_module_switch_with_jwt(self):
        RoleModulePermission.objects.filter(module__slug='reviews', role='attendee').update(is_enabled=False)
        clear_cache()
        token = self.client.post('/api/auth/login/', {'email': 'asha@x.com', 'password': 'pw-12345678'}, format='json').data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        res = self.post_event_review()
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'module_disabled')
        PlatformModule.objects.filter(slug='reviews').update(is_globally_enabled=False)
        clear_cache()
        self.client.credentials()
        self.assertEqual(self.client.get('/api/reviews/events/fest/').status_code, 403)


class ListingReviewTests(ReviewBase):
    def test_vendor_review_needs_inquiry_owner_replies_but_cannot_hide(self):
        self.as_(self.asha)
        url = f'/api/reviews/vendors/{self.vendor.id}/'
        self.assertEqual(self.client.post(url, {'rating': 5}, format='json').status_code, 403)
        res = self.client.post(f'/api/marketplace/vendors/{self.vendor.id}/inquiries/',
                               {'message': 'Need sound', 'sender_phone': '98'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(VendorInquiry.objects.get().user, self.asha)
        res = self.client.post(url, {'rating': 4, 'text': 'Loud indeed'}, format='json')
        self.assertEqual(res.status_code, 201)
        rid = res.data['id']
        self.as_(self.vendor_owner)
        self.assertEqual(self.client.post(f'/api/reviews/{rid}/hide/', {}, format='json').status_code, 403)
        self.assertEqual(self.client.post(f'/api/reviews/{rid}/reply/', {'text': 'Thanks'}, format='json').status_code, 200)
        self.assertEqual(self.client.post(url, {'rating': 5}, format='json').status_code, 403)  # own listing
        self.as_(self.org)
        self.assertEqual(self.client.post(f'/api/reviews/{rid}/reply/', {'text': 'Hi'}, format='json').status_code, 403)
        self.as_(None)
        data = self.client.get(url).data
        self.assertEqual(data['results'][0]['reply']['text'], 'Thanks')
        vendor = self.client.get(f'/api/marketplace/vendors/{self.vendor.id}/').data
        self.assertEqual((vendor['rating'], vendor['review_average'], vendor['review_total']), ('4.00', 4.0, 1))

    def test_venue_review_and_listing_stats(self):
        before = self.client.get(f'/api/marketplace/venues/{self.venue.id}/').data
        self.assertEqual((before['rating'], before['review_count'], before['review_average'], before['review_total']),
                         ('4.80', 12, None, 0))
        VenueInquiry.objects.create(venue=self.venue, user=self.asha, sender_name='A', sender_email='asha@x.com',
                                    sender_phone='1', event_date='2030-01-01', message='hi')
        self.as_(self.asha)
        url = f'/api/reviews/venues/{self.venue.id}/'
        self.assertEqual(self.client.post(url, {'rating': 3}, format='json').status_code, 201)
        self.assertEqual(self.client.post(url, {'rating': 3}, format='json').status_code, 409)
        listing = self.client.get('/api/marketplace/venues/').data
        listing = listing['results'] if isinstance(listing, dict) else listing
        venue = next(v for v in listing if v['id'] == str(self.venue.id))
        self.assertEqual((venue['rating'], venue['review_count'], venue['review_average']), ('3.00', 1, 3.0))

    def test_signed_in_venue_inquiry_stores_user(self):
        self.as_(self.asha)
        res = self.client.post(f'/api/marketplace/venues/{self.venue.id}/inquiries/', {
            'sender_phone': '98', 'event_date': '2030-01-01', 'message': 'Wedding'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        inquiry = VenueInquiry.objects.get()
        self.assertEqual((inquiry.user, inquiry.sender_email, inquiry.sender_name), (self.asha, 'asha@x.com', 'Asha Rai'))

    def test_unapproved_listing_404(self):
        self.vendor.listing_status = ListingStatus.PENDING
        self.vendor.save()
        self.assertEqual(self.client.get(f'/api/reviews/vendors/{self.vendor.id}/').status_code, 404)
