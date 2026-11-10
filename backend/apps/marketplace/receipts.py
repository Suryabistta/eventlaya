"""Booking receipts as PDF (docs/plan-2026-11-bookings-and-bs.md): the business, the customer, the booked date and slot,
the agreed amount, every payment recorded and the balance. Dates in BS (apps.core.bs) with the AD date alongside.

GET /api/marketplace/my/bookings/<kind>/<id>/receipt/   the business (owner)
GET /api/me/inquiries/<kind>/<id>/receipt/              the customer
"""
import io
from decimal import Decimal

from django.http import HttpResponse
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.bs import bs_text
from .bookings import _qs, booking_date
from .models import VendorInquiry, VenueInquiry
from .views import HasMarketplaceAccess

INK = (0.11, 0.09, 0.14)
MUTED = (0.42, 0.38, 0.46)
BRAND = (0.76, 0.13, 0.35)


def _rs(v):
    return f'Rs {Decimal(v or 0):,.2f}'.replace('.00', '')


def receipt_pdf(b, kind):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    listing = b.venue if kind == 'venue' else b.vendor
    name = listing.name if kind == 'venue' else listing.business_name
    phone = (listing.contact_phone if kind == 'venue' else listing.phone) or ''
    email = (listing.contact_email if kind == 'venue' else listing.email) or ''
    address = ', '.join(x for x in [getattr(listing, 'address', ''), listing.city] if x)
    payments = list(b.payments.all())
    paid = sum((p.amount for p in payments), Decimal('0'))
    agreed = b.agreed_amount
    balance = None if agreed is None else agreed - paid

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    x, y = 56, h - 64

    def text(s, size=10, bold=False, color=INK, at_x=None, right=False):
        c.setFillColorRGB(*color)
        c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
        if right:
            c.drawRightString(w - 56, y, s)
        else:
            c.drawString(at_x if at_x is not None else x, y, s)

    text(name, 18, bold=True)
    text('RECEIPT', 12, bold=True, color=BRAND, right=True)
    y -= 16
    for line in [address, ' · '.join(v for v in [phone, email] if v)]:
        if line:
            text(line, 9, color=MUTED)
            y -= 13
    y -= 4
    text(f'Receipt for booking {str(b.id)[:8].upper()} · issued {bs_text(timezone.localdate())}', 9, color=MUTED)
    y -= 28

    day = booking_date(b)
    slot = b.slot
    when = 'Whole day' if not slot or slot.start_time is None else f'{slot.start_time:%I:%M %p} – {slot.end_time:%I:%M %p}'.replace(' 0', ' ')
    space = (b.space.name if kind == 'venue' and b.space_id else (slot.space.name if slot and slot.space_id else ''))
    rows = [
        ('Customer', b.sender_name),
        ('Phone', b.sender_phone),
        ('Email', b.sender_email or '–'),
        ('Booked for', f'{bs_text(day, weekday=True)} ({day:%d %b %Y})' if day else '–'),
        ('Time', when),
    ]
    if space:
        rows.append(('Space', space))
    if b.event_type:
        rows.append(('For', b.event_type))
    for k, v in rows:
        text(k, 10, color=MUTED)
        text(str(v)[:80], 10, at_x=x + 110)
        y -= 16

    y -= 14
    c.setStrokeColorRGB(0.85, 0.84, 0.87)
    c.line(x, y + 6, w - 56, y + 6)
    y -= 12
    text('Payments received', 11, bold=True)
    y -= 18
    if not payments:
        text('None recorded yet', 10, color=MUTED)
        y -= 16
    for p in payments:
        text(f'{bs_text(p.received_on)}  ·  {p.get_method_display()}' + (f'  ·  {p.note[:50]}' if p.note else ''), 10)
        text(_rs(p.amount), 10, right=True)
        y -= 16
        if y < 120:
            c.showPage()
            y = h - 64
    y -= 8
    c.line(x, y + 6, w - 56, y + 6)
    y -= 12
    for label, value, bold in [('Agreed amount', _rs(agreed) if agreed is not None else 'Not set', False),
                               ('Paid', _rs(paid), False),
                               ('Balance due', _rs(max(balance, 0)) if balance is not None else '–', True)]:
        text(label, 11 if bold else 10, bold=bold)
        text(value, 11 if bold else 10, bold=bold, right=True)
        y -= 18
    y -= 20
    status_line = 'Cancelled' if b.status == VenueInquiry.Status.CANCELLED else ('Completed' if b.completed_at else 'Confirmed')
    text(f'Booking status: {status_line}. Payments are recorded by {name}; this receipt is not a tax invoice.', 8, color=MUTED)
    y -= 12
    text('Generated with Eventlaya · eventlaya.com', 8, color=MUTED)
    c.save()
    return buf.getvalue()


def _pdf_response(b, kind):
    resp = HttpResponse(receipt_pdf(b, kind), content_type='application/pdf')
    resp['Content-Disposition'] = f'attachment; filename="receipt-{str(b.id)[:8]}.pdf"'
    return resp


class OwnerReceiptView(APIView):
    permission_classes = [HasMarketplaceAccess]

    def get(self, request, kind, pk):
        b = _qs(kind, request.user).filter(pk=pk).first() if kind in ('venue', 'vendor') else None
        if b is None:
            return Response({'error': 'Booking not found.'}, status=status.HTTP_404_NOT_FOUND)
        return _pdf_response(b, kind)


class CustomerReceiptView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, kind, pk):
        model = VenueInquiry if kind == 'venue' else VendorInquiry if kind == 'vendor' else None
        b = model.objects.filter(pk=pk, user=request.user).first() if model else None
        if b is None or b.status not in (VenueInquiry.Status.BOOKED, VenueInquiry.Status.CANCELLED):
            return Response({'error': 'Booking not found.'}, status=status.HTTP_404_NOT_FOUND)
        return _pdf_response(b, kind)
