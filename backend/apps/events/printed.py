"""Printed tickets (module `offline_tickets`): draw tickets with Pillow and lay them out as a print-ready PDF.

Each ticket is a real EventTicket with its own QR token, so the gate scanner (web and app, offline queue
included) checks it in like an online pass. The same renderer makes the design preview, so what the
organizer sees is what gets printed.
"""
import io
from decimal import Decimal

import qrcode
from django.conf import settings
from django.core.files.storage import default_storage
from PIL import Image, ImageDraw, ImageFont

DPI = 200
SIZES = {'landscape': (1600, 640), 'vertical': (640, 1280)}  # ticket pixels at DPI (about 20 × 8 cm / 8 × 16 cm)
A4 = (1654, 2339)  # A4 at DPI
MARGIN = 70
GAP = 36
COLUMNS = {'landscape': 1, 'vertical': 3}
MAX_PER_PDF = 500  # one download; bigger batches are split into parts (keeps memory and time small)

INK = (28, 23, 36)
MUTED = (107, 98, 117)
WHITE = (255, 255, 255)


def _font(size):
    return ImageFont.load_default(size=size)


def _rgb(hex_color, fallback=(194, 33, 90)):
    try:
        h = hex_color.lstrip('#')
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except (ValueError, AttributeError):
        return fallback


def _wrap(draw, text, font, width, max_lines):
    words, lines, line = text.split(), [], ''
    for w in words:
        test = f'{line} {w}'.strip()
        if draw.textlength(test, font=font) <= width or not line:
            line = test
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        while lines[-1] and draw.textlength(lines[-1] + '…', font=font) > width:
            lines[-1] = lines[-1][:-1]
        lines[-1] += '…'
    return lines


def _qr(token, size):
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=1, box_size=10)
    q.add_data(token)
    q.make(fit=True)
    return q.make_image(fill_color='black', back_color='white').convert('RGB').resize((size, size), Image.NEAREST)


def _artwork(url, size):
    """The organizer's uploaded artwork, cropped to fill the ticket; None when missing or unreadable."""
    prefix = settings.MEDIA_URL
    if not url or not url.startswith(prefix) or '..' in url:
        return None
    try:
        with default_storage.open(url[len(prefix):]) as f:
            img = Image.open(f).convert('RGB')
    except (OSError, ValueError):
        return None
    w, h = size
    scale = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    left, top = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((left, top, left + w, top + h))


def event_lines(event):
    when = event.start_date.strftime('%d %b %Y') if event.start_date else ''
    if event.start_time:
        when += f', {event.start_time.strftime("%I:%M %p").lstrip("0")}'
    return when, event.location


def price_text(price):
    price = Decimal(price or 0)
    return 'Free entry' if price == 0 else f'Rs {price:,.0f}'


