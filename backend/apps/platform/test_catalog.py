from rest_framework import status

from apps.marketplace.models import VendorCategory, VendorProfile
from .models import City
from .tests import PlatformTestBase

CITIES = '/api/platform/cities/'
CATEGORIES = '/api/marketplace/categories/'


class CityTests(PlatformTestBase):
    def test_seeded_and_public_list_hides_inactive(self):
        self.assertTrue(City.objects.filter(name='Dharan').exists())
        City.objects.filter(name='Damak').update(is_active=False)
        names = [c['name'] for c in self.client.get(CITIES).data]
        self.assertIn('Dharan', names)
        self.assertNotIn('Damak', names)

    def test_superadmin_sees_inactive_with_all(self):
        City.objects.filter(name='Damak').update(is_active=False)
        self.as_(self.admin)
        self.assertIn('Damak', [c['name'] for c in self.client.get(CITIES + '?all=1').data])

    def test_only_superadmin_can_write(self):
        self.as_(self.org)
        self.assertEqual(self.client.post(CITIES, {'name': 'Pokhara'}).status_code, status.HTTP_403_FORBIDDEN)
        self.as_(self.admin)
        r = self.client.post(CITIES, {'name': ' Pokhara ', 'province': 'Gandaki'})
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(r.data['name'], 'Pokhara')
        r = self.client.patch(f"{CITIES}{r.data['id']}/", {'is_active': False})
        self.assertFalse(r.data['is_active'])

    def test_duplicate_name_rejected_case_insensitive(self):
        self.as_(self.admin)
        self.assertEqual(self.client.post(CITIES, {'name': 'dharan'}).status_code, status.HTTP_400_BAD_REQUEST)


class VendorCategoryTests(PlatformTestBase):
    def test_superadmin_crud_and_slug(self):
        self.as_(self.admin)
        r = self.client.post(CATEGORIES, {'name': 'Mehendi Artists', 'icon': 'brush'})
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertEqual(r.data['slug'], 'mehendi-artists')
        url = f"{CATEGORIES}{r.data['id']}/"
        self.assertEqual(self.client.patch(url, {'order': 3}).data['order'], 3)
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_204_NO_CONTENT)

    def test_non_admin_cannot_write(self):
        self.as_(self.org)
        self.assertEqual(self.client.post(CATEGORIES, {'name': 'X'}).status_code, status.HTTP_403_FORBIDDEN)

    def test_inactive_hidden_from_public(self):
        VendorCategory.objects.create(name='Hidden', slug='hidden', is_active=False)
        self.assertNotIn('hidden', [c['slug'] for c in self.client.get(CATEGORIES).data])

    def test_delete_blocked_while_vendors_use_it(self):
        cat = VendorCategory.objects.create(name='Sound', slug='sound')
        VendorProfile.objects.create(user=self.org, business_name='Boom', category=cat, phone='1', description='d')
        self.as_(self.admin)
        self.assertEqual(self.client.delete(f'{CATEGORIES}{cat.id}/').status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(VendorCategory.objects.filter(pk=cat.pk).exists())


BANNERS = '/api/platform/banners/'


class BannerTests(PlatformTestBase):
    def test_superadmin_creates_and_public_sees_only_live(self):
        from datetime import timedelta
        from django.utils import timezone
        from .models import Banner
        self.as_(self.admin)
        r = self.client.post(BANNERS, {'image': '/media/uploads/banner/a.jpg', 'title': 'Wedding season', 'link': '/marketplace'}, format='json')
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, getattr(r, 'data', r.content))
        Banner.objects.create(image='/b.jpg', is_active=False)
        Banner.objects.create(image='/c.jpg', ends_at=timezone.now() - timedelta(days=1))
        Banner.objects.create(image='/d.jpg', starts_at=timezone.now() + timedelta(days=1))
        self.client.force_authenticate(None)
        self.assertEqual([b['title'] for b in self.client.get(BANNERS + '?placement=marketplace').data], ['Wedding season'])
        self.as_(self.admin)
        self.assertEqual(len(self.client.get(BANNERS + '?all=1').data), 4)

    def test_unsafe_link_rejected(self):
        self.as_(self.admin)
        r = self.client.post(BANNERS, {'image': '/a.jpg', 'link': 'javascript:alert(1)'})
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_non_admin_cannot_write(self):
        self.as_(self.org)
        self.assertEqual(self.client.post(BANNERS, {'image': '/a.jpg'}).status_code, status.HTTP_403_FORBIDDEN)

    def test_module_off_hides_banners(self):
        from apps.accounts.models import PlatformModule
        from apps.accounts.modules import clear_cache
        PlatformModule.objects.filter(slug='banners').update(is_globally_enabled=False)
        clear_cache()
        self.addCleanup(clear_cache)
        self.assertEqual(self.client.get(BANNERS).status_code, status.HTTP_403_FORBIDDEN)


