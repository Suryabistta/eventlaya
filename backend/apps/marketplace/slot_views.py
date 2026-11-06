"""Availability slots: the business portal (/api/marketplace/my/slots/…) and public availability calendars."""
import datetime

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import F, Prefetch, Q
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .booking import ACTIVE_REQUEST_STATUSES, Conflict, find_conflicts, has_started, today
from .models import AvailabilitySlot, ListingStatus, VendorInquiry, VendorProfile, VenueInquiry, VenueListing
from .serializers import (
    AvailabilitySlotSerializer, BlockDatesSerializer, BulkSlotSerializer, PublicSlotSerializer,
    SlotCreateSerializer, SlotUpdateSerializer,
)
from .views import HasMarketplaceAccess

Slot = AvailabilitySlot
MAX_OWNER_RANGE_DAYS = 370
MAX_PUBLIC_RANGE_DAYS = 180
DEFAULT_RANGE_DAYS = 60
MAX_BULK_DAYS = 370
MAX_BULK_SLOTS = 500
LOCKED = (Slot.Status.HELD, Slot.Status.BOOKED)


def slot_queryset():
    return (Slot.objects.select_related('venue', 'vendor', 'space')
            .prefetch_related(
                Prefetch('venue_requests', queryset=VenueInquiry.objects.filter(status__in=ACTIVE_REQUEST_STATUSES)
                         .order_by('-created_at'), to_attr='_active_venue_requests'),
                Prefetch('vendor_requests', queryset=VendorInquiry.objects.filter(status__in=ACTIVE_REQUEST_STATUSES)
                         .order_by('-created_at'), to_attr='_active_vendor_requests'))
            .order_by('date', F('start_time').asc(nulls_first=True), 'created_at'))


def serialize_slots(slots):
    for s in slots:
        if hasattr(s, '_active_venue_requests'):
            s._active_requests = s._active_venue_requests if s.venue_id else s._active_vendor_requests
    return AvailabilitySlotSerializer(slots, many=True).data


def parse_date(value, name):
    try:
        return datetime.date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValidationError({name: ['Use the YYYY-MM-DD format.']})


def date_range(params, max_days, clamp_to_today=False):
    start = parse_date(params['from'], 'from') if params.get('from') else today()
    if clamp_to_today:
        start = max(start, today())
    end = parse_date(params['to'], 'to') if params.get('to') else start + datetime.timedelta(days=DEFAULT_RANGE_DAYS)
    if end < start:
        raise ValidationError({'to': ['`to` must be on or after `from`.']})
    if (end - start).days > max_days:
        raise ValidationError({'to': [f'Ask for at most {max_days} days at a time.']})
    return start, end


def _get_or_none(qs, pk):
    try:
        return qs.filter(pk=pk).first()
    except (DjangoValidationError, ValueError):
        return None


def owned_listing(user, venue_id=None, vendor_id=None):
    """The venue / vendor profile the caller manages (platform admins manage all), else 404."""
    if venue_id:
        qs, owner_field = VenueListing.objects.all(), 'owner'
        pk = venue_id
    else:
        qs, owner_field = VendorProfile.objects.all(), 'user'
        pk = vendor_id
    if not user.is_superadmin:
        qs = qs.filter(**{owner_field: user})
    listing = _get_or_none(qs, pk)
    if listing is None:
        raise NotFound('Listing not found.')
    return listing


def resolve_target(user, data):
    """(listing filter kwargs, listing, space or None) from validated {venue|vendor, space?} data."""
    listing = owned_listing(user, data.get('venue'), data.get('vendor'))
    space = None
    if data.get('space'):
        space = _get_or_none(listing.spaces.all(), data['space'])
        if space is None:
            raise ValidationError({'space': ['This space does not belong to the selected venue.']})
    key = 'venue' if data.get('venue') else 'vendor'
    return {key: listing}, listing, space


def check_not_past(value, field='date'):
    if value < today():
        raise ValidationError({field: ['Pick today or a later date.']})


def overlap_error(conflicts):
    c = conflicts[0]
    when = 'the whole day' if c.is_full_day else f'{c.start_time:%H:%M}–{c.end_time:%H:%M}'
    return ValidationError({'non_field_errors': [f'Overlaps an existing slot on {c.date} ({when}, {c.status}).'],
                            'code': 'slot_overlap', 'conflicting_slot_id': str(c.id)})


