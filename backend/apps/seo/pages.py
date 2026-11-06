"""Search/social metadata for every public page: title, description, canonical, robots, Open Graph, JSON-LD and a
plain-HTML summary for crawlers that don't run JavaScript.

One source of truth used by
  • the HTML view (apps.seo.views.page_view) that serves /e/<slug>, /blog/..., /marketplace/venues|vendors/...
    with the tags already in the HTML,
  • GET /api/seo/meta/?path=… which the web app's <SeoHead> applies on every navigation (and which the build-time
    prerender therefore bakes into the static pages).

Other apps can add pages without touching this file::

    from apps.seo.pages import PageMeta, register

    @register(r'^/e/(?P<slug>[^/]+)/contest/(?P<entry>[^/]+)$', hosts='both')
    def contestant_page(ctx, slug, entry):
        ...
        return PageMeta(title=..., description=..., canonical=ctx.url(f'/e/{slug}/contest/{entry}'), jsonld=[...])

(call it from your AppConfig.ready(); `hosts` is 'platform', 'tenant' or 'both'; return None for a 404). Nginx sends
every /e/… path to Django already, so pages under /e/ need no server change.
"""
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime

from django.utils import timezone
from django.utils.html import escape

from apps.accounts.modules import module_enabled
from apps.accounts.tenancy import is_platform_host, public_host, request_host, tenant_for_request
from . import jsonld, og_images, site


@dataclass
class PageMeta:
    title: str
    description: str = ''
    canonical: str | None = None
    robots: str = 'index,follow'
    status: int = 200
    og_type: str = 'website'
    image: str | None = None
    image_alt: str = ''
    image_width: int | None = None
    image_height: int | None = None
    image_type: str | None = None
    # og:title / twitter:title when it should differ from <title> (e.g. just the event name)
    og_title: str = ''
    site_name: str = site.SITE_NAME
    jsonld: list = field(default_factory=list)
    noscript: str = ''  # safe HTML
    published: datetime | None = None
    modified: datetime | None = None
    # Prerendered HTML older than this is ignored (the page changed since the build)
    fresh_after: datetime | None = None
    prerender: bool = False
    # Language of the page (<html lang>, og:locale) and its versions in other languages:
    # [{'hreflang': 'ne', 'href': 'https://…', 'locale': 'ne_NP'}, …, {'hreflang': 'x-default', …}] incl. this page.
    lang: str = 'en'
    locale: str = 'en_US'
    alternates: list = field(default_factory=list)

    @property
    def indexable(self):
        return self.status == 200 and 'noindex' not in self.robots

    def as_dict(self):
        data = asdict(self)
        for key in ('published', 'modified', 'fresh_after'):
            data[key] = jsonld.iso(data[key]) if data[key] else None
        data['jsonld'] = [n for n in self.jsonld if n]
        data.pop('noscript')
        data.pop('fresh_after')
        data.pop('prerender')
        if not self.image:
            img = og_images.default_image()
            data.update(image=img.url, image_width=img.width, image_height=img.height, image_type=img.type,
                        image_alt=self.image_alt or img.alt)
        data['og_title'] = self.og_title or self.title
        return data

    def set_image(self, og):
        self.image, self.image_width, self.image_height, self.image_type = og.url, og.width, og.height, og.type
        self.image_alt = og.alt or self.image_alt
        return self


class Ctx:
    """Who's asking: the request, the white-label tenant (or None) and the base URL for canonical links."""

    def __init__(self, request):
        self.request = request
        self.tenant = tenant_for_request(request)
        host = request_host(request)
        # A host that is neither the platform nor a live tenant (not set up / revoked): nothing is indexable there.
        self.unknown_host = self.tenant is None and not is_platform_host(host)
        if self.tenant is not None:
            self.base = f'https://{public_host(self.tenant) or host}'
            self.site_name = self.tenant.brand_name or site.SITE_NAME
        else:
            self.base = site.site_url()
            self.site_name = site.SITE_NAME

    def url(self, path='/'):
        return f'{self.base}{path if path.startswith("/") else "/" + path}'


