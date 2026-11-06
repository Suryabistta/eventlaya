from datetime import timedelta
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts import modules
from apps.accounts.models import PlatformModule, RoleModulePermission
from apps.accounts.modules import module_for_path

from .models import LANGUAGES, Post
from .rendering import render_markdown
from .seed import SEED_DIR, parse_seed_file

User = get_user_model()


def post(slug, **kw):
    defaults = dict(title=slug.replace('-', ' ').title(), slug=slug, excerpt='Short description.', body='Text',
                    status=Post.Status.PUBLISHED)
    defaults.update(kw)
    return Post.objects.create(**defaults)


class BlogBase(APITestCase):
    def setUp(self):
        modules.clear_cache()
        self.addCleanup(modules.clear_cache)
        self.admin = User.objects.create_user(username='ad', email='ad@x.com', password='x', role='superadmin')
        self.org = User.objects.create_user(username='org', email='org@x.com', password='x', role='organizer')


class PublicApiTests(BlogBase):
    def test_only_live_posts_are_public(self):
        post('live', cities=['Itahari'], tags=['QR tickets'], category='ticketing')
        post('draft', status=Post.Status.DRAFT)
        post('later', status=Post.Status.SCHEDULED, published_at=timezone.now() + timedelta(days=1))
        post('due', status=Post.Status.SCHEDULED, published_at=timezone.now() - timedelta(minutes=1))
        slugs = {p['slug'] for p in self.client.get('/api/blog/posts/').json()['results']}
        self.assertEqual(slugs, {'live', 'due'})
        self.assertEqual(self.client.get('/api/blog/posts/draft/').status_code, 404)
        self.assertEqual(self.client.get('/api/blog/posts/later/').status_code, 404)
        self.assertEqual(self.client.get('/api/blog/posts/due/').status_code, 200)

    def test_filters(self):
        post('a', cities=['Itahari'], tags=['QR tickets'], category='ticketing', title='QR passes')
        post('b', cities=['Dharan'], tags=['venues'], category='venues', body='Banquet halls')
        get = lambda **q: {p['slug'] for p in self.client.get('/api/blog/posts/', q).json()['results']}  # noqa: E731
        self.assertEqual(get(city='itahari'), {'a'})
        self.assertEqual(get(tag='qr tickets'), {'a'})
        self.assertEqual(get(category='venues'), {'b'})
        self.assertEqual(get(search='banquet'), {'b'})
        topics = self.client.get('/api/blog/topics/').json()
        self.assertEqual({c['name'] for c in topics['cities']}, {'Itahari', 'Dharan'})

    def test_detail_has_body_toc_faq_and_related(self):
        main = post('main', category='guides', tags=['x'], body='Answer.\n\n## First part\n\nText\n\n### Sub\n\nMore',
                    faq=[{'q': 'Q?', 'a': 'A.'}])
        post('same-category', category='guides')
        post('other', category='voting')
        data = self.client.get('/api/blog/posts/main/').json()
        self.assertIn('<h2 id="first-part">First part</h2>', data['body_html'])
        self.assertEqual(data['toc'], [{'id': 'first-part', 'title': 'First part', 'level': 2}, {'id': 'sub', 'title': 'Sub', 'level': 3}])
        self.assertEqual(data['faq'], [{'q': 'Q?', 'a': 'A.'}])
        self.assertEqual(data['related'][0]['slug'], 'same-category')
        self.assertNotIn('body', data)  # Markdown source isn't needed publicly
        self.assertEqual(main.reading_minutes, 1)