class Design:
    """Everything needed to draw one batch: the design fields plus the event text."""

    def __init__(self, *, event, layout, template, color, background, qr_x, qr_y, qr_size, type_name, price):
        self.event = event
        self.layout = layout if layout in SIZES else 'landscape'
        self.template = template
        self.color = _rgb(color)
        self.background = background
        self.qr_x, self.qr_y, self.qr_size = qr_x, qr_y, qr_size
        self.type_name = type_name
        self.price = price
        self.size = SIZES[self.layout]
        self._base = None
        self._qr_box = None

    @classmethod
    def for_batch(cls, batch):
        return cls(
            event=batch.event, layout=batch.layout, template=batch.template, color=batch.color, background=batch.background,
            qr_x=batch.qr_x, qr_y=batch.qr_y, qr_size=batch.qr_size,
            type_name=batch.ticket_type.name if batch.ticket_type_id else '', price=batch.price,
        )

    # -- base: everything except the QR and the ticket number, drawn once per batch --------------------------

    def base(self):
        if self._base is None:
            self._base, self._qr_box = self._draw_base()
        return self._base

    def _draw_base(self):
        w, h = self.size
        vertical = self.layout == 'vertical'
        if self.template == 'custom':
            img = _artwork(self.background, self.size) or Image.new('RGB', self.size, (240, 238, 243))
            side = round(w * min(max(self.qr_size, 10), 60) / 100)
            cx, cy = round(w * self.qr_x / 100), round(h * self.qr_y / 100)
            box = (min(max(cx - side // 2, 0), w - side), min(max(cy - side // 2, 0), h - side - 40), side)
            return img, box

        bold = self.template == 'bold'
        img = Image.new('RGB', self.size, self.color if bold else WHITE)
        d = ImageDraw.Draw(img)
        text_c, muted_c = (WHITE, (255, 230, 238)) if bold else (INK, MUTED)
        # Stub that holds the QR: right side (landscape) or bottom (vertical)
        stub = round(w * 0.32) if not vertical else round(h * 0.42)
        if self.template == 'classic':
            if vertical:
                d.rectangle((0, h - stub, w, h), fill=self.color)
            else:
                d.rectangle((w - stub, 0, w, h), fill=self.color)
        if self.template == 'minimal':
            d.rectangle((6, 6, w - 7, h - 7), outline=self.color, width=6)
        # Tear line between body and stub
        dash = (200, 200, 205) if self.template != 'classic' else (255, 255, 255)
        if vertical:
            for x in range(30, w - 30, 28):
                d.line((x, h - stub, x + 14, h - stub), fill=dash, width=3)
        else:
            for y in range(30, h - 30, 28):
                d.line((w - stub, y, w - stub, y + 14), fill=dash, width=3)

        # Body text
        pad = 56
        body_w = (w if vertical else w - stub) - 2 * pad
        y = pad
        d.text((pad, y), 'ADMIT ONE', font=_font(26), fill=self.color if not bold else WHITE)
        y += 48
        title_font = _font(64 if not vertical else 54)
        for line in _wrap(d, self.event.title, title_font, body_w, 2):
            d.text((pad, y), line, font=title_font, fill=text_c)
            y += 72 if not vertical else 62
        y += 12
        when, venue = event_lines(self.event)
        for line in (when, venue):
            if line:
                for part in _wrap(d, line, _font(32), body_w, 1):
                    d.text((pad, y), part, font=_font(32), fill=muted_c)
                y += 46
        label = ' · '.join(x for x in (self.type_name, price_text(self.price)) if x)
        if label:
            d.text((pad, (h - stub if vertical else h) - pad - 44), label, font=_font(40), fill=text_c)

        # QR tile inside the stub
        if vertical:
            side = min(w - 200, stub - 140)
            box = ((w - side) // 2, h - stub + 50, side)
        else:
            side = min(stub - 110, h - 170)
            box = (w - stub + (stub - side) // 2, 60, side)
        x, y0, side = box
        d.rounded_rectangle((x - 16, y0 - 16, x + side + 16, y0 + side + 16), radius=20, fill=WHITE)
        return img, box

    # -- one ticket ------------------------------------------------------------------------------------------

    def ticket(self, number, token):
        img = self.base().copy()
        x, y, side = self._qr_box
        img.paste(_qr(token, side), (x, y))
        d = ImageDraw.Draw(img)
        font = _font(30)
        tw = d.textlength(number, font=font)
        tx = x + (side - tw) / 2
        ty = y + side + 14
        if self.template == 'custom':
            d.rectangle((tx - 10, ty - 6, tx + tw + 10, ty + 38), fill=WHITE)
            d.text((tx, ty), number, font=font, fill=INK)
        else:
            on_color = self.template in ('classic', 'bold')
            d.text((tx, ty + 8), number, font=font, fill=WHITE if on_color else INK)
        return img


def preview_png(design):
    out = io.BytesIO()
    design.ticket('TKT-SAMPLE-0001', 'sample-preview-not-valid').save(out, 'PNG')
    return out.getvalue()


def _qr_modules(token):
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=1)
    q.add_data(token)
    q.make(fit=True)
    return q.get_matrix()


def _draw_ticket(c, design, base, number, token, x, y, w, h):
    """One ticket at (x, y) (bottom-left, points) and w × h: the shared design image plus a vector QR and number."""
    c.drawImage(base, x, y, w, h)
    px = w / design.size[0]  # points per design pixel
    qx, qy, side = design._qr_box
    side_pt = side * px
    left = x + qx * px
    top = y + h - qy * px
    m = _qr_modules(token)
    cell = side_pt / len(m)
    c.setFillColorRGB(0, 0, 0)
    for r, row in enumerate(m):
        run = None
        for col, on in enumerate(row + [False]):
            if on and run is None:
                run = col
            elif not on and run is not None:
                c.rect(left + run * cell, top - (r + 1) * cell, (col - run) * cell, cell, stroke=0, fill=1)
                run = None
    font = min(max(side_pt * 0.1, 6), 11)  # ticket number, sized to the QR
    tw = c.stringWidth(number, 'Helvetica', font)
    # Below the white tile around the QR (16 design px) on ready-made designs
    ty = top - side_pt - (3 if design.template == 'custom' else 16 * px + 3) - font
    if design.template == 'custom':
        c.setFillColorRGB(1, 1, 1)
        c.rect(left + (side_pt - tw) / 2 - 3, ty - 2, tw + 6, font + 4, stroke=0, fill=1)
        c.setFillColorRGB(*[v / 255 for v in INK])
    elif design.template in ('classic', 'bold'):
        c.setFillColorRGB(1, 1, 1)
    else:
        c.setFillColorRGB(*[v / 255 for v in INK])
    c.setFont('Helvetica', font)
    c.drawString(left + (side_pt - tw) / 2, ty, number)


def build_pdf(design, tickets, per_page='sheet'):
    """PDF bytes for [(ticket_number, qr_token)]. The design image is embedded once and reused on every
    ticket; QR codes are vector, so 500 tickets stay a few MB and render in seconds."""
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas as pdf_canvas

    buf = io.BytesIO()
    img = io.BytesIO()
    base = design.base()
    if design.template == 'custom':
        base.save(img, 'JPEG', quality=88)
    else:
        base.save(img, 'PNG', optimize=True)
    img.seek(0)
    base_reader = ImageReader(img)
    tw, th = design.size
    pt = 72 / DPI

    if per_page == 'single':
        m = MARGIN * pt
        w, h = tw * pt, th * pt
        c = pdf_canvas.Canvas(buf, pagesize=(w + 2 * m, h + 2 * m))
        for number, token in tickets:
            _draw_ticket(c, design, base_reader, number, token, m, m, w, h)
            c.showPage()
    else:
        page_w, page_h = A4[0] * pt, A4[1] * pt
        margin, gap = MARGIN * pt, GAP * pt
        cols = COLUMNS[design.layout]
        cell_w = (page_w - 2 * margin - (cols - 1) * gap) / cols
        cell_h = th * cell_w / tw
        rows = max(1, int((page_h - 2 * margin + gap) // (cell_h + gap)))
        per = cols * rows
        c = pdf_canvas.Canvas(buf, pagesize=(page_w, page_h))
        for start in range(0, len(tickets), per):
            for i, (number, token) in enumerate(tickets[start:start + per]):
                r, col = divmod(i, cols)
                x = margin + col * (cell_w + gap)
                y = page_h - margin - (r + 1) * cell_h - r * gap
                _draw_ticket(c, design, base_reader, number, token, x, y, cell_w, cell_h)
                # Cut line
                c.setStrokeColorRGB(0.72, 0.72, 0.75)
                c.setLineWidth(0.5)
                c.setDash(3, 3)
                c.rect(x - 3, y - 3, cell_w + 6, cell_h + 6, stroke=1, fill=0)
                c.setDash()
            c.showPage()
    c.save()
    return buf.getvalue()
