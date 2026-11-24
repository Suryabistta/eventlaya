"""One look for every email Eventlaya sends.

    send_branded(to, subject, event=event, title='You're registered', name='Sita',
                 paragraphs=['Your registration is confirmed.'], details=[('When', '…')],
                 button=('View pass', url))

Builds a plain-text and an HTML version from the same content. The HTML is table-based with inline styles so it
reads the same in Gmail, Outlook and phone mail apps. Events of a live white-label organizer get the organizer's
name, logo, colour and support address; everything else is Eventlaya's.
"""
import datetime
import logging
import re
from dataclasses import dataclass

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.utils.html import escape

logger = logging.getLogger(__name__)

BRAND_COLOR = '#C2215A'  # Laliguras, same as the website
INK = '#1C1724'
MUTED = '#635A6E'
LINE = '#E7E2EB'
PAPER = '#FAF8FB'
_HEX = re.compile(r'^#[0-9a-fA-F]{6}$')


@dataclass
class Brand:
    name: str = 'Eventlaya'
    logo: str = ''
    color: str = BRAND_COLOR
    powered: bool = False  # show "Powered by Eventlaya" (white-label without the watermark removed)
    reply_to: str = ''
    site: str = ''

    @property
    def is_eventlaya(self):
        return self.name == 'Eventlaya'


def _site():
    return getattr(settings, 'FRONTEND_URL', 'https://eventlaya.com').rstrip('/')


def _site_logo():
    """The logo the superadmin uploaded in Site branding (what the website shows), else the built-in one."""
    try:
        from apps.platform.models import SiteBranding
        logo = (SiteBranding.objects.filter(pk=1).values_list('logo', flat=True).first() or '').strip()
    except Exception:  # no table yet (fresh database) or DB trouble: never block an email over a logo
        logo = ''
    if logo.startswith('/'):
        logo = _site() + logo
    return logo if logo.startswith('https://') else f'{_site()}/brand/logo.png'


def eventlaya_brand():
    return Brand(logo=_site_logo(), site=_site(), reply_to=getattr(settings, 'EMAIL_REPLY_TO', ''))


def _from_branding(b, fallback_name, site):
    logo = (b.brand_logo or '').strip()
    if logo.startswith('/'):
        logo = site + logo
    return Brand(
        name=b.brand_name or fallback_name or 'Eventlaya',
        logo=logo if logo.startswith('https://') else '',
        color=b.primary_color if _HEX.match(b.primary_color or '') else BRAND_COLOR,
        powered=not b.remove_watermark,
        reply_to=b.support_email or getattr(settings, 'EMAIL_REPLY_TO', ''),
        site=site,
    )


def brand_for(event=None):
    """The event's white-label look when its organizer has a live one, else Eventlaya's."""
    if event is None:
        return eventlaya_brand()
    from apps.accounts.tenancy import live_branding_for_organizer
    from .email import site_url
    b = live_branding_for_organizer(event.organizer)
    if b is None:
        return eventlaya_brand()
    return _from_branding(b, event.organizer.organization_name, site_url(event))


def brand_for_request(request):
    """Account emails (verification, password reset) asked for on a client's own site carry that client's look,
    and their links go back to that site. Anywhere else: Eventlaya."""
    from apps.accounts.tenancy import public_host, tenant_for_request
    tenant = tenant_for_request(request) if request is not None else None
    host = public_host(tenant) if tenant is not None else None
    if not host:
        return eventlaya_brand()
    return _from_branding(tenant, tenant.organizer.organization_name, f'https://{host}')


def from_address(brand):
    """'Dharan Film Festival via Eventlaya <passes@eventlaya.com>' for a client's brand (same mailbox)."""
    from email.utils import formataddr, parseaddr
    default = settings.DEFAULT_FROM_EMAIL
    if brand.is_eventlaya:
        return default
    return formataddr((f'{brand.name} via Eventlaya', parseaddr(default)[1] or 'passes@eventlaya.com'))


def event_when(event):
    """'Sat, 14 Mangsir 2083 · 6:00 PM' in BS (what people in Nepal read), or 'Date to be announced'."""
    from .bs import bs_text
    if getattr(event, 'date_tba', False) or not event.start_date:
        return 'Date to be announced'
    day = event.start_date
    if isinstance(day, str):
        day = datetime.date.fromisoformat(day)
    out = bs_text(day, weekday=True)
    t = event.start_time
    if isinstance(t, str) and t:
        t = datetime.time.fromisoformat(t)
    if t:
        out += ' · ' + t.strftime('%I:%M %p').lstrip('0')
    return out


def _p(text, color=INK, size=15, extra=''):
    return (f'<p style="margin:0 0 14px;font-size:{size}px;line-height:1.6;color:{color};{extra}">'
            f'{escape(text).replace(chr(10), "<br>")}</p>')


def _button(label, url, color):
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>'
            f'<td style="border-radius:10px;background:{color};">'
            f'<a href="{escape(url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;'
            f'color:#ffffff;text-decoration:none;border-radius:10px;">{escape(label)}</a></td></tr></table>')


