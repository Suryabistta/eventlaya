"""schema.org JSON-LD builders. Every dict returned here is a complete node with "@context".

Only real data goes in: no ratings or reviews unless they exist, no invented addresses.
"""
from datetime import datetime
from decimal import Decimal

from django.utils import timezone

from . import site

CONTEXT = 'https://schema.org'
NEPAL_OFFSET = '+05:45'


def _node(type_, **fields):
    data = {'@context': CONTEXT, '@type': type_}
    data.update({k: v for k, v in fields.items() if v not in (None, '', [], {})})
    return data


def _clean(d):
    return {k: v for k, v in d.items() if v not in (None, '', [], {})}


def org_id():
    return f'{site.site_url()}/#organization'


def absolute(url, base=None):
    if not url:
        return None
    if url.startswith(('http://', 'https://')):
        return url
    return f'{(base or site.site_url()).rstrip("/")}/{url.lstrip("/")}'


def price_str(value):
    value = Decimal(value or 0)
    return f'{value.quantize(Decimal("1")) if value == value.to_integral() else value.quantize(Decimal("0.01"))}'


def iso_nepal(d, t=None):
    """'2026-11-20T18:00:00+05:45' (or the bare date when there's no time)."""
    if t is None:
        return d.isoformat()
    return f'{datetime.combine(d, t).replace(microsecond=0).isoformat()}{NEPAL_OFFSET}'


def iso(dt):
    if dt is None:
        return None
    return timezone.localtime(dt).replace(microsecond=0).isoformat()


def postal_address(street=None, city=None):
    city = city or site.city_in(street or '')
    return _clean({
        '@type': 'PostalAddress',
        'streetAddress': street,
        'addressLocality': city,
        'addressRegion': site.REGION if city and city in site.KOSHI_CITIES else None,
        'addressCountry': site.COUNTRY_CODE,
    })


# ---------------------------------------------------------------------------
# Eventlaya itself
# ---------------------------------------------------------------------------

def area_served():
    return [{'@type': 'AdministrativeArea', 'name': f'{site.REGION}, Nepal'}] + [
        {'@type': 'City', 'name': c} for c in site.KOSHI_CITIES if c not in ('Duhabi', 'Jhumka', 'Triyuga')
    ]


def organization():
    base = site.site_url()
    return _node(
        'Organization',
        **{'@id': org_id()},
        name=site.SITE_NAME,
        alternateName=site.ALTERNATE_NAMES,
        url=f'{base}/',
        logo={'@type': 'ImageObject', 'url': f'{base}{site.LOGO_PATH}', 'width': 512, 'height': 512},
        image=f'{base}{site.DEFAULT_IMAGE_PATH}',
        description='Event management platform built in Dharan for Eastern Nepal: online registration, QR passes, '
                    'gate check-in, live voting and a marketplace of venues and vendors.',
        email=site.CONTACT_EMAIL,
        contactPoint=[{
            '@type': 'ContactPoint', 'contactType': 'customer support', 'email': site.CONTACT_EMAIL,
            'areaServed': site.COUNTRY_CODE, 'availableLanguage': ['en', 'ne'],
        }],
        address=_clean({'@type': 'PostalAddress', 'addressRegion': site.REGION, 'addressCountry': site.COUNTRY_CODE}),
        areaServed=area_served(),
        sameAs=list(site.SAME_AS),
    )


def website():
    base = site.site_url()
    # No SearchAction: the site has no URL-addressable search, and Google retired the sitelinks search box (2024).
    return _node(
        'WebSite',
        **{'@id': f'{base}/#website'},
        url=f'{base}/',
        name=site.SITE_NAME,
        alternateName=site.ALTERNATE_NAMES,
        inLanguage='en',
        publisher={'@id': org_id()},
    )


def active_plans():
    try:
        from apps.platform.models import Plan
        return list(Plan.objects.filter(is_active=True).order_by('order'))
    except Exception:  # platform app missing / table not migrated
        return []


def plan_offers(plans):
    offers = []
    for plan in plans:
        if plan.monthly_price is None:
            continue  # custom quote: no price to state
        price = price_str(plan.monthly_price)
        offer = {
            '@type': 'Offer', 'name': plan.name, 'price': price, 'priceCurrency': 'NPR',
            'url': f'{site.site_url()}/pricing',
            'description': '; '.join(plan.features[:4]) if plan.features else None,
        }
        if plan.monthly_price:
            offer['priceSpecification'] = {
                '@type': 'UnitPriceSpecification', 'price': price, 'priceCurrency': 'NPR',
                'unitCode': 'MON', 'unitText': 'month', 'billingDuration': 'P1M',
            }
        offers.append(_clean(offer))
    return offers


FEATURES = [
    'Online event registration with custom forms',
    'Ticket types, promo codes and multi-ticket orders',
    'QR code passes by email',
    'Gate check-in with a phone camera or the Android app (offline queue)',
    'Gate staff accounts and live entry counts',
    'Live audience voting and polls',
    'Event analytics and attendee CSV export',
    'Team chat and crew task board',
    'Venue and vendor marketplace with availability booking',
    'White-label event sites on your own domain',
]


