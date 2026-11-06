"""Server-visible HTML, link previews (Open Graph), JSON-LD, robots.txt, sitemaps and llms.txt."""
import io
import json
import os
import re
import shutil
import tempfile
from datetime import date, time, timedelta

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image

from apps.accounts import modules, tenancy
from apps.accounts.models import PlatformModule, TenantBranding
from apps.blog.models import Post
from apps.events.models import Event, TicketType
from apps.marketplace.models import ListingStatus, VendorCategory, VendorProfile, VenueListing
from apps.platform.models import WhiteLabelRequest

from . import html as html_mod
from .pages import human_when

User = get_user_model()

SHELL = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Eventlaya — Registration, passes and gate check-in</title>
    <meta name="description" content="Old default description." />
    <meta property="og:title" content="Old" data-seo />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index.js"></script>
  </body>
</html>"""

DFF_DOMAIN = 'event.dharanfilmfestival.org'
CRAWLERS = [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'WhatsApp/2.23.20.0 A',
    'Twitterbot/1.0', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', 'Viber/18.0',
    'TelegramBot (like TwitterBot)', 'LinkedInBot/1.0', 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36',
]


def jpeg_bytes(size=(2400, 1600), colour=(10, 120, 200)):
    buf = io.BytesIO()
    Image.new('RGB', size, colour).save(buf, 'JPEG')
    return buf.getvalue()


class SeoBase(TestCase):
    def setUp(self):
        self.media = tempfile.mkdtemp()
        self.dist = tempfile.mkdtemp()
        with open(os.path.join(self.dist, 'index.html'), 'w') as fh:
            fh.write(SHELL)
        self.addCleanup(shutil.rmtree, self.media, True)
        self.addCleanup(shutil.rmtree, self.dist, True)
        overrides = override_settings(MEDIA_ROOT=self.media, FRONTEND_DIST_DIR=self.dist, SEO_SITE_URL='https://eventlaya.com')
        overrides.enable()
        self.addCleanup(overrides.disable)
        html_mod._cache.clear()
        tenancy.clear_cache()
        modules.clear_cache()
        self.addCleanup(tenancy.clear_cache)
        self.addCleanup(modules.clear_cache)
        self.org = User.objects.create_user(username='org', email='org@x.com', password='x', role='organizer',
                                            organization_name='Koshi Events')
        self.day = timezone.localdate() + timedelta(days=10)
        self.event = Event.objects.create(
            organizer=self.org, title='Pathibhara Film Festival 2083', slug='pathibhara-film-festival-2083',
            location='Itahari Convention Hall, Itahari-6', start_date=self.day, start_time=time(17, 0),
            end_time=time(21, 30), status=Event.Status.PUBLISHED, tagline='Short films from the eastern hills',
            description='Three days of short films.', category=Event.Category.FESTIVAL,
        )
        TicketType.objects.create(event=self.event, name='General', price=300, order=1)
        TicketType.objects.create(event=self.event, name='Student', price=150, order=2)
        TicketType.objects.create(event=self.event, name='Secret', price=0, order=3, is_hidden=True)

    # helpers
    def page(self, path, host='eventlaya.com', **extra):
        return self.client.get(path, HTTP_HOST=host, **extra)

    @staticmethod
    def meta(html, attr, key):
        m = re.search(rf'<meta {attr}="{re.escape(key)}" content="([^"]*)"', html)
        return m.group(1).replace('&amp;', '&').replace('&#x27;', "'").replace('&quot;', '"') if m else None

    @staticmethod
    def jsonld(html):
        return [json.loads(m) for m in re.findall(r'<script type="application/ld\+json" data-seo>(.*?)</script>', html, re.S)]

    def of_type(self, html, type_):
        return [n for n in self.jsonld(html) if n['@type'] == type_ or (isinstance(n['@type'], list) and type_ in n['@type'])]


class EventPreviewTests(SeoBase):
    def test_event_page_has_chat_preview_tags(self):
        res = self.page('/e/pathibhara-film-festival-2083')
        self.assertEqual(res.status_code, 200)
        html = res.content.decode()
        when = self.day.strftime('%a %-d %b %Y') + ', 5:00 PM – 9:30 PM'
        self.assertEqual(self.meta(html, 'property', 'og:title'), 'Pathibhara Film Festival 2083')
        self.assertTrue(self.meta(html, 'property', 'og:description').startswith(f'{when} · Itahari Convention Hall, Itahari-6. Short films'))
        self.assertEqual(self.meta(html, 'name', 'description'), self.meta(html, 'property', 'og:description'))
        self.assertEqual(self.meta(html, 'property', 'og:url'), 'https://eventlaya.com/e/pathibhara-film-festival-2083')
        self.assertEqual(self.meta(html, 'property', 'og:site_name'), 'Eventlaya')
        self.assertEqual(self.meta(html, 'name', 'twitter:card'), 'summary_large_image')
        self.assertIn('<title>Pathibhara Film Festival 2083 — ', html)
        self.assertIn('<link rel="canonical" href="https://eventlaya.com/e/pathibhara-film-festival-2083" data-seo>', html)
        # The shell's own defaults are replaced, not duplicated
        self.assertEqual(html.count('<title>'), 1)
        self.assertNotIn('Old default description', html)
        self.assertEqual(html.count('property="og:title"'), 1)
        # Summary for crawlers without JavaScript, and the app still boots for people
        self.assertIn('<noscript>', html)
        self.assertIn('<h1>Pathibhara Film Festival 2083</h1>', html)
        self.assertIn('<script type="module" src="/assets/index.js">', html)

    def test_fallback_card_is_absolute_cached_jpeg(self):
        html = self.page('/e/pathibhara-film-festival-2083').content.decode()
        url = self.meta(html, 'property', 'og:image')
        self.assertRegex(url, r'^https://eventlaya\.com/media/og/events/[0-9a-f-]+-[0-9a-f]{12}\.jpg$')
        self.assertEqual(self.meta(html, 'property', 'og:image:width'), '1200')
        self.assertEqual(self.meta(html, 'property', 'og:image:height'), '630')
        self.assertEqual(self.meta(html, 'property', 'og:image:type'), 'image/jpeg')
        self.assertEqual(self.meta(html, 'property', 'og:image:alt'), 'Pathibhara Film Festival 2083')
        path = url.split('/media/', 1)[1]
        self.assertTrue(default_storage.exists(path))
        self.assertLessEqual(default_storage.size(path), 300 * 1024)
        with default_storage.open(path) as fh:
            self.assertEqual(Image.open(fh).size, (1200, 630))
        # Second request reuses the file
        again = self.meta(self.page('/e/pathibhara-film-festival-2083').content.decode(), 'property', 'og:image')
        self.assertEqual(again, url)

    def test_banner_is_resized_and_regenerated_when_it_changes(self):
        self.event.banner.save('banner.jpg', ContentFile(jpeg_bytes()), save=True)
        first = self.meta(self.page('/e/pathibhara-film-festival-2083').content.decode(), 'property', 'og:image')
        path = first.split('/media/', 1)[1]
        with default_storage.open(path) as fh:
            img = Image.open(fh)
            self.assertEqual(img.size, (1200, 630))
            self.assertEqual(img.getpixel((600, 315))[2] > 150, True)  # it is the (blue) banner, not the pink card
        self.event.banner.save('banner2.jpg', ContentFile(jpeg_bytes(colour=(200, 200, 10))), save=True)
        second = self.meta(self.page('/e/pathibhara-film-festival-2083').content.decode(), 'property', 'og:image')
        self.assertNotEqual(first, second)
        self.assertFalse(default_storage.exists(path))  # old version cleaned up

    def test_cancelled_and_ended_say_so(self):
        self.event.status = Event.Status.CANCELLED
        self.event.save()
        html = self.page('/e/pathibhara-film-festival-2083').content.decode()
        self.assertTrue(self.meta(html, 'property', 'og:description').startswith('Cancelled · '))
        self.assertIn('<title>Cancelled: ', html)
        event = self.of_type(html, 'Event')[0]
        self.assertEqual(event['eventStatus'], 'https://schema.org/EventCancelled')
        self.assertTrue(all(o['availability'] == 'https://schema.org/SoldOut' for o in event['offers']))

        self.event.status = Event.Status.PUBLISHED
        self.event.start_date = self.event.end_date = timezone.localdate() - timedelta(days=3)
        self.event.save()
        html = self.page('/e/pathibhara-film-festival-2083').content.decode()
        self.assertTrue(self.meta(html, 'property', 'og:description').startswith('Ended · '))

    def test_draft_and_unknown_slugs_are_404_without_leaking_details(self):
        self.event.status = Event.Status.DRAFT
        self.event.save()
        for path in ('/e/pathibhara-film-festival-2083', '/e/no-such-event'):
            res = self.page(path)
            self.assertEqual(res.status_code, 404, path)
            self.assertEqual(res['X-Robots-Tag'], 'noindex')
            html = res.content.decode()
            self.assertNotIn('Pathibhara', html)
            self.assertEqual(self.meta(html, 'name', 'robots'), 'noindex,nofollow')
            self.assertEqual(self.meta(html, 'property', 'og:site_name'), 'Eventlaya')
            self.assertEqual(self.meta(html, 'property', 'og:image'), 'https://eventlaya.com/og-default.png')
            self.assertIn('<script type="module"', html)  # the app still shows its "doesn't exist" page

    def test_every_crawler_and_browser_gets_the_same_html(self):
        bodies = {self.page('/e/pathibhara-film-festival-2083/', HTTP_USER_AGENT=ua).content for ua in CRAWLERS}
        self.assertEqual(len(bodies), 1)
        # query strings used to bust preview caches (?v=2) don't change anything
        self.assertEqual(self.page('/e/pathibhara-film-festival-2083?v=2').status_code, 200)

    def test_event_json_ld(self):
        html = self.page('/e/pathibhara-film-festival-2083').content.decode()
        event = self.of_type(html, 'Event')[0]
        self.assertEqual(event['@context'], 'https://schema.org')
        self.assertEqual(event['startDate'], f'{self.day.isoformat()}T17:00:00+05:45')
        self.assertEqual(event['endDate'], f'{self.day.isoformat()}T21:30:00+05:45')
        self.assertEqual(event['eventStatus'], 'https://schema.org/EventScheduled')
        self.assertEqual(event['eventAttendanceMode'], 'https://schema.org/OfflineEventAttendanceMode')
        self.assertEqual(event['location']['@type'], 'Place')
        self.assertEqual(event['location']['address']['addressLocality'], 'Itahari')
        self.assertEqual(event['location']['address']['addressRegion'], 'Koshi Province')
        self.assertEqual(event['location']['address']['addressCountry'], 'NP')
        self.assertEqual(event['organizer'], {'@type': 'Organization', 'name': 'Koshi Events', 'url': 'https://eventlaya.com/'})
        offers = {o['name']: o for o in event['offers']}
        self.assertEqual(set(offers), {'General', 'Student'})  # hidden ticket types stay hidden
        self.assertEqual(offers['General']['price'], '300')
        self.assertEqual(offers['General']['priceCurrency'], 'NPR')
        self.assertEqual(offers['General']['availability'], 'https://schema.org/InStock')
        self.assertEqual(offers['General']['url'], 'https://eventlaya.com/e/pathibhara-film-festival-2083/register')
        self.assertNotIn('aggregateRating', event)
        crumbs = self.of_type(html, 'BreadcrumbList')[0]
        self.assertEqual([i['name'] for i in crumbs['itemListElement']], ['Home', 'Events', 'Pathibhara Film Festival 2083'])

    def test_human_when(self):
        ev = Event(title='x', start_date=date(2026, 11, 14), start_time=time(17, 0))
        self.assertEqual(human_when(ev), 'Sat 14 Nov 2026, 5:00 PM')
        ev.end_date = date(2026, 11, 16)
        self.assertEqual(human_when(ev), 'Sat 14 Nov 2026, 5:00 PM – Mon 16 Nov 2026')
        self.assertEqual(human_when(Event(title='x', start_date=date(2026, 11, 14))), 'Sat 14 Nov 2026')

    def test_events_module_off_hides_event_pages(self):
        PlatformModule.objects.filter(slug='events').update(is_globally_enabled=False)
        modules.clear_cache()
        self.assertEqual(self.page('/e/pathibhara-film-festival-2083').status_code, 404)

    def test_sub_pages_are_plain_app_and_noindex(self):
        res = self.page('/e/pathibhara-film-festival-2083/register')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.meta(res.content.decode(), 'name', 'robots'), 'noindex,nofollow')


class TenantPreviewTests(SeoBase):
    def setUp(self):
        super().setUp()
        WhiteLabelRequest.objects.create(organizer=self.org, brand_name='Dharan Film Festival',
                                         status=WhiteLabelRequest.Status.APPROVED, reviewed_at=timezone.now())
        TenantBranding.objects.create(organizer=self.org, subdomain='dff', custom_domain=DFF_DOMAIN,
                                      brand_name='Dharan Film Festival', is_domain_verified=True, ssl_active=True)
        self.other = User.objects.create_user(username='o2', email='o2@x.com', password='x', role='organizer')
        Event.objects.create(organizer=self.other, title='Other Gig', slug='other-gig', location='Damak',
                             start_date=self.day, status=Event.Status.PUBLISHED)

    def test_tenant_host_uses_brand_and_own_domain(self):
        html = self.page('/e/pathibhara-film-festival-2083', host=DFF_DOMAIN).content.decode()
        self.assertEqual(self.meta(html, 'property', 'og:site_name'), 'Dharan Film Festival')
        self.assertEqual(self.meta(html, 'property', 'og:url'), f'https://{DFF_DOMAIN}/e/pathibhara-film-festival-2083')
        self.assertIn(f'<link rel="canonical" href="https://{DFF_DOMAIN}/e/pathibhara-film-festival-2083"', html)
        self.assertTrue(self.meta(html, 'property', 'og:image').startswith('https://eventlaya.com/media/og/events/'))

    def test_same_event_on_eventlaya_points_to_the_tenant_site(self):
        html = self.page('/e/pathibhara-film-festival-2083').content.decode()
        self.assertEqual(self.meta(html, 'property', 'og:url'), f'https://{DFF_DOMAIN}/e/pathibhara-film-festival-2083')
        # and it is left out of eventlaya.com's sitemap (it's in the tenant's)
        self.assertNotIn('pathibhara', self.page('/sitemaps/events.xml').content.decode())
        tenant_map = self.page('/sitemap.xml', host=DFF_DOMAIN).content.decode()
        self.assertIn(f'https://{DFF_DOMAIN}/e/pathibhara-film-festival-2083', tenant_map)
        self.assertNotIn('other-gig', tenant_map)

    def test_other_organizers_events_and_blog_404_on_tenant(self):
        self.assertEqual(self.page('/e/other-gig', host=DFF_DOMAIN).status_code, 404)
        Post.objects.create(title='Guide', slug='guide', excerpt='x', body='Hello', status=Post.Status.PUBLISHED)
        self.assertEqual(self.page('/blog', host=DFF_DOMAIN).status_code, 404)
        self.assertEqual(self.page('/blog/guide', host=DFF_DOMAIN).status_code, 404)
        self.assertEqual(self.client.get('/api/blog/posts/', HTTP_HOST=DFF_DOMAIN).status_code, 404)
        self.assertEqual(self.page('/llms.txt', host=DFF_DOMAIN).status_code, 404)

    def test_tenant_robots_points_to_tenant_sitemap(self):
        body = self.page('/robots.txt', host=DFF_DOMAIN).content.decode()
        self.assertIn(f'Sitemap: https://{DFF_DOMAIN}/sitemap.xml', body)

    def test_unclaimed_host_is_not_indexable(self):
        with override_settings(PLATFORM_HOSTS=['*']):
            body = self.page('/robots.txt', host='random-site.example.org').content.decode()
            self.assertIn('Disallow: /', body)
            self.assertEqual(self.page('/e/pathibhara-film-festival-2083', host='random-site.example.org').status_code, 404)


class MarketplacePreviewTests(SeoBase):
    def setUp(self):
        super().setUp()
        self.owner = User.objects.create_user(username='v', email='v@x.com', password='x', role='vendor')
        default_storage.save('uploads/venue/1/hall.jpg', ContentFile(jpeg_bytes((1600, 1200))))
        self.venue = VenueListing.objects.create(
            owner=self.owner, name='Koshi Banquet', slug='koshi-banquet', city='Dharan', address='Bhanu Chowk, Dharan-8',
            capacity_min=50, capacity_max=400, price_per_day=40000, contact_person='Ram', contact_phone='9800000000',
            description='Banquet hall with stage and parking.', amenities=['Parking', 'Generator'],
            images=['/media/uploads/venue/1/hall.jpg'], listing_status=ListingStatus.APPROVED,
        )
        cat = VendorCategory.objects.create(name='Photography', slug='photography')
        self.vendor = VendorProfile.objects.create(
            user=self.owner, business_name='Hill Lens Studio', category=cat, city='Itahari', phone='9811111111',
            description='Event photography and video.', starting_price=15000, listing_status=ListingStatus.APPROVED,
        )

    def test_venue_page(self):
        res = self.page('/marketplace/venues/koshi-banquet')
        self.assertEqual(res.status_code, 200)
        html = res.content.decode()
        venue = self.of_type(html, 'EventVenue')[0]
        self.assertEqual(venue['@type'], ['EventVenue', 'LocalBusiness'])
        self.assertEqual(venue['address']['addressLocality'], 'Dharan')
        self.assertEqual(venue['maximumAttendeeCapacity'], 400)
        self.assertEqual(venue['priceRange'], 'From NPR 40,000 per day')
        self.assertNotIn('aggregateRating', venue)  # the listing's built-in rating isn't real review data
        image = self.meta(html, 'property', 'og:image')
        self.assertRegex(image, r'^https://eventlaya\.com/media/og/venues/.+\.jpg$')
        with default_storage.open(image.split('/media/', 1)[1]) as fh:
            self.assertEqual(Image.open(fh).size, (1200, 630))

    def test_vendor_page_and_card_fallback(self):
        html = self.page(f'/marketplace/vendors/{self.vendor.id}').content.decode()
        service = self.of_type(html, 'Service')[0]
        self.assertEqual(service['serviceType'], 'Photography')
        self.assertEqual(service['provider']['@type'], 'LocalBusiness')
        self.assertEqual(service['offers']['price'], '15000')
        self.assertRegex(self.meta(html, 'property', 'og:image'), r'^https://eventlaya\.com/media/og/vendors/.+\.jpg$')

    def test_unapproved_listings_404(self):
        self.venue.listing_status = ListingStatus.PENDING
        self.venue.save()
        self.assertEqual(self.page('/marketplace/venues/koshi-banquet').status_code, 404)
        self.assertNotIn('koshi-banquet', self.page('/sitemaps/marketplace.xml').content.decode())


class BlogPageTests(SeoBase):
    def setUp(self):
        super().setUp()
        self.post = Post.objects.create(
            title='How to organize an event in Itahari', slug='itahari-guide', excerpt='A practical guide.',
            body='Direct answer.\n\n## Why Itahari?\n\nBecause.\n', status=Post.Status.PUBLISHED,
            tags=['itahari'], cities=['Itahari'], category='city-guides',
            faq=[{'q': 'Do I need permission?', 'a': 'Ask the ward office.'}],
        )

    def test_post_page_json_ld_and_full_text(self):
        html = self.page('/blog/itahari-guide').content.decode()
        posting = self.of_type(html, 'BlogPosting')[0]
        self.assertEqual(posting['headline'], 'How to organize an event in Itahari')
        self.assertEqual(posting['mainEntityOfPage']['@id'], 'https://eventlaya.com/blog/itahari-guide')
        self.assertEqual(posting['author']['name'], 'Eventlaya team')
        self.assertIn('datePublished', posting)
        faq = self.of_type(html, 'FAQPage')[0]
        self.assertEqual(faq['mainEntity'][0]['acceptedAnswer']['text'], 'Ask the ward office.')
        self.assertEqual(len(self.of_type(html, 'BreadcrumbList')[0]['itemListElement']), 3)
        self.assertIn('id="why-itahari"', html)  # article body in the HTML
        self.assertEqual(self.meta(html, 'property', 'og:type'), 'article')
        self.assertRegex(self.meta(html, 'property', 'og:image'), r'/media/og/blog/.+\.jpg$')

    def test_prerendered_copy_used_only_while_fresh(self):
        folder = os.path.join(self.dist, 'prerender', 'blog', 'itahari-guide')
        os.makedirs(folder)
        with open(os.path.join(folder, 'index.html'), 'w') as fh:
            fh.write('<html><body>PRERENDERED</body></html>')
        self.assertIn('PRERENDERED', self.page('/blog/itahari-guide').content.decode())
        Post.objects.filter(pk=self.post.pk).update(updated_at=timezone.now() + timedelta(minutes=5))
        self.assertNotIn('PRERENDERED', self.page('/blog/itahari-guide').content.decode())
        # never on a tenant / for 404s
        self.post.status = Post.Status.DRAFT
        self.post.save()
        self.assertEqual(self.page('/blog/itahari-guide').status_code, 404)

    def test_blog_module_off(self):
        PlatformModule.objects.filter(slug='blog').update(is_globally_enabled=False)
        modules.clear_cache()
        self.assertEqual(self.page('/blog').status_code, 404)
        self.assertEqual(self.page('/blog/itahari-guide').status_code, 404)
        self.assertNotIn('blog.xml', self.page('/sitemap.xml').content.decode())
        self.assertEqual(self.page('/sitemaps/blog.xml').status_code, 404)
        self.assertNotIn('/blog/', self.page('/llms.txt').content.decode())

    def test_noindex_post(self):
        self.post.noindex = True
        self.post.save()
        html = self.page('/blog/itahari-guide').content.decode()
        self.assertEqual(self.meta(html, 'name', 'robots'), 'noindex,follow')
        self.assertNotIn('itahari-guide', self.page('/sitemaps/blog.xml').content.decode())


class BlogTranslationTests(SeoBase):
    def setUp(self):
        super().setUp()
        self.en = Post.objects.create(
            title='How to organize an event in Itahari', slug='itahari-guide', excerpt='A practical guide.',
            body='Answer.\n\n## Why Itahari?\n\nBecause.\n', status=Post.Status.PUBLISHED, category='city-guides')
        self.ne = Post.objects.create(
            title='इटहरीमा कार्यक्रम कसरी गर्ने?', slug='itahari-ma-event', excerpt='इटहरीमा कार्यक्रम गर्ने व्यावहारिक गाइड।',
            body='छोटो उत्तर।\n\n## किन इटहरी?\n\nकिनभने।\n', status=Post.Status.PUBLISHED, category='city-guides',
            language='ne', translation_of='itahari-guide', faq=[{'q': 'अनुमति चाहिन्छ?', 'a': 'वडामा सोध्नुहोस्।'}])

    def hreflang(self, html):
        return dict(re.findall(r'<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"', html))

    def test_nepali_post_page(self):
        html = self.page('/blog/itahari-ma-event').content.decode()
        self.assertIn('<html lang="ne">', html)
        self.assertEqual(self.meta(html, 'property', 'og:locale'), 'ne_NP')
        self.assertEqual(self.meta(html, 'property', 'og:locale:alternate'), 'en_US')
        self.assertEqual(self.hreflang(html), {
            'en': 'https://eventlaya.com/blog/itahari-guide', 'ne': 'https://eventlaya.com/blog/itahari-ma-event',
            'x-default': 'https://eventlaya.com/blog/itahari-guide'})
        posting = self.of_type(html, 'BlogPosting')[0]
        self.assertEqual(posting['inLanguage'], 'ne')
        self.assertEqual(posting['translationOfWork']['url'], 'https://eventlaya.com/blog/itahari-guide')
        self.assertIn('प्रायः सोधिने प्रश्नहरू', html)  # crawler summary in Nepali
        self.assertIn('href="/blog/itahari-guide" hreflang="en"', html)

    def test_english_original_links_to_the_translation(self):
        html = self.page('/blog/itahari-guide').content.decode()
        self.assertIn('<html lang="en">', html)
        self.assertEqual(self.meta(html, 'property', 'og:locale'), 'en_US')
        self.assertEqual(set(self.hreflang(html)), {'en', 'ne', 'x-default'})
        posting = self.of_type(html, 'BlogPosting')[0]
        self.assertEqual(posting['inLanguage'], 'en')
        self.assertEqual([w['url'] for w in posting['workTranslation']], ['https://eventlaya.com/blog/itahari-ma-event'])
        self.assertIn('नेपालीमा पढ्नुहोस्', html)
        meta = self.client.get('/api/seo/meta/', {'path': '/blog/itahari-guide'}, HTTP_HOST='eventlaya.com').json()
        self.assertEqual((meta['lang'], meta['locale']), ('en', 'en_US'))
        self.assertEqual(len(meta['alternates']), 3)

    def test_no_hreflang_without_a_live_translation(self):
        self.ne.status = Post.Status.DRAFT
        self.ne.save()
        html = self.page('/blog/itahari-guide').content.decode()
        self.assertEqual(self.hreflang(html), {})
        self.assertIsNone(self.meta(html, 'property', 'og:locale:alternate'))
        self.assertNotIn('workTranslation', html)
        self.assertNotIn('xhtml:link', self.page('/sitemaps/blog.xml').content.decode())

    def test_sitemap_alternates(self):
        xml = self.page('/sitemaps/blog.xml').content.decode()
        self.assertIn('xmlns:xhtml="http://www.w3.org/1999/xhtml"', xml)
        self.assertEqual(xml.count('<xhtml:link rel="alternate" hreflang="ne" href="https://eventlaya.com/blog/itahari-ma-event"/>'), 2)
        self.assertEqual(xml.count('hreflang="x-default" href="https://eventlaya.com/blog/itahari-guide"'), 2)

    def test_translation_makes_the_prerendered_original_stale(self):
        folder = os.path.join(self.dist, 'prerender', 'blog', 'itahari-guide')
        os.makedirs(folder)
        with open(os.path.join(folder, 'index.html'), 'w') as fh:
            fh.write('<html><body>PRERENDERED</body></html>')
        Post.objects.filter(pk=self.ne.pk).update(updated_at=timezone.now() + timedelta(minutes=5))
        self.assertNotIn('PRERENDERED', self.page('/blog/itahari-guide').content.decode())

    def test_llms_txt_marks_nepali_posts(self):
        self.assertIn('(नेपाली / Nepali)', self.page('/llms.txt').content.decode())


class SiteFilesTests(SeoBase):
    def test_robots(self):
        res = self.page('/robots.txt')
        self.assertEqual(res['Content-Type'], 'text/plain; charset=utf-8')
        body = res.content.decode()
        for bot in ('Googlebot', 'Bingbot', 'GPTBot', 'OAI-SearchBot', 'PerplexityBot', 'ClaudeBot', 'Google-Extended'):
            self.assertIn(f'User-agent: {bot}', body)
        for rule in ('Disallow: /app', 'Disallow: /admin', 'Disallow: /api/', 'Disallow: /ticket/',
                     'Allow: /api/events/public/', 'Allow: /api/blog/', 'Allow: /api/seo/'):
            self.assertIn(rule, body)
        self.assertIn('Sitemap: https://eventlaya.com/sitemap.xml', body)

    def test_sitemaps(self):
        Post.objects.create(title='G', slug='g', excerpt='x', body='b', status=Post.Status.PUBLISHED)
        Post.objects.create(title='D', slug='draft-post', excerpt='x', body='b', status=Post.Status.DRAFT)
        Event.objects.create(organizer=self.org, title='Hidden', slug='hidden-draft', location='X',
                             start_date=self.day, status=Event.Status.DRAFT)
        index = self.page('/sitemap.xml').content.decode()
        for section in ('pages', 'events', 'marketplace', 'blog'):
            self.assertIn(f'<loc>https://eventlaya.com/sitemaps/{section}.xml</loc>', index)
        events = self.page('/sitemaps/events.xml').content.decode()
        self.assertIn('https://eventlaya.com/e/pathibhara-film-festival-2083', events)
        self.assertIn('<lastmod>', events)
        self.assertNotIn('hidden-draft', events)
        blog = self.page('/sitemaps/blog.xml').content.decode()
        self.assertIn('https://eventlaya.com/blog/g', blog)
        self.assertNotIn('draft-post', blog)
        self.assertIn('https://eventlaya.com/pricing', self.page('/sitemaps/pages.xml').content.decode())
        self.assertEqual(self.page('/sitemaps/nope.xml').status_code, 404)

    def test_llms_txt(self):
        Post.objects.create(title='QR tickets guide', slug='qr', excerpt='About QR.', body='## Body\n\nFull text here.',
                            status=Post.Status.PUBLISHED)
        body = self.page('/llms.txt').content.decode()
        self.assertTrue(body.startswith('# Eventlaya\n'))
        self.assertIn('[QR tickets guide](https://eventlaya.com/blog/qr)', body)
        self.assertIn('Rs 1,499 per month', body)
        self.assertIn('Koshi Province', body)
        full = self.page('/llms-full.txt').content.decode()
        self.assertIn('Full text here.', full)

    def test_meta_api_for_home(self):
        data = self.client.get('/api/seo/meta/', {'path': '/'}, HTTP_HOST='eventlaya.com').json()
        self.assertEqual(data['canonical'], 'https://eventlaya.com/')
        self.assertEqual(data['status'], 200)
        types = [n['@type'] for n in data['jsonld']]
        self.assertEqual(types, ['Organization', 'WebSite', 'SoftwareApplication'])
        org = data['jsonld'][0]
        self.assertEqual(org['alternateName'], ['इभेन्टलय'])
        self.assertEqual(org['contactPoint'][0]['email'], 'support@eventlaya.com')
        self.assertTrue(any(a['name'] == 'Dharan' for a in org['areaServed']))
        app = data['jsonld'][2]
        self.assertEqual(app['applicationCategory'], 'BusinessApplication')
        self.assertNotIn('aggregateRating', app)
        prices = {o['name']: o['price'] for o in app['offers']}
        self.assertEqual(prices, {'Free': '0', 'Event Pro': '1499', 'Business': '3999'})
        self.assertEqual(data['image'], 'https://eventlaya.com/og-default.png')

    def test_meta_api_private_and_unknown(self):
        self.assertEqual(self.client.get('/api/seo/meta/', {'path': '/app/events'}).json()['robots'], 'noindex,nofollow')
        unknown = self.client.get('/api/seo/meta/', {'path': '/no-such-page'}).json()
        self.assertEqual(unknown['status'], 404)
        self.assertEqual(unknown['robots'], 'noindex,nofollow')