def render(*, brand, title, preheader='', name=None, paragraphs=(), code=None, code_label='', details=(),
           items=(), button=None, after=(), links=()):
    """(text, html). `details`: [(label, value)] rows; `items`: [(title, subtitle, (button label, url))] rows
    (one per pass in an order); `after`: smaller paragraphs under the button; `links`: [(label, url)] footer links."""
    c = brand.color
    # ── plain text
    t = []
    if name:
        t.append(f'Namaste {name},')
    t += list(paragraphs)
    if code:
        t.append(f'{code_label + ": " if code_label else ""}{code}')
    if details:
        width = max(len(k) for k, _ in details)
        t.append('\n'.join(f'{k.ljust(width)} : {v}' for k, v in details))
    for it_title, it_sub, it_btn in items:
        t.append(f'{it_title}\n{it_sub}' + (f'\n{it_btn[0]}: {it_btn[1]}' if it_btn else ''))
    if button:
        t.append(f'{button[0]}: {button[1]}')
    t += list(after)
    t += [f'{label}: {url}' for label, url in links]
    t.append(brand.name + ('\nPowered by Eventlaya' if brand.powered else ''))
    text = '\n\n'.join(x for x in t if x) + '\n'

    # ── HTML
    header = (f'<img src="{escape(brand.logo)}" alt="{escape(brand.name)}" height="36" '
              f'style="display:block;height:36px;width:auto;border:0;">' if brand.logo else
              f'<span style="font-size:20px;font-weight:800;color:{c};">{escape(brand.name)}</span>')
    body = [f'<h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;font-weight:800;color:{INK};">{escape(title)}</h1>']
    if name:
        body.append(_p(f'Namaste {name},'))
    body += [_p(x) for x in paragraphs]
    if code:
        body.append(
            f'<div style="margin:6px 0 20px;padding:18px;border-radius:12px;background:{PAPER};border:1px dashed #D3CCD9;text-align:center;">'
            + (f'<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:{MUTED};font-weight:700;">{escape(code_label)}</div>' if code_label else '')
            + f'<div style="font-size:28px;letter-spacing:.12em;font-weight:800;color:{INK};font-family:Menlo,Consolas,monospace;margin-top:4px;">{escape(code)}</div></div>')
    if details:
        rows = ''.join(
            f'<tr><td style="padding:10px 0;border-bottom:1px solid {LINE};font-size:14px;color:{MUTED};vertical-align:top;">{escape(k)}</td>'
            f'<td style="padding:10px 0 10px 12px;border-bottom:1px solid {LINE};font-size:14px;color:{INK};font-weight:600;text-align:right;">'
            f'{escape(str(v))}</td></tr>' for k, v in details)
        body.append(f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;border-top:1px solid {LINE};">{rows}</table>')
    if items:
        rows = ''.join(
            f'<tr><td style="padding:12px 0;border-bottom:1px solid {LINE};"><div style="font-size:15px;font-weight:700;color:{INK};">{escape(a)}</div>'
            f'<div style="font-size:13px;color:{MUTED};">{escape(b)}</div></td>'
            f'<td style="padding:12px 0 12px 12px;border-bottom:1px solid {LINE};text-align:right;white-space:nowrap;">'
            + (f'<a href="{escape(btn[1])}" style="display:inline-block;padding:8px 14px;border-radius:8px;background:{c};color:#ffffff;'
               f'font-size:13px;font-weight:700;text-decoration:none;">{escape(btn[0])}</a>' if btn else '')
            + '</td></tr>' for a, b, btn in items)
        body.append(f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;border-top:1px solid {LINE};">{rows}</table>')
    if button:
        body.append(_button(button[0], button[1], c))
    body += [_p(x, color=MUTED, size=13) for x in after]

    foot = []
    if links:
        foot.append(' · '.join(f'<a href="{escape(u)}" style="color:{MUTED};text-decoration:underline;">{escape(l)}</a>' for l, u in links))
    if brand.is_eventlaya:
        foot.append('Eventlaya · Events, tickets and venues in Nepal')
    else:
        foot.append(escape(brand.name) + (' · Powered by <a href="https://eventlaya.com" style="color:' + MUTED + ';">Eventlaya</a>' if brand.powered else ''))
    if brand.reply_to:
        foot.append(f'Questions? Just reply to this email or write to <a href="mailto:{escape(brand.reply_to)}" style="color:{MUTED};">{escape(brand.reply_to)}</a>.')

    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>{escape(title)}</title></head>
<body style="margin:0;padding:0;background:{PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{escape(preheader or title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{PAPER};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 4px 18px;">{header}</td></tr>
<tr><td style="background:#ffffff;border-radius:16px;border:1px solid {LINE};border-top:4px solid {c};padding:28px 26px 12px;">
{''.join(body)}
</td></tr>
<tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.6;color:{MUTED};text-align:center;">{'<br>'.join(foot)}</td></tr>
</table></td></tr></table></body></html>"""
    return text, html


def send_branded(to, subject, *, event=None, brand=None, from_email=None, reply_to=None, fail_silently=True, **content):
    """Render and send one email. Returns True when it was handed to the mail server."""
    if not to:
        return False
    brand = brand or brand_for(event)
    if from_email is None:
        from_email = from_address(brand)
    text, html = render(brand=brand, **content)
    msg = EmailMultiAlternatives(subject, text, from_email, [to] if isinstance(to, str) else list(to),
                                 reply_to=reply_to or ([brand.reply_to] if brand.reply_to else None))
    msg.attach_alternative(html, 'text/html')
    try:
        return bool(msg.send(fail_silently=fail_silently))
    except Exception as e:
        logger.warning('Email %r to %s failed: %s', subject, to, e)
        return False
