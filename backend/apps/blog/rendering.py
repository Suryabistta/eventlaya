"""Markdown → safe HTML for blog posts (rendered on save, sanitized with nh3).

Only superadmins write posts, but the HTML is still sanitized: it is served to every visitor and injected
into server-rendered pages for crawlers.
"""
import math
import re

import markdown
import nh3
from django.utils.text import slugify

ALLOWED_TAGS = {
    'h2', 'h3', 'h4', 'p', 'a', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'blockquote', 'code', 'pre', 'hr', 'br',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'figure', 'figcaption', 'del', 'sup', 'sub',
}
ALLOWED_ATTRIBUTES = {
    'a': {'href', 'title'},
    'img': {'src', 'alt', 'title', 'width', 'height'},
    'h2': {'id'}, 'h3': {'id'}, 'h4': {'id'},
    'th': {'align'}, 'td': {'align'},
}
WORDS_PER_MINUTE = 200


# Devanagari letters and vowel signs (Python's \w misses the combining vowel signs), without the danda marks.
DEVANAGARI = '\u0900-\u0963\u0966-\u097F'
_WORD = re.compile(rf'[\w{DEVANAGARI}]+')


def _slugify_heading(value, separator='-'):
    """Heading ids: ASCII slugs for English ("how-much-does-it-cost"), Devanagari kept for Nepali headings."""
    if value.isascii():
        return slugify(value) or 'section'
    value = re.sub(rf'[^\w\s{DEVANAGARI}-]', '', value.lower())
    return re.sub(r'[-\s]+', '-', value).strip('-_') or 'section'


def render_markdown(body):
    """{'html', 'toc': [{'id', 'title', 'level'}], 'word_count', 'reading_minutes'} for a Markdown body.

    `#` (H1) in the body is demoted to H2: the post title is the page's only H1.
    """
    body = body or ''
    body = re.sub(r'(?m)^#(?!#)\s', '## ', body)
    md = markdown.Markdown(
        extensions=['extra', 'sane_lists', 'toc'],
        extension_configs={'toc': {'slugify': _slugify_heading, 'toc_depth': '2-3'}},
        output_format='html',
    )
    raw = md.convert(body)
    html = nh3.clean(
        raw, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRIBUTES, url_schemes={'http', 'https', 'mailto', 'tel'},
        link_rel=None,
    )
    # External links open safely; images load lazily without layout jank.
    html = re.sub(r'<a href="(https?://[^"]+)"', r'<a href="\1" rel="noopener" target="_blank"', html)
    html = html.replace('<img ', '<img loading="lazy" decoding="async" ')
    html = html.replace('<table>', '<div class="table-wrap"><table>').replace('</table>', '</table></div>')

    toc = []

    def walk(tokens):
        for t in tokens:
            if t['level'] in (2, 3):
                toc.append({'id': t['id'], 'title': nh3.clean(t['name'], tags=set()), 'level': t['level']})
            walk(t.get('children', []))
    walk(getattr(md, 'toc_tokens', []))

    text = nh3.clean(raw, tags=set())
    words = len(_WORD.findall(text))
    return {
        'html': html,
        'toc': toc,
        'word_count': words,
        'reading_minutes': max(1, math.ceil(words / WORDS_PER_MINUTE)),
    }


def plain_text(html):
    """Visible text of rendered HTML (for llms-full.txt and search)."""
    return re.sub(r'\s+', ' ', nh3.clean(html or '', tags=set())).strip()
