"""Link-preview images (og:image) for WhatsApp, Facebook, Messenger, Viber, X, LinkedIn…

Chat apps want a JPEG/PNG of about 1200×630 (1.91:1), small (WhatsApp skips images over ~300 KB), at an absolute
https URL they can fetch without cookies. So for every event / venue / vendor / blog post we write one JPEG under
MEDIA_ROOT/og/<kind>/<id>-<key>.jpg (served by Nginx at https://eventlaya.com/media/og/…):

  • its own banner / cover photo, centre-cropped to 1200×630, when it has one we store;
  • otherwise a branded card (title, date, venue on Eventlaya pink #C2215A, like the pass).

<key> is a hash of what the picture shows (banner file, or title/date/venue/status), so a new banner or a changed
date gives a new file name — and a new URL, which makes Facebook/WhatsApp fetch it again. Older files for the same
object are deleted when a new one is written. Generation happens on the first request (≈100 ms) and is cached on disk.
"""
import hashlib
import io
import logging
import textwrap
from dataclasses import dataclass
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from PIL import Image, ImageDraw, ImageFont, ImageOps

from apps.platform.models import EventCategory

from . import site

log = logging.getLogger(__name__)

WIDTH, HEIGHT = 1200, 630
MAX_BYTES = 300 * 1024
VERSION = 'v1'  # bump to regenerate every image after a design change
BRAND = (194, 33, 90)        # #C2215A
BRAND_DARK = (140, 20, 64)
WHITE = (255, 255, 255)
FONTS = Path(__file__).resolve().parent / 'fonts'


@dataclass
class OgImage:
    url: str
    width: int | None = WIDTH
    height: int | None = HEIGHT
    type: str | None = 'image/jpeg'
    alt: str = ''


def default_image(alt='Eventlaya — event registration, QR passes and gate check-in'):
    w, h = site.DEFAULT_IMAGE_SIZE
    return OgImage(url=f'{site.site_url()}{site.DEFAULT_IMAGE_PATH}', width=w, height=h, type='image/png', alt=alt)


def media_url(path):
    """Absolute URL of a stored file. Always the platform domain: it serves /media/ for every site."""
    url = default_storage.url(path)
    return url if url.startswith('http') else f'{site.site_url()}{url}'


def storage_path(url):
    """'uploads/venue/1/x.jpg' for '/media/uploads/venue/1/x.jpg' or 'https://eventlaya.com/media/…'; else None."""
    if not url or not isinstance(url, str):
        return None
    media = settings.MEDIA_URL or '/media/'
    if url.startswith(('http://', 'https://')):
        base = site.site_url()
        hosts = {base, base.replace('https://', 'https://api.'), base.replace('https://', 'https://www.')}
        for h in hosts:
            if url.startswith(h + media):
                return url[len(h + media):]
        return None
    if url.startswith(media):
        return url[len(media):]
    return None


def _key(*parts):
    return hashlib.sha1('|'.join([VERSION, *map(str, parts)]).encode()).hexdigest()[:12]


def _save_jpeg(img, path):
    for quality in (84, 76, 68, 60):
        buf = io.BytesIO()
        img.save(buf, 'JPEG', quality=quality, optimize=True, progressive=True)
        if buf.tell() <= MAX_BYTES:
            break
    if default_storage.exists(path):
        default_storage.delete(path)
    default_storage.save(path, ContentFile(buf.getvalue()))


def _cached(kind, obj_id, key, build):
    """Path of og/<kind>/<id>-<key>.jpg, building it with build() → PIL image when missing."""
    folder = f'og/{kind}'
    path = f'{folder}/{obj_id}-{key}.jpg'
    if default_storage.exists(path):
        return path
    img = build()
    _save_jpeg(img, path)
    try:  # drop older versions for this object
        _dirs, files = default_storage.listdir(folder)
        for name in files:
            if name.startswith(f'{obj_id}-') and name != path.rsplit('/', 1)[1]:
                default_storage.delete(f'{folder}/{name}')
    except (OSError, NotImplementedError):
        pass
    return path


def _cover(stored_path):
    with default_storage.open(stored_path, 'rb') as fh:
        img = Image.open(fh)
        img = ImageOps.exif_transpose(img)
        if img.mode in ('RGBA', 'LA', 'P'):
            img = img.convert('RGBA')
            bg = Image.new('RGB', img.size, WHITE)
            bg.paste(img, mask=img.split()[-1])
            img = bg
        else:
            img = img.convert('RGB')
        return ImageOps.fit(img, (WIDTH, HEIGHT), Image.Resampling.LANCZOS, centering=(0.5, 0.45))


