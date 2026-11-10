"""Booking management for vendors and venues (docs/plan-2026-11-bookings-and-bs.md).

A booking is a VenueInquiry / VendorInquiry with status `booked` (from a customer's request, or added by the owner:
source `manual`). On top of the request flow in booking.py this adds the agreed amount, payments received outside
Eventlaya (BookingPayment), marking it completed, the owner cancelling, and manual bookings that block a slot.

GET    /api/marketplace/my/bookings/?filter=upcoming|past|unpaid|completed|cancelled|all&q=
POST   /api/marketplace/my/bookings/                             manual booking
GET    /api/marketplace/my/bookings/<kind>/<id>/                 kind = venue | vendor
PATCH  /api/marketplace/my/bookings/<kind>/<id>/                 {agreed_amount, owner_note}
POST   /api/marketplace/my/bookings/<kind>/<id>/payments/        {amount, method, received_on, note}
DELETE /api/marketplace/my/bookings/<kind>/<id>/payments/<pid>/
POST   /api/marketplace/my/bookings/<kind>/<id>/complete/        (on or after the booked day)
POST   /api/marketplace/my/bookings/<kind>/<id>/cancel/          {note}: frees the slot
"""
import datetime
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .booking import Conflict, change_request_status, find_conflicts, listing_filter, today
from .models import AvailabilitySlot, BookingPayment, VendorInquiry, VendorProfile, VenueInquiry, VenueListing, VenueSpace
from .views import HasMarketplaceAccess

S = VenueInquiry.Status
Slot = AvailabilitySlot


def _qs(kind, user):
    if kind == 'venue':
        return VenueInquiry.objects.select_related('venue', 'space', 'slot', 'slot__space').filter(venue__owner=user)
    return VendorInquiry.objects.select_related('vendor', 'slot').filter(vendor__user=user)


def booking_date(b):
    return b.slot.date if b.slot_id else b.event_date


def money(v):
    return None if v is None else str(v)


def booking_data(b, kind, detail=False):
    paid = Decimal(b.payments.aggregate(total=Sum('amount'))['total'] or 0).quantize(Decimal('0.01'))
    agreed = b.agreed_amount
    balance = None if agreed is None else agreed - paid
    if b.status == S.CANCELLED or b.status == S.REJECTED:
        state = 'cancelled'
    elif b.completed_at:
        state = 'completed'
    else:
        state = 'upcoming' if (booking_date(b) or today()) >= today() else 'past'
    payment = 'unpaid' if paid == 0 else ('paid' if balance is not None and balance <= 0 else 'part_paid')
    slot = b.slot
    data = {
        'id': str(b.id), 'kind': kind, 'source': b.source, 'status': b.status, 'state': state, 'payment_state': payment,
        'listing': b.venue.name if kind == 'venue' else b.vendor.business_name,
        'listing_id': str(b.venue_id if kind == 'venue' else b.vendor_id),
        'space': (b.space.name if b.space_id else (slot.space.name if slot and slot.space_id else None)) if kind == 'venue' else None,
        'date': booking_date(b), 'start_time': slot.start_time if slot else None, 'end_time': slot.end_time if slot else None,
        'customer': {'name': b.sender_name, 'email': b.sender_email, 'phone': b.sender_phone},
        'event_type': b.event_type, 'agreed_amount': money(agreed), 'paid': str(paid), 'balance': money(balance),
        'owner_note': b.owner_note, 'completed_at': b.completed_at, 'created_at': b.created_at,
    }
    if detail:
        data['message'] = b.message
        data['guest_count'] = getattr(b, 'guest_count', None)
        data['payments'] = [
            {'id': str(p.id), 'amount': str(p.amount), 'method': p.method, 'method_label': p.get_method_display(),
             'received_on': p.received_on, 'note': p.note, 'created_at': p.created_at}
            for p in b.payments.all()
        ]
    return data


def _amount(value, field='amount', allow_none=False):
    if value in (None, '') and allow_none:
        return None
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise Conflict(f'Enter a valid {field.replace("_", " ")}.', 'invalid')
    if d < 0 or d > Decimal('100000000'):
        raise Conflict(f'Enter a valid {field.replace("_", " ")}.', 'invalid')
    return d.quantize(Decimal('0.01'))