_ROUTES = []  # (compiled regex, resolver, hosts)


def register(pattern, hosts='platform', first=False):
    def deco(fn):
        entry = (re.compile(pattern), fn, hosts)
        if first:
            _ROUTES.insert(0, entry)
        else:
            _ROUTES.append(entry)
        return fn
    return deco


def normalize_path(path):
    path = (path or '/').split('?', 1)[0].split('#', 1)[0]
    if not path.startswith('/'):
        path = '/' + path
    path = re.sub(r'/{2,}', '/', path)
    if len(path) > 1:
        path = path.rstrip('/')
    return path


# Paths that are real app screens but should never be indexed.
PRIVATE = re.compile(
    r'^/(app|admin|login|forgot-password|reset-password|verify-email|ticket|my|superadmin)(/|$)'
    r'|^/e/[^/]+/(register|vote)(/|$)'
)


def resolve(request, path):
    path = normalize_path(path)
    ctx = Ctx(request)
    if ctx.unknown_host:
        return not_found(ctx)
    for pattern, fn, hosts in _ROUTES:
        if hosts == 'platform' and ctx.tenant is not None:
            continue
        if hosts == 'tenant' and ctx.tenant is None:
            continue
        m = pattern.match(path)
        if m:
            meta = fn(ctx, **m.groupdict())
            return meta if meta is not None else not_found(ctx)
    if PRIVATE.match(path):
        return PageMeta(title=ctx.site_name, robots='noindex,nofollow', site_name=ctx.site_name, canonical=None)
    return not_found(ctx)