def _photo_or_card(kind, obj_id, photo, alt, card):
    """og image from a stored photo path/URL, else the card. Never raises (falls back to the site image)."""
    try:
        # A stored file name ('events/banners/x.png'), a /media/… path or a URL on our own domain → our copy
        stored = storage_path(photo) if photo and photo.startswith(('/', 'http://', 'https://')) else (photo or None)
        if stored and default_storage.exists(stored):
            size = default_storage.size(stored)
            path = _cached(kind, obj_id, _key('photo', stored, size), lambda: _cover(stored))
            return OgImage(url=media_url(path), alt=alt)
        if photo and photo.startswith('https://') and stored is None:
            # A photo on another site (no copy here): use it as it is.
            return OgImage(url=photo, width=None, height=None, type=None, alt=alt)
    except Exception:  # unreadable / missing file → card
        log.exception('og image: could not use %s', photo)
    try:
        key = _key('card', *card.values())
        path = _cached(kind, obj_id, key, lambda: render_card(**card))
        return OgImage(url=media_url(path), alt=alt)
    except Exception:
        log.exception('og image: card failed for %s %s', kind, obj_id)
        return default_image(alt)


# ---------------------------------------------------------------------------
# Branded card
# ---------------------------------------------------------------------------

def _font(weight, size):
    try:
        return ImageFont.truetype(str(FONTS / f'Poppins-{weight}.ttf'), size)
    except OSError:
        return ImageFont.load_default(size)


def _wrap(draw, text, font, width, max_lines):
    words = (text or '').split()
    lines, line = [], ''
    for w in words:
        trial = f'{line} {w}'.strip()
        if draw.textlength(trial, font=font) <= width:
            line = trial
        else:
            if line:
                lines.append(line)
            line = w
            while draw.textlength(line, font=font) > width and len(line) > 1:  # one very long word
                cut = textwrap.shorten(line, width=max(4, len(line) - 2), placeholder='')
                line = cut if cut and cut != line else line[:-1]
    if line:
        lines.append(line)
    truncated = len(lines) > max_lines
    if truncated:
        lines = lines[:max_lines]
        last = lines[-1]
        while draw.textlength(last + '…', font=font) > width and ' ' in last:
            last = last.rsplit(' ', 1)[0]
        lines[-1] = last + '…'
    return lines, truncated


def _logo():
    path = site.frontend_dist_dir() / 'brand' / 'logo-white.png'
    if not path.exists():
        path = Path(settings.BASE_DIR).parent / 'frontend' / 'public' / 'brand' / 'logo-white.png'
    try:
        logo = Image.open(path).convert('RGBA')
        h = 58
        logo = logo.resize((round(logo.width * h / logo.height), h), Image.Resampling.LANCZOS)
        white = Image.new('RGBA', logo.size, WHITE + (255,))
        white.putalpha(logo.getchannel('A'))  # all-white wordmark: readable on the brand colour
        return white
    except OSError:
        return None


