"""The built web app's index.html with a page's tags injected (and the prerendered copies made at build time)."""
import json
import re
from datetime import datetime, timezone as dt_timezone

from django.utils.html import escape

from . import site

_cache = {}  # path -> (mtime, text)

FALLBACK_SHELL = """<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Eventlaya</title></head><body><div id="root"></div></body></html>"""


def _read(path):
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None, None
    cached = _cache.get(str(path))
    if cached and cached[0] == mtime:
        return cached[1], mtime
    try:
        text = path.read_text(encoding='utf-8')
    except OSError:
        return None, None
    _cache[str(path)] = (mtime, text)
    return text, mtime


def shell():
    text, _ = _read(site.frontend_dist_dir() / 'index.html')
    return text or FALLBACK_SHELL


def prerendered(path, fresh_after=None):
    """Prerendered HTML for a path (dist/prerender/<path>/index.html), if it exists and is newer than fresh_after."""
    rel = path.strip('/')
    if '..' in rel:
        return None
    file = site.frontend_dist_dir() / 'prerender' / rel / 'index.html'
    text, mtime = _read(file)
    if text is None:
        return None
    if fresh_after is not None and datetime.fromtimestamp(mtime, tz=dt_timezone.utc) < fresh_after:
        return None
    return text


# Tags the shell (or an older injection) may already have; replaced by the page's own.
_STRIP = [
    re.compile(r'<title>.*?</title>\s*', re.S | re.I),
    re.compile(r'<meta\s+name="(description|robots|twitter:[^"]+)"[^>]*>\s*', re.I),
    re.compile(r'<meta\s+property="(og:[^"]+|article:[^"]+)"[^>]*>\s*', re.I),
    re.compile(r'<link\s+rel="canonical"[^>]*>\s*', re.I),
    re.compile(r'<link\s+rel="alternate"\s+hreflang="[^"]*"[^>]*>\s*', re.I),
    re.compile(r'<script\s+type="application/ld\+json"[^>]*>.*?</script>\s*', re.S | re.I),
]


def _json_ld(node):
    # </script> can't appear inside the block
    return json.dumps(node, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')


def head_tags(meta):
    from .og_images import default_image
    if meta.image:
        image = (meta.image, meta.image_width, meta.image_height, meta.image_type)
    else:
        d = default_image()
        image = (d.url, d.width, d.height, d.type)
    og_title = meta.og_title or meta.title
    alt = meta.image_alt or og_title
    tags = [
        f'<title>{escape(meta.title)}</title>',
        f'<meta name="description" content="{escape(meta.description)}" data-seo>',
        f'<meta name="robots" content="{escape(meta.robots)}" data-seo>',
    ]
    if meta.canonical:
        tags.append(f'<link rel="canonical" href="{escape(meta.canonical)}" data-seo>')
    # Language versions of the page (blog translations): hreflang for search engines, og:locale:alternate below.
    tags += [f'<link rel="alternate" hreflang="{escape(a["hreflang"])}" href="{escape(a["href"])}" data-seo>'
             for a in meta.alternates]
    og = [
        ('og:type', meta.og_type), ('og:site_name', meta.site_name), ('og:title', og_title),
        ('og:description', meta.description), ('og:url', meta.canonical or ''), ('og:image', image[0]),
        ('og:image:secure_url', image[0] if image[0].startswith('https://') else ''),
        ('og:image:type', image[3] or ''), ('og:image:width', str(image[1] or '')), ('og:image:height', str(image[2] or '')),
        ('og:image:alt', alt), ('og:locale', meta.locale),
    ]
    og += [('og:locale:alternate', a['locale']) for a in meta.alternates if a.get('locale') and a['locale'] != meta.locale]
    if meta.og_type == 'article':
        from .jsonld import iso
        og += [('article:published_time', iso(meta.published) or ''), ('article:modified_time', iso(meta.modified) or '')]
    tags += [f'<meta property="{k}" content="{escape(v)}" data-seo>' for k, v in og if v]
    tw = [('twitter:card', 'summary_large_image'), ('twitter:title', og_title),
          ('twitter:description', meta.description), ('twitter:image', image[0]), ('twitter:image:alt', alt)]
    tags += [f'<meta name="{k}" content="{escape(v)}" data-seo>' for k, v in tw if v]
    tags += [f'<script type="application/ld+json" data-seo>{_json_ld(n)}</script>' for n in meta.jsonld if n]
    return '\n    '.join(tags)


def _set_lang(html, lang):
    """<html lang="…"> of the page (e.g. "ne" for a Nepali article), keeping the tag's other attributes."""
    def fix(m):
        tag = m.group(0)
        if re.search(r'\slang="[^"]*"', tag):
            return re.sub(r'\slang="[^"]*"', f' lang="{escape(lang)}"', tag, count=1)
        return tag[:5] + f' lang="{escape(lang)}"' + tag[5:]
    return re.sub(r'<html\b[^>]*>', fix, html, count=1, flags=re.I)


def inject(html, meta):
    for pattern in _STRIP:
        html = pattern.sub('', html)
    html = _set_lang(html, meta.lang)
    html = html.replace('</head>', f'    {head_tags(meta)}\n  </head>', 1)
    if meta.noscript:
        block = f'<noscript><div class="seo-noscript">{meta.noscript}</div></noscript>'
        if '<div id="root"></div>' in html:
            html = html.replace('<div id="root"></div>', f'<div id="root"></div>\n    {block}', 1)
        else:
            html = html.replace('</body>', f'{block}\n</body>', 1)
    return html


_VERIFICATION = re.compile(r'<meta\s+name="(google-site-verification|msvalidate\.01)"[^>]*>\s*', re.I)


def site_verification(html, tags):
    """Search Console / Bing Webmaster verification <meta> tags (Admin → Analytics, apps.site_analytics) right
    after <head>. Replaces any the HTML already carries (a prerendered copy), so the saved values always win."""
    html = _VERIFICATION.sub('', html)
    if tags:
        block = '\n    '.join(tags)
        html = re.sub(r'(<head\b[^>]*>)', lambda m: f'{m.group(1)}\n    {block}', html, count=1, flags=re.I)
    return html
