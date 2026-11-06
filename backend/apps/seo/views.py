"""Server-visible HTML, page metadata API, robots.txt, sitemaps and llms.txt.

Nginx (deploy/enable_seo_routes.sh) sends these paths here; everything else stays static (dist/, dist/prerender/).
"""
from datetime import timedelta
from xml.sax.saxutils import escape as xml_escape

from django.db.models import Q
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_safe

from apps.accounts.modules import module_enabled
from apps.site_analytics.config import verification_tags
from . import html as html_mod
from . import jsonld, site
from .pages import Ctx, normalize_path, resolve


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@require_safe  # GET and HEAD (uptime checks and some link-preview bots send HEAD, also for the homepage)
def page_view(request, path=''):
    """The web app's index.html for a public URL, with that page's title, meta, canonical, Open Graph, JSON-LD and
    a <noscript> summary. Unknown slugs → 404 + noindex (the app then shows its "doesn't exist" page)."""
    path = normalize_path('/' + path)
    meta = resolve(request, path)
    body = None
    if meta.status == 200 and meta.prerender and Ctx(request).tenant is None:
        body = html_mod.prerendered(path, meta.fresh_after)
    if body is None:
        body = html_mod.inject(html_mod.shell(), meta)
    body = html_mod.site_verification(body, verification_tags(request))  # eventlaya.com only
    response = HttpResponse(body, status=meta.status, content_type='text/html; charset=utf-8')
    response['Cache-Control'] = 'no-cache'
    if not meta.indexable:
        response['X-Robots-Tag'] = 'noindex'
    return response


@require_GET
def meta_api(request):
    """GET /api/seo/meta/?path=/e/some-event → the page's metadata (status 404 inside the body for unknown pages)."""
    meta = resolve(request, request.GET.get('path', '/'))
    response = JsonResponse(meta.as_dict(), json_dumps_params={'ensure_ascii': False})
    response['Cache-Control'] = 'public, max-age=60'
    return response


# ---------------------------------------------------------------------------
# robots.txt
# ---------------------------------------------------------------------------

# Crawlers we explicitly welcome (search engines and AI assistants); they share the rules below.
WELCOME_BOTS = [
    'Googlebot', 'Google-Extended', 'Bingbot', 'DuckDuckBot', 'Applebot', 'Applebot-Extended', 'YandexBot',
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'ClaudeBot', 'Claude-User',
    'Claude-SearchBot', 'anthropic-ai', 'CCBot', 'Meta-ExternalAgent', 'facebookexternalhit', 'Twitterbot',
    'LinkedInBot', '*',
]
# Public API endpoints the pages need for rendering (crawlers that run JavaScript must be able to fetch them).
PUBLIC_API = [
    '/api/events/public/', '/api/marketplace/venues/', '/api/marketplace/vendors/', '/api/marketplace/categories/',
    '/api/blog/', '/api/seo/', '/api/platform/billing/plans/', '/api/auth/tenant-branding/resolve/', '/api/reviews/',
]
PRIVATE_PATHS = ['/api/', '/api/blog/admin/', '/app', '/admin', '/ticket/', '/login', '/forgot-password',
                 '/reset-password', '/verify-email', '/my/', '/e/*/register', '/*?tenant=']


@require_GET
def robots_txt(request):
    ctx = Ctx(request)
    lines = [f'# {ctx.site_name} — {ctx.base}/']
    if ctx.unknown_host:
        lines += ['User-agent: *', 'Disallow: /']
    else:
        lines.append('# Search engines and AI assistants are welcome to read and cite our public pages.')
        lines += [f'User-agent: {bot}' for bot in WELCOME_BOTS]
        lines += ['Allow: /'] + [f'Allow: {p}' for p in PUBLIC_API] + [f'Disallow: {p}' for p in PRIVATE_PATHS]
        lines += ['', f'Sitemap: {ctx.base}/sitemap.xml']
    return HttpResponse('\n'.join(lines) + '\n', content_type='text/plain; charset=utf-8')


# ---------------------------------------------------------------------------
# Sitemaps
# ---------------------------------------------------------------------------

def _date(dt):
    return timezone.localtime(dt).date().isoformat() if dt else None


def _urlset(entries, alternates=None):
    """entries: [(loc, lastmod or None)]; alternates: {loc: [{'hreflang', 'href'}]} (language versions)."""
    alternates = alternates or {}
    xhtml = ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' if alternates else ''
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"{xhtml}>']
    for loc, lastmod in entries:
        links = ''.join(f'<xhtml:link rel="alternate" hreflang="{xml_escape(a["hreflang"])}" href="{xml_escape(a["href"])}"/>'
                        for a in alternates.get(loc, []))
        out.append(f'  <url><loc>{xml_escape(loc)}</loc>' + (f'<lastmod>{lastmod}</lastmod>' if lastmod else '')
                   + links + '</url>')
    out.append('</urlset>')
    return HttpResponse('\n'.join(out) + '\n', content_type='application/xml; charset=utf-8')