def render_card(title, line1='', line2='', eyebrow='', footer='', brand='', badge=''):
    """1200×630 card: brand colour, logo (or the white-label brand name), eyebrow, title, two detail lines, footer."""
    img = Image.new('RGB', (WIDTH, HEIGHT), BRAND)
    # Diagonal shade towards the bottom right
    shade = Image.new('L', (2, 2))
    shade.putdata([0, 70, 70, 150])
    shade = shade.resize((WIDTH, HEIGHT), Image.Resampling.BILINEAR)
    img = Image.composite(Image.new('RGB', (WIDTH, HEIGHT), BRAND_DARK), img, shade)
    draw = ImageDraw.Draw(img)

    # Ticket stub on the right, like the pass: perforation + a decorative QR-like grid
    stub_x = 900
    draw.rounded_rectangle((stub_x, 70, 1130, 560), radius=28, fill=WHITE)
    for y in range(92, 560, 34):
        draw.ellipse((stub_x - 9, y - 9, stub_x + 9, y + 9), fill=BRAND)
    seed = hashlib.sha1((title or 'eventlaya').encode()).digest()
    cell, gx, gy, n = 14, stub_x + 45, 140, 10
    for r in range(n):
        for c in range(n):
            finder = (r < 3 and c < 3) or (r < 3 and c >= n - 3) or (r >= n - 3 and c < 3)
            on = finder and not ((r in (1,) or r == n - 2) and (c in (1,) or c == n - 2)) if finder else \
                bool(seed[(r * n + c) % len(seed)] >> ((r + c) % 8) & 1)
            if on:
                draw.rectangle((gx + c * cell, gy + r * cell, gx + c * cell + cell - 2, gy + r * cell + cell - 2), fill=(28, 23, 36))
    stub_font = _font('Medium', 22)
    draw.text((stub_x + 115, 330), 'Show at the gate', font=stub_font, fill=BRAND, anchor='mm')
    draw.text((stub_x + 115, 500), (footer or site.site_url().replace('https://', ''))[:24], font=_font('Medium', 18),
              fill=(99, 90, 110), anchor='mm')

    x, maxw = 70, stub_x - 70 - 50
    y = 64
    logo = None if brand else _logo()
    if logo is not None:
        img.paste(logo, (x, y), logo)
        y += logo.height + 44
    else:
        draw.text((x, y), (brand or site.SITE_NAME)[:40], font=_font('Bold', 40), fill=WHITE)
        y += 50 + 44

    if badge or eyebrow:
        label_font = _font('Bold', 22)
        if badge:
            tw = draw.textlength(badge.upper(), font=label_font)
            draw.rounded_rectangle((x, y, x + tw + 32, y + 40), radius=20, fill=WHITE)
            draw.text((x + 16, y + 20), badge.upper(), font=label_font, fill=BRAND, anchor='lm')
            y += 62
        elif eyebrow:
            draw.text((x, y), eyebrow.upper()[:48], font=label_font, fill=(255, 220, 232))
            y += 46

    for size, lines_max in ((66, 2), (56, 3), (46, 3)):
        font = _font('Bold', size)
        lines, truncated = _wrap(draw, title, font, maxw, lines_max)
        if not truncated:
            break
    for line in lines:
        draw.text((x, y), line, font=font, fill=WHITE)
        y += int(size * 1.18)
    y += 24
    detail = _font('Medium', 30)
    for text, colour in ((line1, WHITE), (line2, (255, 225, 236))):
        if text:
            for line in _wrap(draw, text, detail, maxw, 1)[0]:
                draw.text((x, y), line, font=detail, fill=colour)
            y += 46
    return img


# ---------------------------------------------------------------------------
# Per page type
# ---------------------------------------------------------------------------

def for_event(ev, when, place, brand='', status_label='', host=''):
    """brand/host: the white-label site's name and domain (empty on eventlaya.com)."""
    card = {
        'title': ev.title, 'line1': when, 'line2': place, 'eyebrow': EventCategory.label(ev.category) or 'Event',
        'footer': host or site.site_url().replace('https://', ''),
        'brand': brand, 'badge': status_label,
    }
    if status_label:  # cancelled / ended: always the card, so the status is in the picture too
        try:
            path = _cached('events', ev.id, _key('card', *card.values()), lambda: render_card(**card))
            return OgImage(url=media_url(path), alt=f'{status_label}: {ev.title}')
        except Exception:
            log.exception('og image: card failed for event %s', ev.id)
            return default_image(ev.title)
    banner = ev.banner.name if ev.banner else ''
    return _photo_or_card('events', ev.id, banner, ev.title, card)


def for_venue(v):
    images = [i for i in (v.images or []) if isinstance(i, str)]
    card = {'title': v.name, 'line1': f'{v.get_venue_type_display()} · {v.city}',
            'line2': f'Up to {v.capacity_max:,} guests' if v.capacity_max else '', 'eyebrow': 'Venue',
            'footer': 'eventlaya.com/marketplace'}
    return _photo_or_card('venues', v.id, images[0] if images else '', v.name, card)


def for_vendor(v):
    images = [i for i in (v.portfolio_images or []) if isinstance(i, str)]
    category = v.category.name if v.category_id else 'Event services'
    card = {'title': v.business_name, 'line1': f'{category} · {v.city}', 'line2': '', 'eyebrow': 'Vendor',
            'footer': 'eventlaya.com/marketplace'}
    return _photo_or_card('vendors', v.id, images[0] if images else '', v.business_name, card)


def for_post(post):
    card = {'title': post.title, 'line1': f'{post.reading_minutes} min read · Eventlaya blog',
            'line2': ', '.join(post.cities[:3]), 'eyebrow': post.get_category_display(), 'footer': 'eventlaya.com/blog'}
    return _photo_or_card('blog', post.id, post.cover_image, post.cover_alt or post.title, card)