def software_application(plans=None):
    plans = active_plans() if plans is None else plans
    return _node(
        'SoftwareApplication',
        **{'@id': f'{site.site_url()}/#software'},
        name=site.SITE_NAME,
        alternateName=site.ALTERNATE_NAMES,
        url=f'{site.site_url()}/',
        applicationCategory='BusinessApplication',
        applicationSubCategory='Event management software',
        operatingSystem='Web, Android',
        description='Event management software for organizers in Nepal: registration forms, QR passes, gate '
                    'check-in, live voting and analytics. Free plan for events up to 150 attendees.',
        featureList=FEATURES,
        offers=plan_offers(plans),
        areaServed=area_served(),
        publisher={'@id': org_id()},
        provider={'@id': org_id()},
    )


def breadcrumbs(items):
    """items: [(name, absolute_url), ...]"""
    return _node('BreadcrumbList', itemListElement=[
        {'@type': 'ListItem', 'position': i, 'name': name, 'item': url} for i, (name, url) in enumerate(items, 1)
    ])


def faq_page(faq):
    entries = [f for f in faq or [] if f.get('q') and f.get('a')]
    if not entries:
        return None
    return _node('FAQPage', mainEntity=[
        {'@type': 'Question', 'name': f['q'], 'acceptedAnswer': {'@type': 'Answer', 'text': f['a']}} for f in entries
    ])


def web_page(name, url, description=None, type_='WebPage'):
    return _node(type_, name=name, url=url, description=description, inLanguage='en',
                 isPartOf={'@id': f'{site.site_url()}/#website'})


def item_list(name, url, urls, description=None):
    return _node(
        'CollectionPage', name=name, url=url, description=description, inLanguage='en',
        isPartOf={'@id': f'{site.site_url()}/#website'},
        mainEntity={'@type': 'ItemList', 'numberOfItems': len(urls), 'itemListElement': [
            {'@type': 'ListItem', 'position': i, 'url': u} for i, u in enumerate(urls, 1)
        ]} if urls else None,
    )


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

AVAILABILITY = {
    'on_sale': 'https://schema.org/InStock',
    'sold_out': 'https://schema.org/SoldOut',
    'not_started': 'https://schema.org/PreOrder',
    'ended': 'https://schema.org/SoldOut',
    'inactive': 'https://schema.org/SoldOut',
}


def event(ev, base_url, organizer_name, ticket_types, phase, image=None):
    """Event node. ticket_types: rows from events.ticketing.public_ticket_types (visible, active)."""
    page = f'{base_url}/e/{ev.slug}'
    register = f'{page}/register'
    closed = phase in ('ended', 'cancelled') or ev.is_full
    offers = []
    for t in ticket_types:
        availability = 'https://schema.org/SoldOut' if closed else AVAILABILITY.get(t.get('availability'), 'https://schema.org/InStock')
        offers.append(_clean({
            '@type': 'Offer', 'name': t.get('name'), 'price': price_str(t.get('price')), 'priceCurrency': 'NPR',
            'availability': availability, 'url': register,
            'validFrom': t.get('sales_start') or iso(ev.created_at),
        }))
    if not offers:
        offers.append(_clean({
            '@type': 'Offer', 'price': price_str(ev.ticket_price if ev.is_paid else 0), 'priceCurrency': 'NPR',
            'availability': 'https://schema.org/SoldOut' if closed else 'https://schema.org/InStock',
            'url': register, 'validFrom': iso(ev.created_at),
        }))

    end_date = ev.end_date or (ev.start_date if ev.end_time else None)
    description = (ev.tagline or '').strip() or (ev.description or '').strip()
    return _node(
        'Event',
        name=ev.title,
        description=description[:5000] or None,
        url=page,
        startDate=iso_nepal(ev.start_date, ev.start_time),
        endDate=iso_nepal(end_date, ev.end_time) if end_date else None,
        eventStatus='https://schema.org/EventCancelled' if ev.status == 'cancelled' else 'https://schema.org/EventScheduled',
        eventAttendanceMode='https://schema.org/OfflineEventAttendanceMode',
        location=_clean({
            '@type': 'Place',
            'name': ev.location,
            'address': postal_address(ev.map_query or ev.location),
        }),
        image=[absolute(ev.banner.url, site.site_url())] if ev.banner else [image or f'{site.site_url()}{site.DEFAULT_IMAGE_PATH}'],
        organizer=_clean({'@type': 'Organization', 'name': organizer_name, 'url': f'{base_url}/',
                          'email': ev.contact_email or None}),
        offers=offers,
        isAccessibleForFree=all(Decimal(o.get('price', '0')) == 0 for o in offers) or None,
    )


# ---------------------------------------------------------------------------
# Marketplace
# ---------------------------------------------------------------------------