def _sitemap_index(entries):
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, lastmod in entries:
        out.append(f'  <sitemap><loc>{xml_escape(loc)}</loc>' + (f'<lastmod>{lastmod}</lastmod>' if lastmod else '') + '</sitemap>')
    out.append('</sitemapindex>')
    return HttpResponse('\n'.join(out) + '\n', content_type='application/xml; charset=utf-8')


def sitemap_events(request=None, tenant=None):
    """Public events worth indexing: upcoming and live, plus the last 180 days. Events of organizers with a live
    white-label site belong to that site's sitemap (their canonical URL is there)."""
    from apps.accounts.tenancy import site_url_for_organizer
    from apps.events.models import Event
    from apps.events.views import PUBLIC_EVENT_STATUSES
    since = timezone.localdate() - timedelta(days=180)
    qs = Event.objects.filter(status__in=PUBLIC_EVENT_STATUSES).filter(
        Q(end_date__gte=since) | Q(end_date__isnull=True, start_date__gte=since)).select_related('organizer')
    if tenant is not None:
        return list(qs.filter(organizer_id=tenant.organizer_id).order_by('-start_date'))
    cache = {}
    out = []
    for ev in qs.order_by('-start_date'):
        if ev.organizer_id not in cache:
            cache[ev.organizer_id] = site_url_for_organizer(ev.organizer)
        if not cache[ev.organizer_id]:
            out.append(ev)
    return out


SECTIONS = ['pages', 'events', 'marketplace', 'blog']


SECTION_MODULES = {'events': 'events', 'marketplace': 'marketplace', 'blog': 'blog'}


def _section_enabled(section):
    module = SECTION_MODULES.get(section)
    return module is None or module_enabled(module)


@require_GET
def sitemap_xml(request):
    ctx = Ctx(request)
    if ctx.unknown_host:
        return HttpResponse('Not found', status=404, content_type='text/plain')
    if ctx.tenant is not None:
        events = sitemap_events(tenant=ctx.tenant) if module_enabled('events') else []
        return _urlset([(ctx.url('/'), None)] + [(ctx.url(f'/e/{e.slug}'), _date(e.updated_at)) for e in events])
    entries = []
    for section in SECTIONS:
        if _section_enabled(section):
            entries.append((ctx.url(f'/sitemaps/{section}.xml'), None))
    return _sitemap_index(entries)


@require_GET
def sitemap_section(request, section):
    ctx = Ctx(request)
    if ctx.tenant is not None or ctx.unknown_host or section not in SECTIONS or not _section_enabled(section):
        return HttpResponse('Not found', status=404, content_type='text/plain')
    base = site.site_url()
    if section == 'pages':
        paths = ['/', '/events', '/marketplace', '/pricing', '/signup', '/contact', '/privacy', '/terms',
                 '/community-guidelines', '/delete-account']
        # /blog itself is listed in blog.xml (with the date of the newest post), not twice.
        if not module_enabled('marketplace'):
            paths.remove('/marketplace')
        return _urlset([(f'{base}{p}' if p != '/' else f'{base}/', None) for p in paths])
    if section == 'events':
        return _urlset([(f'{base}/e/{e.slug}', _date(e.updated_at)) for e in sitemap_events()])
    if section == 'marketplace':
        from .pages import _vendors, _venues
        return _urlset(
            [(f'{base}/marketplace/venues/{v.slug}', _date(v.updated_at)) for v in _venues()]
            + [(f'{base}/marketplace/vendors/{v.id}', _date(v.updated_at)) for v in _vendors()]
        )
    from apps.blog.models import Post
    from .pages import blog_alternates
    posts = list(Post.objects.live().filter(noindex=False, canonical_url=''))
    latest = max((p.updated_at for p in posts), default=None)
    translated = {p.translation_of for p in posts if p.translation_of}
    alternates = {}
    for p in posts:
        if p.translation_of or p.slug in translated:
            alternates[f'{base}/blog/{p.slug}'] = blog_alternates(ctx, p)
    return _urlset([(f'{base}/blog', _date(latest))] + [(f'{base}/blog/{p.slug}', _date(p.updated_at)) for p in posts],
                   {k: v for k, v in alternates.items() if v})


# ---------------------------------------------------------------------------
# llms.txt (https://llmstxt.org): a plain Markdown briefing for AI assistants
# ---------------------------------------------------------------------------

def _plans_markdown():
    rows = []
    for p in jsonld.active_plans():
        price = 'custom quote' if p.monthly_price is None else ('free' if p.monthly_price == 0 else f'Rs {p.monthly_price:,} per month')
        if p.yearly_price:
            price += f' (Rs {p.yearly_price:,} per year)'
        limit = f', up to {p.attendee_limit} attendees per event' if p.attendee_limit else ''
        rows.append(f'- **{p.name}** — {price}{limit}. {"; ".join(p.features)}.')
    return '\n'.join(rows) or '- See https://eventlaya.com/pricing'