class ManagedByTests(PlatformTestBase):
    def test_public_page_shows_managed_by_only_when_switched_on(self):
        from apps.events.models import Event
        ev = Event.objects.create(organizer=self.org, title='Fest', slug='fest', location='Dharan', start_date='2030-01-01',
                                  status='published', managed_by='Eastern Events Co.', managed_by_logo='/media/x.png')
        url = '/api/events/public/fest/'
        self.assertIsNone(self.client.get(url).data['event']['managed_by_info'])
        ev.show_managed_by = True
        ev.save()
        self.assertEqual(self.client.get(url).data['event']['managed_by_info'], {'name': 'Eastern Events Co.', 'logo': '/media/x.png', 'label': 'Managed by'})

    def test_organizer_sets_managed_by_and_bad_logo_rejected(self):
        from apps.events.models import Event
        ev = Event.objects.create(organizer=self.org, title='Fest', slug='fest2', location='Dharan', start_date='2030-01-01')
        self.as_(self.org)
        r = self.client.patch(f'/api/events/{ev.id}/', {'managed_by': 'Agency', 'show_managed_by': True}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data['show_managed_by'])
        r = self.client.patch(f'/api/events/{ev.id}/', {'managed_by_logo': 'javascript:x'}, format='json')
        self.assertEqual(r.status_code, 400)


class SiteBrandingTests(PlatformTestBase):
    URL = '/api/platform/site-branding/'

    def test_public_read_superadmin_write(self):
        self.assertEqual(self.client.get(self.URL).data['logo'], '')
        self.as_(self.org)
        self.assertEqual(self.client.patch(self.URL, {'logo': '/media/x.png'}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.as_(self.admin)
        self.assertEqual(self.client.patch(self.URL, {'logo': 'javascript:alert(1)'}, format='json').status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.client.patch(self.URL, {'logo': '/media/x.png'}, format='json').data['logo'], '/media/x.png')
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.URL).data['logo'], '/media/x.png')


class EventCategoryTests(PlatformTestBase):
    URL = '/api/platform/event-categories/'

    def test_seeded_public_and_superadmin_crud(self):
        self.assertIn('concert', [c['slug'] for c in self.client.get(self.URL).data])
        self.as_(self.org)
        self.assertEqual(self.client.post(self.URL, {'name': 'Expo'}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.as_(self.admin)
        r = self.client.post(self.URL, {'name': ' Trade Expo '}, format='json')
        self.assertEqual((r.status_code, r.data['slug']), (status.HTTP_201_CREATED, 'trade-expo'))
        r = self.client.patch(f"{self.URL}{r.data['id']}/", {'name': 'Expo', 'slug': 'changed'}, format='json')
        self.assertEqual((r.data['name'], r.data['slug']), ('Expo', 'trade-expo'))  # slug never changes
        self.assertEqual(self.client.post(self.URL, {'name': 'concert'}, format='json').status_code, status.HTTP_400_BAD_REQUEST)

    def test_delete_blocked_while_events_use_it_and_filter(self):
        from apps.events.models import Event
        from apps.platform.models import EventCategory
        Event.objects.create(organizer=self.org, title='Rock Night', slug='rock', location='Dharan',
                             start_date='2030-01-01', status='published', category='concert')
        Event.objects.create(organizer=self.org, title='Code Jam', slug='jam', location='Dharan',
                             start_date='2030-01-01', status='published', category='hackathon')
        r = self.client.get('/api/events/public/?category=concert')
        self.assertEqual([e['title'] for e in r.data], ['Rock Night'])
        self.assertEqual(r.data[0]['category_name'], 'Concert')
        self.as_(self.admin)
        concert = EventCategory.objects.get(slug='concert')
        self.assertEqual(self.client.delete(f'{self.URL}{concert.id}/').status_code, status.HTTP_409_CONFLICT)
        wedding = EventCategory.objects.get(slug='wedding')
        self.assertEqual(self.client.delete(f'{self.URL}{wedding.id}/').status_code, status.HTTP_204_NO_CONTENT)

    def test_event_must_use_an_active_type(self):
        from apps.platform.models import EventCategory
        EventCategory.objects.filter(slug='sports').update(is_active=False)
        self.as_(self.org)
        body = {'title': 'Match', 'location': 'Dharan', 'start_date': '2030-01-01', 'category': 'sports'}
        self.assertEqual(self.client.post('/api/events/', body, format='json').status_code, status.HTTP_400_BAD_REQUEST)
        body['category'] = 'concert'
        self.assertEqual(self.client.post('/api/events/', body, format='json').status_code, status.HTTP_201_CREATED)


class FeaturedEventTests(PlatformTestBase):
    def test_superadmin_features_event_listed_first(self):
        from apps.events.models import Event
        early = Event.objects.create(organizer=self.org, title='Early', slug='early', location='Dharan',
                                     start_date='2030-01-01', status='published')
        late = Event.objects.create(organizer=self.org, title='Late', slug='late', location='Dharan',
                                    start_date='2030-06-01', status='published')
        url = f'/api/platform/events/{late.id}/feature/'
        self.as_(self.org)
        self.assertEqual(self.client.post(url, {'is_featured': True}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        # Organizers can't feature their own event through the event API either
        self.client.patch(f'/api/events/{early.id}/', {'is_featured': True}, format='json')
        early.refresh_from_db()
        self.assertFalse(early.is_featured)
        self.as_(self.admin)
        self.assertTrue(self.client.post(url, {'is_featured': True}, format='json').data['is_featured'])
        self.assertEqual([e['title'] for e in self.client.get('/api/platform/events/?featured=1').data], ['Late'])
        self.client.force_authenticate(None)
        r = self.client.get('/api/events/public/')
        self.assertEqual([(e['title'], e['is_featured']) for e in r.data], [('Late', True), ('Early', False)])