class MySlotsView(APIView):
    """GET: the caller's slots. POST: create one slot."""
    permission_classes = [HasMarketplaceAccess]

    def get(self, request):
        params = request.query_params
        user = request.user
        qs = slot_queryset()
        if params.get('venue') or params.get('vendor'):
            listing = owned_listing(user, params.get('venue'), params.get('vendor'))
            qs = qs.filter(**({'venue': listing} if params.get('venue') else {'vendor': listing}))
        else:
            qs = qs.filter(Q(venue__owner=user) | Q(vendor__user=user))
        if params.get('space'):
            try:
                qs = qs.filter(space_id=params['space'])
            except (DjangoValidationError, ValueError):
                raise ValidationError({'space': ['Not a valid id.']})
        if params.get('status'):
            qs = qs.filter(status__in=params['status'].split(','))
        start, end = date_range(params, MAX_OWNER_RANGE_DAYS)
        try:
            slots = list(qs.filter(date__gte=start, date__lte=end))
        except (DjangoValidationError, ValueError):
            raise ValidationError({'space': ['Not a valid id.']})
        return Response({'from': start, 'to': end, 'count': len(slots), 'results': serialize_slots(slots)})

    def post(self, request):
        ser = SlotCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        target, listing, space = resolve_target(request.user, data)
        check_not_past(data['date'])
        with transaction.atomic():
            existing = list(Slot.objects.select_for_update().filter(date=data['date'], **target))
            conflicts = find_conflicts(existing, data['date'], data.get('start_time'), data.get('end_time'),
                                       space.pk if space else None)
            if conflicts:
                raise overlap_error(conflicts)
            slot = Slot.objects.create(
                space=space, date=data['date'], start_time=data.get('start_time'), end_time=data.get('end_time'),
                price=data.get('price'), note=data.get('note', ''), status=data['status'], **target)
        return Response(serialize_slots([slot_queryset().get(pk=slot.pk)])[0], status=status.HTTP_201_CREATED)


class MySlotDetailView(APIView):
    """GET / PATCH / DELETE one of the caller's slots."""
    permission_classes = [HasMarketplaceAccess]

    def get_slot(self, request, pk, lock=False):
        qs = slot_queryset() if not lock else Slot.objects.select_for_update().select_related('venue', 'vendor', 'space')
        user = request.user
        if not user.is_superadmin:
            qs = qs.filter(Q(venue__owner=user) | Q(vendor__user=user))
        slot = _get_or_none(qs, pk)
        if slot is None:
            raise NotFound('Slot not found.')
        return slot

    def get(self, request, pk):
        return Response(serialize_slots([self.get_slot(request, pk)])[0])

    def patch(self, request, pk):
        ser = SlotUpdateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        with transaction.atomic():
            slot = self.get_slot(request, pk, lock=True)
            if slot.status in LOCKED and set(data) - {'note'}:
                raise Conflict('This slot has a booking request. Only the note can change until it is declined '
                               'or cancelled.', 'slot_locked')
            new_date = data.get('date', slot.date)
            start = data['start_time'] if 'start_time' in data else slot.start_time
            end = data['end_time'] if 'end_time' in data else slot.end_time
            # A null time with no new time on the other side turns the slot into a full day.
            sent_null = any(k in data and data[k] is None for k in ('start_time', 'end_time'))
            if sent_null and data.get('start_time') is None and data.get('end_time') is None:
                start = end = None
            SlotCreateSerializer().check_times(start, end)
            if 'date' in data and data['date'] != slot.date:
                check_not_past(data['date'])
            if {'date', 'start_time', 'end_time'} & set(data):
                target = {'venue_id': slot.venue_id} if slot.venue_id else {'vendor_id': slot.vendor_id}
                existing = list(Slot.objects.select_for_update().filter(date=new_date, **target))
                conflicts = find_conflicts(existing, new_date, start, end, slot.space_id, exclude_id=slot.pk)
                if conflicts:
                    raise overlap_error(conflicts)
            slot.date, slot.start_time, slot.end_time = new_date, start, end
            for field in ('price', 'note', 'status'):
                if field in data:
                    setattr(slot, field, data[field])
            slot.save()
        return Response(serialize_slots([self.get_slot(request, pk)])[0])

    def delete(self, request, pk):
        with transaction.atomic():
            slot = self.get_slot(request, pk, lock=True)
            if slot.status in LOCKED:
                raise Conflict('This slot has a booking request. Decline or cancel the request first.', 'slot_locked')
            slot.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MySlotsBulkView(APIView):
    """Create the same slot on every matching weekday between two dates; overlapping days are skipped."""
    permission_classes = [HasMarketplaceAccess]

    def post(self, request):
        ser = BulkSlotSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        target, listing, space = resolve_target(request.user, data)
        start_date, end_date = data['start_date'], data['end_date']
        check_not_past(start_date, 'start_date')
        if (end_date - start_date).days + 1 > MAX_BULK_DAYS:
            raise ValidationError({'end_date': [f'Pick at most {MAX_BULK_DAYS} days at a time.']})
        weekdays = set(data.get('weekdays') or range(7))
        days = [start_date + datetime.timedelta(days=i) for i in range((end_date - start_date).days + 1)]
        days = [d for d in days if d.weekday() in weekdays]
        if len(days) > MAX_BULK_SLOTS:
            raise ValidationError({'end_date': [f'That would create more than {MAX_BULK_SLOTS} slots.']})
        start, end = data.get('start_time'), data.get('end_time')
        space_id = space.pk if space else None
        created, skipped = [], []
        with transaction.atomic():
            existing = list(Slot.objects.select_for_update().filter(date__gte=start_date, date__lte=end_date, **target))
            for day in days:
                if find_conflicts(existing, day, start, end, space_id):
                    skipped.append(day)
                    continue
                created.append(Slot(space=space, date=day, start_time=start, end_time=end, price=data.get('price'),
                                    note=data.get('note', ''), status=Slot.Status.OPEN, **target))
            Slot.objects.bulk_create(created)
        slots = list(slot_queryset().filter(pk__in=[s.pk for s in created]))
        return Response({
            'created': len(created), 'skipped': len(skipped), 'skipped_dates': skipped,
            'slots': serialize_slots(slots),
        }, status=status.HTTP_201_CREATED)