def llms_markdown(full=False):
    base = site.site_url()
    lines = [
        '# Eventlaya',
        '',
        '> Eventlaya (इभेन्टलय) is an event management platform built in Dharan for organizers in Eastern Nepal '
        '(Koshi Province). Organizers publish an event page with an online registration form and ticket types, '
        'attendees get a QR code pass by email, and gate staff check people in and out with a phone camera or the '
        'Android app. It also offers live audience voting, team chat, analytics and a marketplace of event venues '
        'and vendors.',
        '',
        f'Website: {base}/ · Contact: {site.CONTACT_EMAIL} · Based in Eastern Nepal · Prices in Nepali rupees (NPR).',
        '',
        '## What it does',
        '',
        '- Event pages with schedule, speakers, FAQs, organizer details and a map; one link to share.',
        '- Online registration: custom form builder (text, paragraph, number, email, phone, dropdown, radio, '
        'checkbox and date questions), ticket types (price, quantity, sales window, hidden types), promo codes, '
        'several tickets per order with guest names.',
        '- QR code passes by email and on a pass page; download, print or save.',
        '- Payment: per event, attendees pay at the venue (the pass shows the amount due) and/or online with Khalti '
        'or eSewa where online payments are enabled; online payments are confirmed with the provider before the pass '
        'is issued.',
        '- Gate check-in: web scanner in any phone browser, Android app with an offline queue, several gates '
        '(entry/exit, VIP), ticket types limited to gates, duplicate pass alerts, live count of people inside.',
        '- Team: gate staff accounts and gate assignment, team chat, crew task board, budget tracking, push '
        'announcements to staff.',
        '- Live audience voting and polls (one vote per pass or open), results on a big-screen presenter view.',
        '- Pageant and contest voting: numbered contestants with profiles, rounds, judges scoring on a phone, '
        'weighted judge and public results, voter verification by SMS or email code, daily vote limits, fraud flags '
        'and an audit log, and a presenter view for the winner reveal.',
        '- Analytics and attendee CSV export.',
        '- Marketplace of vendors (photo/video, sound and stage, decoration, catering…) and venues (banquets, '
        'party palaces, resorts, auditoriums, hotel ballrooms, open grounds) with inquiries and availability booking.',
        '- White-label event sites on the organizer\'s own domain or <name>.eventlaya.com.',
        '- Attendees need no app: they register on a web page and get their pass on screen and by email.',
        '',
        '## Pricing',
        '',
        _plans_markdown(),
        '',
        '## Where',
        '',
        'Built in Dharan; serves Koshi Province (Eastern Nepal): ' + ', '.join(
            c for c in site.KOSHI_CITIES if c not in ('Duhabi', 'Jhumka', 'Triyuga')) + '. Events can be anywhere in Nepal.',
        '',
        '## Key pages',
        '',
        f'- [Home]({base}/): product overview',
        f'- [Upcoming events]({base}/events): public events with online registration',
        f'- [Venues and vendors]({base}/marketplace): event venues and service providers in Eastern Nepal',
        f'- [Pricing]({base}/pricing): plans and prices in NPR',
        f'- [Contact]({base}/contact): {site.CONTACT_EMAIL}',
        f'- [Privacy policy]({base}/privacy), [Terms of service]({base}/terms)',
    ]
    posts = []
    if module_enabled('blog'):
        from apps.blog.models import Post
        posts = list(Post.objects.live().filter(noindex=False))
        if posts:
            lines += ['', '## Guides (blog)', '', f'- [Eventlaya blog]({base}/blog): all guides']
            lines += [f'- [{p.title}]({base}/blog/{p.slug}){" (नेपाली / Nepali)" if p.language == "ne" else ""}: '
                      f'{p.excerpt}' for p in posts]
    lines += ['', '## Optional', '', f'- [Full text of the guides]({base}/llms-full.txt)', f'- [Sitemap]({base}/sitemap.xml)']
    if full and posts:
        lines += ['', '---', '']
        for p in posts:
            lines += [f'# {p.title}', '', f'Source: {base}/blog/{p.slug} · Updated {_date(p.updated_at)}', '',
                      p.body.strip(), '']
            if p.faq:
                lines += ['## Frequently asked questions', '']
                for f in p.faq:
                    lines += [f'**{f["q"]}**', '', f['a'], '']
            lines += ['---', '']
    return '\n'.join(lines).rstrip() + '\n'


def _llms(request, full):
    ctx = Ctx(request)
    if ctx.tenant is not None or ctx.unknown_host:
        return HttpResponse('Not found', status=404, content_type='text/plain')
    response = HttpResponse(llms_markdown(full), content_type='text/markdown; charset=utf-8')
    response['Cache-Control'] = 'public, max-age=3600'
    return response


@require_GET
def llms_txt(request):
    return _llms(request, False)


@require_GET
def llms_full_txt(request):
    return _llms(request, True)