class BookingListView(APIView):
    permission_classes = [HasMarketplaceAccess]

    def get(self, request):
        f = request.query_params.get('filter', 'upcoming')
        q = (request.query_params.get('q') or '').strip().lower()
        statuses = [S.BOOKED, S.CANCELLED] if f in ('cancelled', 'all') else [S.BOOKED]
        rows = []
        for kind in ('venue', 'vendor'):
            for b in _qs(kind, request.user).filter(status__in=statuses).prefetch_related('payments'):
                d = booking_data(b, kind)
                if q and q not in f"{d['customer']['name']} {d['customer']['phone']} {d['customer']['email']} {d['listing']}".lower():
                    continue
                keep = {
                    'upcoming': d['state'] == 'upcoming',
                    'past': d['state'] in ('past', 'completed'),
                    'unpaid': d['state'] != 'cancelled' and d['payment_state'] != 'paid',
                    'completed': d['state'] == 'completed',
                    'cancelled': d['state'] == 'cancelled',
                    'all': True,
                }.get(f, True)
                if keep:
                    rows.append(d)
        rows.sort(key=lambda d: (d['date'] or datetime.date.max), reverse=f in ('past', 'completed', 'cancelled'))
        live = [d for d in rows if d['state'] != 'cancelled']
        totals = {
            'count': len(rows),
            'booked_value': str(sum((Decimal(d['agreed_amount']) for d in live if d['agreed_amount']), Decimal('0'))),
            'received': str(sum((Decimal(d['paid']) for d in live), Decimal('0'))),
            'due': str(sum((max(Decimal(d['balance']), Decimal('0')) for d in live if d['balance'] is not None), Decimal('0'))),
        }
        return Response({'results': rows, 'totals': totals})

    def post(self, request):
        """Manual booking (phone or walk-in): blocks the slot like a confirmed request."""
        d = request.data
        kind = d.get('kind')
        if kind not in ('venue', 'vendor'):
            return Response({'error': 'kind must be venue or vendor.'}, status=status.HTTP_400_BAD_REQUEST)
        model = VenueListing if kind == 'venue' else VendorProfile
        owner = {'owner': request.user} if kind == 'venue' else {'user': request.user}
        listing = get_object_or_404(model, pk=d.get('listing_id'), **owner)
        name = (d.get('name') or '').strip()[:100]
        phone = (d.get('phone') or '').strip()[:30]
        if not name or not phone:
            return Response({'error': 'Enter the customer’s name and phone.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            day = datetime.date.fromisoformat(str(d.get('date')))
            start = datetime.time.fromisoformat(d['start_time']) if d.get('start_time') else None
            end = datetime.time.fromisoformat(d['end_time']) if d.get('end_time') else None
        except ValueError:
            return Response({'error': 'Enter a valid date and times.'}, status=status.HTTP_400_BAD_REQUEST)
        if (start is None) != (end is None) or (start and end <= start):
            return Response({'error': 'Pick both times (end after start), or leave both empty for the whole day.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if day < today():
            return Response({'error': 'The date has passed.'}, status=status.HTTP_400_BAD_REQUEST)
        space = None
        if kind == 'venue' and d.get('space_id'):
            space = get_object_or_404(VenueSpace, pk=d['space_id'], venue=listing)
        agreed = _amount(d.get('agreed_amount'), 'agreed_amount', allow_none=True)
        with transaction.atomic():
            slots = list(Slot.objects.select_for_update().filter(**listing_filter(listing), date=day))
            same = [s for s in slots if s.start_time == start and s.end_time == end and s.space_id == (space.pk if space else None)]
            if same and same[0].status == Slot.Status.OPEN:
                slot = same[0]  # the owner's own open slot: take it
                Slot.objects.filter(pk=slot.pk).update(status=Slot.Status.BOOKED, updated_at=timezone.now())
            else:
                clash = [s for s in find_conflicts(slots, day, start, end, space.pk if space else None)]
                if clash:
                    raise Conflict('That time overlaps another slot or booking on this day.', 'slot_unavailable')
                slot = Slot.objects.create(**listing_filter(listing), space=space, date=day, start_time=start, end_time=end,
                                           status=Slot.Status.BOOKED, price=agreed)
            common = dict(sender_name=name, sender_phone=phone, sender_email=(d.get('email') or '').strip()[:254],
                          event_type=(d.get('event_type') or '').strip()[:100] or 'Booking', message=(d.get('note') or '').strip()[:2000],
                          status=S.BOOKED, slot=slot, agreed_amount=agreed, source='manual', event_date=day)
            if kind == 'venue':
                b = VenueInquiry.objects.create(venue=listing, space=space, guest_count=int(d.get('guest_count') or 0), **common)
            else:
                b = VendorInquiry.objects.create(vendor=listing, **common)
        return Response(booking_data(b, kind, detail=True), status=status.HTTP_201_CREATED)


class _BookingMixin:
    permission_classes = [HasMarketplaceAccess]

    def booking(self, request, kind, pk):
        if kind not in ('venue', 'vendor'):
            return None
        return _qs(kind, request.user).filter(pk=pk).first()


class BookingDetailView(_BookingMixin, APIView):
    def get(self, request, kind, pk):
        b = self.booking(request, kind, pk)
        if b is None:
            return Response({'error': 'Booking not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(booking_data(b, kind, detail=True))

    def patch(self, request, kind, pk):
        b = self.booking(request, kind, pk)
        if b is None:
            return Response({'error': 'Booking not found.'}, status=status.HTTP_404_NOT_FOUND)
        fields = []
        if 'agreed_amount' in request.data:
            b.agreed_amount = _amount(request.data.get('agreed_amount'), 'agreed_amount', allow_none=True)
            fields.append('agreed_amount')
        if 'owner_note' in request.data:
            b.owner_note = str(request.data.get('owner_note') or '')[:2000]
            fields.append('owner_note')
        if fields:
            b.save(update_fields=[*fields, 'updated_at'])
        return Response(booking_data(b, kind, detail=True))


class BookingPaymentsView(_BookingMixin, APIView):
    def post(self, request, kind, pk):
        b = self.booking(request, kind, pk)
        if b is None or b.status != S.BOOKED:
            return Response({'error': 'Payments can only be added to active bookings.'}, status=status.HTTP_400_BAD_REQUEST)
        amount = _amount(request.data.get('amount'))
        if amount <= 0:
            return Response({'error': 'Enter the amount received.'}, status=status.HTTP_400_BAD_REQUEST)
        method = request.data.get('method') or BookingPayment.Method.CASH
        if method not in BookingPayment.Method.values:
            return Response({'error': 'Choose how it was paid.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            received = datetime.date.fromisoformat(str(request.data.get('received_on') or today()))
        except ValueError:
            return Response({'error': 'Enter a valid date.'}, status=status.HTTP_400_BAD_REQUEST)
        if received > today():
            return Response({'error': 'The payment date can’t be in the future.'}, status=status.HTTP_400_BAD_REQUEST)
        BookingPayment.objects.create(**{f'{kind}_booking': b}, amount=amount, method=method, received_on=received,
                                      note=str(request.data.get('note') or '')[:200], recorded_by=request.user)
        return Response(booking_data(b, kind, detail=True), status=status.HTTP_201_CREATED)


class BookingPaymentDeleteView(_BookingMixin, APIView):
    def delete(self, request, kind, pk, payment_id):
        b = self.booking(request, kind, pk)
        if b is None:
            return Response({'error': 'Booking not found.'}, status=status.HTTP_404_NOT_FOUND)
        b.payments.filter(pk=payment_id).delete()
        return Response(booking_data(b, kind, detail=True))


class BookingCompleteView(_BookingMixin, APIView):
    def post(self, request, kind, pk):
        b = self.booking(request, kind, pk)
        if b is None or b.status != S.BOOKED:
            return Response({'error': 'Only active bookings can be completed.'}, status=status.HTTP_400_BAD_REQUEST)
        day = booking_date(b)
        if day and day > today():
            return Response({'error': 'You can mark it completed on or after the booked day.'}, status=status.HTTP_400_BAD_REQUEST)
        b.completed_at = None if request.data.get('undo') else timezone.now()
        b.save(update_fields=['completed_at', 'updated_at'])
        return Response(booking_data(b, kind, detail=True))


class BookingCancelView(_BookingMixin, APIView):
    def post(self, request, kind, pk):
        b = self.booking(request, kind, pk)
        if b is None or b.status != S.BOOKED or b.completed_at:
            return Response({'error': 'Only active bookings can be cancelled.'}, status=status.HTTP_400_BAD_REQUEST)
        change_request_status(b, S.CANCELLED, (request.data.get('note') or '').strip()[:2000] or None)
        from . import notifications
        notifications.notify_owner_cancelled(b)
        return Response(booking_data(b, kind, detail=True))