def not_found(ctx):
    # Generic site preview: nothing about drafts, unpublished or removed pages leaks into link previews.
    return PageMeta(
        title=f'Page not found | {ctx.site_name}', description=HOME_DESCRIPTION if ctx.tenant is None else '',
        og_title=ctx.site_name if ctx.tenant is not None else 'Eventlaya — Event registration & QR check-in in Nepal',
        status=404, robots='noindex,nofollow', site_name=ctx.site_name,
        noscript='<h1>Page not found</h1><p>The link may be old, or the page was removed.</p>',
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def truncate(text, limit=158):
    text = re.sub(r'\s+', ' ', (text or '')).strip()
    if len(text) <= limit:
        return text
    cut = text[: limit - 1].rsplit(' ', 1)[0].rstrip(',.;:—-')
    return cut + '…'


def with_brand(title, brand=site.SITE_NAME, limit=65):
    full = f'{title} | {brand}'
    return full if len(full) <= limit or len(title) < 20 else title


def fit_title(*candidates, limit=60):
    """The first candidate that fits in a search result (~60 characters), else the shortest one cut at a word."""
    for c in candidates:
        if len(c) <= limit:
            return c
    return truncate(min(candidates, key=len), limit)


def links_html(items):
    return '<ul>' + ''.join(f'<li><a href="{escape(u)}">{escape(n)}</a></li>' for n, u in items) + '</ul>'


NAV = [
    ('Home', '/'), ('Upcoming events', '/events'), ('Venues and vendors', '/marketplace'), ('Pricing', '/pricing'),
    ('Blog', '/blog'), ('Contact', '/contact'),
]


def nav_html():
    items = [n for n in NAV if n[1] != '/blog' or module_enabled('blog')]
    return f'<nav aria-label="Site">{links_html(items)}</nav>'


def static_page(ctx, path, title, description, heading, body_html='', jsonld_nodes=None, crumb=None, og_type='website'):
    url = ctx.url(path)
    nodes = list(jsonld_nodes or [])
    if crumb:
        nodes.append(jsonld.breadcrumbs([('Home', ctx.url('/')), (crumb, url)]))
    return PageMeta(
        title=title, description=truncate(description), canonical=url, og_type=og_type, jsonld=nodes,
        noscript=f'<h1>{escape(heading)}</h1><p>{escape(description)}</p>{body_html}{nav_html()}', prerender=True,
    )


# ---------------------------------------------------------------------------
# Eventlaya pages
# ---------------------------------------------------------------------------

HOME_DESCRIPTION = ('Event software built in Eastern Nepal: online registration, QR passes, gate check-in, live '
                    'voting, and venues and vendors across Koshi Province. Start free.')


@register(r'^/$')
def home(ctx):
    plans = jsonld.active_plans()
    body = (
        '<p>Eventlaya is an event management platform built in Dharan for organizers in Eastern Nepal (Koshi '
        'Province): clubs, colleges, schools, event companies and venues in Biratnagar, Itahari, Dharan and beyond. '
        'Organizers publish an event page with a registration form, attendees get a QR code pass by email, and gate '
        'staff check people in and out with a phone camera or the Android app.</p>'
        + links_html([(f, '/#features') for f in jsonld.FEATURES[:6]])
    )
    return static_page(
        ctx, '/', 'Eventlaya — Event registration & QR check-in in Nepal', HOME_DESCRIPTION,
        'From sign-up form to front gate', body,
        [jsonld.organization(), jsonld.website(), jsonld.software_application(plans)],
    )


@register(r'^/events$')
def events_list(ctx):
    items = []
    if module_enabled('events'):
        items = [(e.title, f'/e/{e.slug}') for e in _upcoming_events()[:50]]
    description = ('Find upcoming events in Biratnagar, Itahari, Dharan and across Koshi Province. Register online '
                   'and get your QR pass in minutes.')
    return static_page(
        ctx, '/events', 'Upcoming events in Eastern Nepal | Eventlaya', description, 'Upcoming events',
        links_html(items) if items else '',
        [jsonld.item_list('Upcoming events in Eastern Nepal', ctx.url('/events'), [ctx.url(u) for _, u in items],
                          description)],
        crumb='Events',
    )


@register(r'^/marketplace$')
def marketplace(ctx):
    if not module_enabled('marketplace'):
        return None
    venues, vendors = _venues(), _vendors()
    items = [(v.name, f'/marketplace/venues/{v.slug}') for v in venues[:40]] + \
            [(v.business_name, f'/marketplace/vendors/{v.id}') for v in vendors[:40]]
    description = ('Compare banquet halls, party palaces, photographers, sound, decoration and catering in Dharan, '
                   'Itahari, Biratnagar and nearby. Send an inquiry in a minute.')
    return static_page(
        ctx, '/marketplace', 'Event venues & vendors in Eastern Nepal | Eventlaya', description,
        'Venues and vendors', links_html(items) if items else '',
        [jsonld.item_list('Event venues and vendors in Eastern Nepal', ctx.url('/marketplace'),
                          [ctx.url(u) for _, u in items], description)],
        crumb='Venues & vendors',
    )


@register(r'^/pricing$')
def pricing(ctx):
    plans = jsonld.active_plans()
    parts, rows = [], []
    for p in plans:
        if p.monthly_price == 0:
            parts.append(f'Free for events up to {p.attendee_limit} attendees' if p.attendee_limit else 'Free plan')
        elif p.monthly_price:
            parts.append(f'{p.name} Rs {p.monthly_price:,}/month')
        price = 'Custom quote' if p.monthly_price is None else f'Rs {p.monthly_price:,} per month'
        rows.append(f'<li><strong>{escape(p.name)}</strong>: {escape(price)}. {escape("; ".join(p.features))}</li>')
    description = ('. '.join(parts) + '. Registration, QR passes and gate check-in for events in Nepal.') if parts else \
        'Plans for event registration, QR passes and gate check-in in Nepal.'
    return static_page(
        ctx, '/pricing', 'Pricing — event registration software in Nepal | Eventlaya', description, 'Pricing',
        f'<ul>{"".join(rows)}</ul>' if rows else '',
        [jsonld.software_application(plans)], crumb='Pricing',
    )


@register(r'^/signup$')
def signup(ctx):
    return static_page(ctx, '/signup', 'Create your free account | Eventlaya',
                       'Create a free Eventlaya account to publish events, take registrations and check people in at '
                       'the gate. Free for events up to 150 attendees.', 'Create your free account')


LEGAL = {
    '/privacy': ('Privacy policy', 'How Eventlaya collects, uses and protects personal data of organizers, attendees and vendors.'),
    '/terms': ('Terms of service', 'The terms for using Eventlaya as an organizer, attendee, vendor or venue.'),
    '/community-guidelines': ('Community guidelines', 'What is and isn’t allowed on Eventlaya events, listings, reviews and chat.'),
    '/delete-account': ('Delete your account', 'How to delete your Eventlaya account (organizer, attendee or vendor) and '
                                               'which of your data is removed or kept afterwards.'),
    '/contact': ('Contact', 'Contact Eventlaya: support, privacy and account requests at support@eventlaya.com.'),
}


@register(r'^/(?P<page>privacy|terms|community-guidelines|delete-account|contact)$')
def legal(ctx, page):
    name, description = LEGAL[f'/{page}']
    return static_page(ctx, f'/{page}', f'{name} | Eventlaya', description, name,
                       jsonld_nodes=[jsonld.web_page(name, ctx.url(f'/{page}'), description,
                                                     'ContactPage' if page == 'contact' else 'WebPage')],
                       crumb=name)


# ---------------------------------------------------------------------------
# Events (Eventlaya and white-label sites)
# ---------------------------------------------------------------------------

def _upcoming_events(request=None):
    from django.db.models import Q
    from apps.events.models import Event
    from apps.events.views import PUBLIC_EVENT_STATUSES
    today = timezone.localdate()
    qs = Event.objects.filter(status__in=PUBLIC_EVENT_STATUSES).exclude(status=Event.Status.COMPLETED)
    qs = qs.filter(Q(end_date__gte=today) | Q(end_date__isnull=True, start_date__gte=today))
    if request is not None:
        from apps.accounts.tenancy import scope_events
        qs = scope_events(qs, request)
    return list(qs.select_related('organizer').order_by('start_date', 'start_time'))


def organizer_name(org):
    from apps.platform.models import WhiteLabelRequest
    branding = getattr(org, 'tenant_branding', None) if WhiteLabelRequest.approved_for(org) is not None else None
    return (branding.brand_name if branding and branding.brand_name else None) or org.organization_name \
        or org.get_full_name() or org.username


def event_base_url(ctx, ev):
    """The tenant's site for white-label organizers (also when seen on eventlaya.com), else eventlaya.com."""
    if ctx.tenant is not None:
        return ctx.base
    from apps.accounts.tenancy import site_url_for_organizer
    return site_url_for_organizer(ev.organizer) or site.site_url()


def _clock(t):
    return t.strftime('%-I:%M %p')


def human_when(ev):
    """'Sat 15 Nov 2026, 5:00 PM' (Nepal time, as entered), with the end when it's on another day or given."""
    start = ev.start_date.strftime('%a %-d %b %Y')
    if ev.start_time:
        start += f', {_clock(ev.start_time)}'
    if ev.end_date and ev.end_date != ev.start_date:
        end = ev.end_date.strftime('%a %-d %b %Y')
        return f'{start} – {end}' + (f', {_clock(ev.end_time)}' if ev.end_time else '')
    if ev.end_time and ev.start_time:
        return f'{start} – {_clock(ev.end_time)}'
    return start


@register(r'^/e/(?P<slug>[^/]+)$', hosts='both')
def event_page(ctx, slug):
    if not module_enabled('events'):
        return None
    from apps.accounts.tenancy import scope_events
    from apps.events.models import Event
    from apps.events.ticketing import public_ticket_types
    from apps.events.views import PUBLIC_EVENT_STATUSES
    # Drafts are not found: no title, date or picture of an unpublished event leaks into a link preview.
    ev = scope_events(Event.objects.select_related('organizer'), ctx.request).filter(
        slug=slug, status__in=PUBLIC_EVENT_STATUSES + [Event.Status.CANCELLED]).first()
    if ev is None:
        return None
    base = event_base_url(ctx, ev)
    url = f'{base}/e/{ev.slug}'
    phase = ev.phase()
    org = organizer_name(ev.organizer)
    types = public_ticket_types(ev)
    when = human_when(ev)
    place = site.city_in(ev.location) or ev.location
    status_label = {'cancelled': 'Cancelled', 'ended': 'Ended'}.get(phase, '')
    summary = re.sub(r'\s+', ' ', (ev.tagline or ev.description or '')).strip()
    # Chat apps show ~2 lines: date and place first, then what it is.
    lead = f'{when} · {ev.location}'
    if status_label:
        lead = f'{status_label} · {lead}'
    description = truncate(f'{lead}. {summary}' if summary else f'{lead}. Register online and get your QR pass.', 200)
    title = f'{ev.title} — {ev.start_date.strftime("%-d %b %Y")}, {place}'
    if status_label:
        title = f'{status_label}: {title}'

    prices = ''.join(
        f'<li>{escape(t["name"])}: {"Free" if float(t["price"]) == 0 else "Rs " + escape(jsonld.price_str(t["price"]))}</li>'
        for t in types)
    status_line = {'cancelled': 'This event was cancelled by the organizer.', 'ended': 'This event has ended.'}.get(phase, '')
    noscript = (
        f'<article><h1>{escape(ev.title)}</h1>'
        f'<p><strong>When:</strong> {escape(when)}. <strong>Where:</strong> {escape(ev.location)}. '
        f'<strong>Organizer:</strong> {escape(org)}.</p>'
        + (f'<p>{escape(status_line)}</p>' if status_line else '')
        + (f'<p>{escape(ev.tagline)}</p>' if ev.tagline else '')
        + (f'<p>{escape(truncate(ev.description, 1500))}</p>' if ev.description else '')
        + (f'<h2>Tickets</h2><ul>{prices}</ul>' if prices else '')
        + (f'<p><a href="{escape(url)}/register">Register for {escape(ev.title)}</a></p>' if phase in ('upcoming', 'live') else '')
        + '</article>'
    )
    tenant = ctx.tenant is not None
    og = og_images.for_event(ev, when, ev.location, brand=ctx.site_name if tenant else '', status_label=status_label,
                             host=ctx.base.replace('https://', '') if tenant else '')
    nodes = [jsonld.event(ev, base, org, types, phase, image=og.url)]
    if ctx.tenant is None and base == site.site_url():
        nodes.append(jsonld.breadcrumbs([('Home', ctx.url('/')), ('Events', ctx.url('/events')), (ev.title, url)]))
    meta = PageMeta(
        title=with_brand(title, ctx.site_name), og_title=ev.title, description=description, canonical=url,
        og_type='website', site_name=ctx.site_name, jsonld=nodes, noscript=noscript, modified=ev.updated_at,
    )
    return meta.set_image(og)


@register(r'^/$', hosts='tenant')
def tenant_home(ctx):
    t = ctx.tenant
    name = t.brand_name or site.SITE_NAME
    events = [e for e in _upcoming_events(ctx.request)][:50]
    items = [(e.title, f'/e/{e.slug}') for e in events]
    description = truncate(f'Upcoming events by {name}. Register online and get your QR pass.')
    return PageMeta(
        title=f'Events by {name}', description=description, canonical=ctx.url('/'), site_name=name,
        image=jsonld.absolute(t.brand_logo, ctx.base) if getattr(t, 'brand_logo', '') else None,
        jsonld=[jsonld.item_list(f'Events by {name}', ctx.url('/'), [ctx.url(u) for _, u in items])],
        noscript=f'<h1>Events by {escape(name)}</h1>{links_html(items)}',
    )


# ---------------------------------------------------------------------------
# Marketplace
# ---------------------------------------------------------------------------

def _venues():
    from apps.marketplace.models import ListingStatus, VenueListing
    return list(VenueListing.objects.filter(listing_status=ListingStatus.APPROVED, is_paused=False).order_by('-is_featured', 'name'))


def _vendors():
    from apps.marketplace.models import ListingStatus, VendorProfile
    return list(VendorProfile.objects.filter(listing_status=ListingStatus.APPROVED, is_paused=False)
                .select_related('category').order_by('-is_featured', 'business_name'))


@register(r'^/marketplace/venues/(?P<slug>[^/]+)$')
def venue_page(ctx, slug):
    if not module_enabled('marketplace'):
        return None
    from apps.marketplace.models import ListingStatus, VenueListing
    v = VenueListing.objects.filter(slug=slug, listing_status=ListingStatus.APPROVED, is_paused=False).first()
    if v is None:
        return None
    url = ctx.url(f'/marketplace/venues/{v.slug}')
    kind = v.get_venue_type_display()
    description = truncate(v.description) or truncate(f'{v.name}: {kind} in {v.city}. Up to {v.capacity_max} guests.')
    facts = [f'{kind} in {v.city}', f'Address: {v.address}', f'Guests: {v.capacity_min}–{v.capacity_max}']
    if v.price_per_day:
        facts.append(f'From Rs {int(v.price_per_day):,} per day')
    if v.amenities:
        facts.append('Amenities: ' + ', '.join(str(a) for a in v.amenities[:15]))
    return PageMeta(
        title=fit_title(f'{v.name}, {v.city} — {kind} | Eventlaya', f'{v.name}, {v.city} — {kind}', f'{v.name}, {v.city}',
                        v.name),
        description=description, canonical=url,
        image_alt=v.name,
        jsonld=[jsonld.venue(v), jsonld.breadcrumbs([('Home', ctx.url('/')), ('Venues & vendors', ctx.url('/marketplace')),
                                                     (v.name, url)])],
        noscript=f'<article><h1>{escape(v.name)}</h1><ul>' + ''.join(f'<li>{escape(f)}</li>' for f in facts)
                 + f'</ul><p>{escape(truncate(v.description, 1500))}</p></article>',
        modified=v.updated_at,
    ).set_image(og_images.for_venue(v))


@register(r'^/marketplace/vendors/(?P<vendor_id>[0-9a-fA-F-]{36})$')
def vendor_page(ctx, vendor_id):
    if not module_enabled('marketplace'):
        return None
    from apps.marketplace.models import ListingStatus, VendorProfile
    v = VendorProfile.objects.select_related('category').filter(
        id=vendor_id, listing_status=ListingStatus.APPROVED, is_paused=False).first()
    if v is None:
        return None
    url = ctx.url(f'/marketplace/vendors/{v.id}')
    category = v.category.name if v.category_id else 'Event services'
    description = truncate(v.description) or truncate(f'{v.business_name}: {category} in {v.city}.')
    facts = [f'{category} in {v.city}']
    if v.starting_price:
        facts.append(f'Starting from Rs {int(v.starting_price):,}')
    return PageMeta(
        title=fit_title(f'{v.business_name} — {category} in {v.city} | Eventlaya', f'{v.business_name} — {category} in {v.city}',
                        f'{v.business_name}, {v.city}', v.business_name),
        description=description, canonical=url,
        image_alt=v.business_name,
        jsonld=[jsonld.vendor(v), jsonld.breadcrumbs([('Home', ctx.url('/')), ('Venues & vendors', ctx.url('/marketplace')),
                                                      (v.business_name, url)])],
        noscript=f'<article><h1>{escape(v.business_name)}</h1><ul>' + ''.join(f'<li>{escape(f)}</li>' for f in facts)
                 + f'</ul><p>{escape(truncate(v.description, 1500))}</p></article>',
        modified=v.updated_at,
    ).set_image(og_images.for_vendor(v))


# ---------------------------------------------------------------------------
# Blog
# ---------------------------------------------------------------------------

BLOG_DESCRIPTION = ('Practical guides for organizing events in Eastern Nepal: registration, QR tickets, gate '
                    'check-in, venues, voting, and city guides for Itahari, Dharan and Biratnagar.')


@register(r'^/blog$')
def blog_list(ctx):
    if not module_enabled('blog'):
        return None
    from apps.blog.models import Post
    posts = list(Post.objects.live())
    latest = max((p.updated_at for p in posts), default=None)
    items = ''.join(
        f'<li><a href="/blog/{escape(p.slug)}">{escape(p.title)}</a> — {escape(p.excerpt)}</li>' for p in posts[:50])
    meta = static_page(
        ctx, '/blog', 'Event planning guides for Nepal | Eventlaya blog', BLOG_DESCRIPTION, 'Eventlaya blog',
        f'<ul>{items}</ul>', [jsonld.blog(posts[:30])], crumb='Blog',
    )
    meta.fresh_after = latest
    return meta


@register(r'^/blog/(?P<slug>[^/]+)$')
def blog_post(ctx, slug):
    if not module_enabled('blog'):
        return None
    from apps.blog.models import Post
    post = Post.objects.live().filter(slug=slug).first()
    if post is None:
        return None
    url = ctx.url(f'/blog/{post.slug}')
    canonical = post.canonical_url or url
    faq = ''.join(f'<h3>{escape(f["q"])}</h3><p>{escape(f["a"])}</p>' for f in post.faq)
    words = BLOG_WORDS.get(post.language, BLOG_WORDS['en'])
    translations = post.translations()
    other = ''.join(f'<p><a href="/blog/{escape(t.slug)}" hreflang="{t.language}">{escape(BLOG_WORDS.get(t.language, BLOG_WORDS["en"])["read_in"])}</a></p>'
                    for t in translations)
    noscript = (
        f'<article lang="{post.language}"><h1>{escape(post.title)}</h1>'
        f'<p>{words["by"]} {escape(post.author_name)}. {words["published"]} <time datetime="{jsonld.iso(post.published_at)}">'
        f'{post.published_at:%-d %B %Y}</time>. {words["minutes"].format(post.reading_minutes)}.</p>{other}'
        f'{post.body_html}' + (f'<h2>{words["faq"]}</h2>{faq}' if faq else '') + '</article>'
    )
    nodes = [
        jsonld.blog_posting(post),
        jsonld.breadcrumbs([('Home', ctx.url('/')), ('Blog', ctx.url('/blog')), (post.title, url)]),
        jsonld.faq_page(post.faq),
    ]
    return PageMeta(
        title=post.seo_title or with_brand(post.title), description=truncate(post.excerpt), canonical=canonical,
        robots='noindex,follow' if post.noindex else 'index,follow', og_type='article',
        og_title=post.title, jsonld=[n for n in nodes if n], noscript=noscript, published=post.published_at,
        modified=post.updated_at, fresh_after=_newest(post, translations), prerender=True,
        lang=post.language, locale=post.locale, alternates=blog_alternates(ctx, post, translations),
    ).set_image(og_images.for_post(post))


# Words of the server-rendered article summary, per post language.
BLOG_WORDS = {
    'en': {'by': 'By', 'published': 'Published', 'minutes': '{} min read', 'faq': 'Frequently asked questions',
           'read_in': 'Read in English'},
    'ne': {'by': 'लेखक:', 'published': 'प्रकाशित', 'minutes': '{} मिनेट पढ्न', 'faq': 'प्रायः सोधिने प्रश्नहरू',
           'read_in': 'नेपालीमा पढ्नुहोस्'},
}


def _newest(post, translations):
    """A prerendered copy is stale once the post or one of its translations changed (the language links differ)."""
    return max([post.updated_at] + [t.updated_at for t in translations])


def blog_alternates(ctx, post, translations=None):
    """hreflang links for a post that exists in several languages: every version (this one included) plus
    x-default → the English version (else the original). [] when the post has no indexable translation."""
    if translations is None:
        translations = post.translations()
    versions = [post] + [t for t in translations if not t.noindex and not t.canonical_url]
    if len(versions) < 2 or post.noindex or post.canonical_url:
        return []
    out = [{'hreflang': p.language, 'href': ctx.url(f'/blog/{p.slug}'), 'locale': p.locale}
           for p in sorted(versions, key=lambda p: (p.language != 'en', p.language))]
    default = next((a for a in out if a['hreflang'] == 'en'), out[0])
    out.append({'hreflang': 'x-default', 'href': default['href'], 'locale': ''})
    return out