class MySlotsBlockView(APIView):
    """Close whole days: open slots on them become blocked; days without slots get a full-day blocked slot.
    Slots with a booking request are left alone and reported in `skipped`."""
    permission_classes = [HasMarketplaceAccess]

    def post(self, request):
        ser = BlockDatesSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        target, listing, space = resolve_target(request.user, data)
        dates = sorted(set(data['dates']))
        for d in dates:
            check_not_past(d, 'dates')
        space_id = space.pk if space else None
        note = data.get('note', '')
        created, blocked, skipped, affected = 0, 0, [], []
        with transaction.atomic():
            existing = list(Slot.objects.select_for_update().filter(date__in=dates, **target))
            for day in dates:
                conflicts = find_conflicts(existing, day, None, None, space_id)
                if not conflicts:
                    slot = Slot.objects.create(space=space, date=day, note=note, status=Slot.Status.BLOCKED, **target)
                    created += 1
                    affected.append(slot.pk)
                    continue
                for slot in conflicts:
                    if slot.status == Slot.Status.OPEN:
                        slot.status = Slot.Status.BLOCKED
                        if note:
                            slot.note = note
                        slot.save(update_fields=['status', 'note', 'updated_at'])
                        blocked += 1
                        affected.append(slot.pk)
                    elif slot.status in LOCKED:
                        skipped.append({'date': day, 'slot_id': str(slot.pk), 'reason': 'has_booking_request'})
                    # already blocked: nothing to do
        slots = list(slot_queryset().filter(pk__in=affected))
        return Response({'created': created, 'blocked': blocked, 'skipped': skipped,
                         'slots': serialize_slots(slots)}, status=status.HTTP_200_OK)


def public_availability(request, listing, filter_kwargs):
    """Approved listings only. Default: open (and not yet started) slots from today for 60 days, max 180.
    `?include_unavailable=1` also returns held/booked/blocked slots (status only, no details) for calendars.
    Paused listings return no slots (`paused: true`)."""
    if listing.listing_status != ListingStatus.APPROVED:
        raise NotFound('Listing not found.')
    params = request.query_params
    start, end = date_range(params, MAX_PUBLIC_RANGE_DAYS, clamp_to_today=True)
    if listing.is_paused:  # not taking requests: nothing to show or pick
        return Response({'from': start, 'to': end, 'count': 0, 'paused': True, 'results': []})
    qs = (Slot.objects.filter(date__gte=start, date__lte=end, **filter_kwargs)
          .select_related('venue', 'vendor', 'space')
          .order_by('date', F('start_time').asc(nulls_first=True), 'created_at'))
    if params.get('space'):
        qs = qs.filter(space_id=params['space'])
    include_unavailable = params.get('include_unavailable') in ('1', 'true', 'yes')
    if not include_unavailable:
        qs = qs.filter(status=Slot.Status.OPEN)
    try:
        slots = list(qs)
    except (DjangoValidationError, ValueError):
        raise ValidationError({'space': ['Not a valid id.']})
    visible = []
    for s in slots:
        if s.space_id and not s.space.is_active:
            continue
        if s.status == Slot.Status.OPEN and has_started(s):
            continue  # can no longer be requested
        visible.append(s)
    return Response({'from': start, 'to': end, 'count': len(visible),
                     'results': PublicSlotSerializer(visible, many=True).data})