def venue(v):
    url = f'{site.site_url()}/marketplace/venues/{v.slug}'
    images = [absolute(i if isinstance(i, str) else (i or {}).get('url')) for i in (v.images or [])]
    images = [i for i in images if i][:6]
    price = Decimal(v.price_per_day or 0)
    return _node(
        ['EventVenue', 'LocalBusiness'],
        **{'@id': url},
        name=v.name,
        description=(v.description or '')[:5000] or None,
        url=url,
        image=images or None,
        address=postal_address(v.address, v.city),
        telephone=v.contact_phone or None,
        email=v.contact_email or None,
        maximumAttendeeCapacity=v.capacity_max or None,
        priceRange=f'From NPR {int(price):,} per day' if price > 0 else None,
        amenityFeature=[{'@type': 'LocationFeatureSpecification', 'name': str(a), 'value': True}
                        for a in (v.amenities or []) if isinstance(a, str)][:20],
        areaServed={'@type': 'City', 'name': v.city} if v.city else None,
    )


def vendor(v):
    url = f'{site.site_url()}/marketplace/vendors/{v.id}'
    images = [absolute(i if isinstance(i, str) else (i or {}).get('url')) for i in (v.portfolio_images or [])]
    images = [i for i in images if i][:6]
    price = Decimal(v.starting_price or 0)
    category = v.category.name if v.category_id else None
    return _node(
        'Service',
        **{'@id': url},
        name=v.business_name,
        serviceType=category,
        description=(v.description or '')[:5000] or None,
        url=url,
        image=images or None,
        areaServed={'@type': 'City', 'name': v.city} if v.city else None,
        provider=_clean({
            '@type': 'LocalBusiness', 'name': v.business_name, 'address': postal_address(v.address, v.city),
            'telephone': v.phone or None, 'email': v.email or None, 'image': images[0] if images else None,
        }),
        offers=_clean({
            '@type': 'Offer', 'priceCurrency': 'NPR', 'price': price_str(price), 'description': 'Starting price',
        }) if price > 0 else None,
    )


# ---------------------------------------------------------------------------
# Blog
# ---------------------------------------------------------------------------

def _author(name):
    if not name or 'eventlaya' in name.lower():
        return {'@type': 'Organization', 'name': name or 'Eventlaya team', 'url': f'{site.site_url()}/'}
    return {'@type': 'Person', 'name': name}


def blog_posting(post):
    url = f'{site.site_url()}/blog/{post.slug}'
    image = absolute(post.cover_image) or f'{site.site_url()}{site.DEFAULT_IMAGE_PATH}'
    return _node(
        'BlogPosting',
        **{'@id': f'{url}#article'},
        headline=post.title[:110],
        description=post.excerpt or None,
        url=url,
        mainEntityOfPage={'@type': 'WebPage', '@id': url},
        image=[image],
        datePublished=iso(post.published_at),
        dateModified=iso(max(post.updated_at, post.published_at) if post.published_at else post.updated_at),
        author=_author(post.author_name),
        publisher={'@type': 'Organization', '@id': org_id(), 'name': site.SITE_NAME,
                   'logo': {'@type': 'ImageObject', 'url': f'{site.site_url()}{site.LOGO_PATH}'}},
        articleSection=post.get_category_display(),
        keywords=', '.join(post.tags) or None,
        wordCount=post.word_count or None,
        inLanguage=post.language or 'en',
        **_translation_links(post),
        spatialCoverage=[{'@type': 'Place', 'name': f'{c}, Nepal'} for c in post.cities] or None,
        isPartOf={'@type': 'Blog', '@id': f'{site.site_url()}/blog#blog'},
    )


def _translation_links(post):
    """schema.org translationOfWork (on a translation) / workTranslation (on the original) for blog posts."""
    base = f'{site.site_url()}/blog'
    others = post.translations()
    if not others:
        return {}
    node = lambda p: {'@type': 'BlogPosting', '@id': f'{base}/{p.slug}#article', 'url': f'{base}/{p.slug}',
                      'inLanguage': p.language}
    if post.translation_of:
        original = next((p for p in others if p.slug == post.translation_of), None)
        return {'translationOfWork': node(original)} if original else {}
    return {'workTranslation': [node(p) for p in others]}


def _languages(posts):
    langs = sorted({p.language or 'en' for p in posts} | {'en'}, key=lambda c: (c != 'en', c))
    return langs[0] if len(langs) == 1 else langs


def blog(posts):
    url = f'{site.site_url()}/blog'
    return _node(
        'Blog',
        **{'@id': f'{url}#blog'},
        name='Eventlaya blog',
        url=url,
        description='Guides for organizing events in Eastern Nepal.',
        publisher={'@id': org_id()},
        inLanguage=_languages(posts),
        blogPost=[_clean({
            '@type': 'BlogPosting', 'headline': p.title[:110], 'url': f'{url}/{p.slug}',
            'datePublished': iso(p.published_at), 'description': p.excerpt or None, 'inLanguage': p.language or 'en',
        }) for p in posts],
    )