class AdminApiTests(BlogBase):
    def test_only_superadmins_edit(self):
        body = {'title': 'New guide', 'body': 'Hi', 'excerpt': 'x'}
        self.assertEqual(self.client.post('/api/blog/admin/posts/', body, format='json').status_code, 401)
        self.client.force_authenticate(self.org)
        self.assertEqual(self.client.post('/api/blog/admin/posts/', body, format='json').status_code, 403)
        self.assertEqual(self.client.get('/api/blog/admin/posts/').status_code, 403)
        self.assertEqual(self.client.post('/api/blog/admin/preview/', {'body': 'x'}, format='json').status_code, 403)
        self.client.force_authenticate(self.admin)
        res = self.client.post('/api/blog/admin/posts/', body, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()['slug'], 'new-guide')
        self.assertEqual(res.json()['status'], 'draft')
        self.assertEqual(Post.objects.get().created_by, self.admin)

    def test_publish_slug_clash_and_schedule(self):
        self.client.force_authenticate(self.admin)
        post('taken')
        res = self.client.post('/api/blog/admin/posts/', {'title': 'X', 'slug': 'taken'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('slug', res.json())
        res = self.client.post('/api/blog/admin/posts/', {'title': 'No description', 'status': 'published'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('excerpt', res.json())
        res = self.client.post('/api/blog/admin/posts/', {'title': 'Later', 'status': 'scheduled'}, format='json')
        self.assertIn('published_at', res.json())
        when = (timezone.now() + timedelta(days=2)).isoformat()
        res = self.client.post('/api/blog/admin/posts/', {'title': 'Later', 'status': 'scheduled', 'published_at': when,
                                                         'excerpt': 'x', 'faq': [{'q': 'Q', 'a': 'A'}]}, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertFalse(res.json()['is_live'])
        pid = res.json()['id']
        res = self.client.patch(f'/api/blog/admin/posts/{pid}/', {'status': 'published', 'published_at': None}, format='json')
        self.assertTrue(res.json()['is_live'])
        self.assertEqual(self.client.delete(f'/api/blog/admin/posts/{pid}/').status_code, 204)

    def test_faq_validation(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post('/api/blog/admin/posts/', {'title': 'T', 'faq': [{'q': 'Only a question'}]}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_preview_is_sanitized(self):
        self.client.force_authenticate(self.admin)
        md = '# Title\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) [ok](/pricing) [ext](https://example.com)\n\n<img src=x onerror=alert(1)>\n\n| a | b |\n|---|---|\n| 1 | 2 |'
        html = self.client.post('/api/blog/admin/preview/', {'body': md}, format='json').json()['html']
        self.assertNotIn('<script', html)
        self.assertNotIn('javascript:', html)
        self.assertNotIn('onerror', html)
        self.assertNotIn('<h1', html)  # the post title is the page's only H1
        self.assertIn('<h2 id="title">Title</h2>', html)
        self.assertIn('<a href="/pricing">ok</a>', html)
        self.assertIn('rel="noopener" target="_blank"', html)
        self.assertIn('<div class="table-wrap"><table>', html)


class ModuleTests(BlogBase):
    def test_module_seeded_and_mapped(self):
        module = PlatformModule.objects.get(slug='blog')
        self.assertTrue(module.is_globally_enabled)
        self.assertEqual(RoleModulePermission.objects.filter(module=module, is_enabled=True).count(), 5)
        self.assertEqual(module_for_path('/api/blog/posts/'), 'blog')
        self.assertEqual(module_for_path('/api/blog/admin/posts/'), 'blog')

    def test_switched_off(self):
        post('live')
        self.assertEqual(self.client.get('/api/blog/status/').json()['enabled'], True)
        PlatformModule.objects.filter(slug='blog').update(is_globally_enabled=False)
        modules.clear_cache()
        for url in ('/api/blog/status/', '/api/blog/posts/', '/api/blog/posts/live/'):
            res = self.client.get(url)
            self.assertEqual(res.status_code, 403, url)
            self.assertEqual(res.json()['code'], 'module_disabled')
        # The platform team can still write while it's off (the module middleware reads the JWT)
        from rest_framework_simplejwt.tokens import AccessToken
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.admin)}')
        self.assertEqual(self.client.get('/api/blog/admin/posts/').status_code, 200)

    def test_switched_off_for_a_role(self):
        post('live')
        RoleModulePermission.objects.filter(module__slug='blog', role='organizer').update(is_enabled=False)
        modules.clear_cache()
        self.client.force_authenticate(self.org)
        # module middleware reads the JWT; force_authenticate sets request.user for the view only, so use a token
        from rest_framework_simplejwt.tokens import AccessToken
        self.client.force_authenticate(None)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.org)}')
        self.assertEqual(self.client.get('/api/blog/posts/').status_code, 403)


class RenderingTests(BlogBase):
    def test_word_count_and_reading_time(self):
        out = render_markdown(' '.join(['word'] * 450))
        self.assertEqual(out['word_count'], 450)
        self.assertEqual(out['reading_minutes'], 3)

    def test_nepali_headings_and_words(self):
        out = render_markdown('## इटहरीमा कार्यक्रम कहिले गर्ने?\n\nमंसिरमा ब्यांक्वेट छिट्टै बुक हुन्छन्। QR पास।\n\n## Why Itahari?\n')
        self.assertEqual([t['id'] for t in out['toc']], ['इटहरीमा-कार्यक्रम-कहिले-गर्ने', 'why-itahari'])
        self.assertIn('id="इटहरीमा-कार्यक्रम-कहिले-गर्ने"', out['html'])
        # vowel signs don't split words: 4 + 7 + 2
        self.assertEqual(out['word_count'], 13)


class TranslationTests(BlogBase):
    def setUp(self):
        super().setUp()
        self.en = post('itahari-guide', category='city-guides', cities=['Itahari'])
        self.ne = post('itahari-ma-event', category='city-guides', cities=['Itahari'], language='ne',
                       translation_of='itahari-guide', title='इटहरीमा कार्यक्रम')
        self.other = post('dharan-guide', category='city-guides', cities=['Dharan'])

    def test_detail_lists_the_other_language(self):
        en = self.client.get('/api/blog/posts/itahari-guide/').json()
        self.assertEqual(en['language'], 'en')
        self.assertEqual(en['translations'], [{'language': 'ne', 'slug': 'itahari-ma-event', 'title': 'इटहरीमा कार्यक्रम'}])
        self.assertNotIn('itahari-ma-event', [p['slug'] for p in en['related']])  # the switch offers it instead
        ne = self.client.get('/api/blog/posts/itahari-ma-event/').json()
        self.assertEqual((ne['language'], ne['translation_of']), ('ne', 'itahari-guide'))
        self.assertEqual([t['slug'] for t in ne['translations']], ['itahari-guide'])
        self.assertEqual(self.client.get('/api/blog/posts/dharan-guide/').json()['translations'], [])

    def test_unpublished_translation_is_not_offered(self):
        self.ne.status = Post.Status.DRAFT
        self.ne.save()
        self.assertEqual(self.client.get('/api/blog/posts/itahari-guide/').json()['translations'], [])

    def test_language_filter_and_topics(self):
        get = lambda **q: {p['slug'] for p in self.client.get('/api/blog/posts/', q).json()['results']}  # noqa: E731
        self.assertEqual(get(lang='ne'), {'itahari-ma-event'})
        self.assertEqual(get(lang='en'), {'itahari-guide', 'dharan-guide'})
        langs = {l['code']: l['count'] for l in self.client.get('/api/blog/topics/').json()['languages']}
        self.assertEqual(langs, {'en': 2, 'ne': 1})

    def test_admin_validates_translation_of(self):
        self.client.force_authenticate(self.admin)
        url = f'/api/blog/admin/posts/{self.ne.id}/'
        self.assertEqual(self.client.patch(url, {'translation_of': 'no-such-post'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, {'translation_of': 'itahari-ma-event'}, format='json').status_code, 400)
        res = self.client.patch(url, {'translation_of': 'dharan-guide', 'language': 'ne'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['translation_of'], 'dharan-guide')
        self.assertEqual(self.client.patch(url, {'language': 'xx'}, format='json').status_code, 400)


class SeedTests(BlogBase):
    def test_seed_files_are_complete(self):
        files = sorted(SEED_DIR.glob('*.md'))
        self.assertGreaterEqual(len(files), 10)
        slugs = set()
        for f in files:
            data = parse_seed_file(f)
            slugs.add(data['slug'])
            self.assertTrue(data['title'] and data['excerpt'], f)
            self.assertLessEqual(len(data['excerpt']), 170, f)
            self.assertLessEqual(len(data['seo_title']), 65, f)
            self.assertIn(data['category'], Post.Category.values, f)
            self.assertGreaterEqual(len(data['faq']), 3, f)
            rendered = render_markdown(data['body'])
            self.assertGreaterEqual(rendered['word_count'], 700, f)
            self.assertGreaterEqual(len(rendered['toc']), 3, f)
            self.assertNotIn('<h1', rendered['html'])
        self.assertEqual(len(slugs), len(files))
        # internal links to other guides point at real slugs
        import re
        for f in files:
            for link in re.findall(r'\]\(/blog/([a-z0-9-]+)\)', f.read_text()):
                self.assertIn(link, slugs, f'{f.name} links to /blog/{link}')
        # translations: a known language, pointing at an existing post in another language
        by_slug = {d['slug']: d for d in map(parse_seed_file, files)}
        for d in by_slug.values():
            self.assertIn(d['language'], dict(LANGUAGES), d['slug'])
            if d['translation_of']:
                self.assertIn(d['translation_of'], by_slug, d['slug'])
                self.assertNotEqual(by_slug[d['translation_of']]['language'], d['language'], d['slug'])

    def test_seed_command_is_idempotent_and_keeps_edits(self):
        out = StringIO()
        call_command('seed_blog', stdout=out)
        count = Post.objects.count()
        self.assertGreaterEqual(count, 10)
        self.assertTrue(all(p.is_live and p.author_name == 'Eventlaya team' for p in Post.objects.all()))
        Post.objects.filter(slug='what-is-eventlaya').update(title='Edited')
        call_command('seed_blog', stdout=StringIO())
        self.assertEqual(Post.objects.count(), count)
        self.assertEqual(Post.objects.get(slug='what-is-eventlaya').title, 'Edited')
        self.assertIn('created', out.getvalue())
