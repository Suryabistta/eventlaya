"""Availability slots and booking requests: overlap rules, reserving a slot, and inquiry status changes.

A booking request is a VenueInquiry / VendorInquiry with `slot` set. The slot status mirrors the request:
  pending / contacted -> slot `held`;  booked -> slot `booked`;  rejected / cancelled -> slot `open`.
Every slot change goes through a conditional UPDATE (… WHERE status = expected) inside a transaction with the
row locked, so two customers can never hold the same slot even on databases without row locks.
"""
import datetime

from django.db import transaction
from django.utils import timezone
from rest_framework import status as http
from rest_framework.exceptions import APIException, ValidationError

from .models import AvailabilitySlot, ListingStatus, VenueInquiry

Slot = AvailabilitySlot
S = VenueInquiry.Status
ACTIVE_REQUEST_STATUSES = (S.PENDING, S.CONTACTED, S.BOOKED)
SLOT_FOR_REQUEST_STATUS = {
    S.PENDING: Slot.Status.HELD,
    S.CONTACTED: Slot.Status.HELD,
    S.BOOKED: Slot.Status.BOOKED,
    S.REJECTED: Slot.Status.OPEN,
    S.CANCELLED: Slot.Status.OPEN,
}


class Conflict(APIException):
    status_code = http.HTTP_409_CONFLICT
    default_detail = 'Conflict.'
    default_code = 'conflict'

    def __init__(self, detail, code='conflict'):
        super().__init__({'detail': detail, 'code': code})


def listing_paused():
    return Conflict('This listing is paused and not taking requests right now.', 'listing_paused')


# --- Time helpers ---------------------------------------------------------------------------------

def today():
    return timezone.localdate()


def slot_start(slot):
    """Aware datetime when the slot begins (full-day slots begin at midnight, Asia/Kathmandu)."""
    naive = datetime.datetime.combine(slot.date, slot.start_time or datetime.time.min)
    return timezone.make_aware(naive, timezone.get_current_timezone())


def has_started(slot):
    return slot_start(slot) <= timezone.now()


def times_overlap(start_a, end_a, start_b, end_b):
    if start_a is None or start_b is None:  # a full-day slot overlaps everything that day
        return True
    return start_a < end_b and start_b < end_a


def spaces_conflict(space_a, space_b):
    """Slots for the whole venue (no space) clash with every space; two spaces only clash with themselves."""
    return space_a is None or space_b is None or space_a == space_b


def find_conflicts(slots, date, start, end, space_id, exclude_id=None):
    return [
        s for s in slots
        if s.date == date and s.pk != exclude_id and spaces_conflict(s.space_id, space_id)
        and times_overlap(s.start_time, s.end_time, start, end)
    ]


def listing_filter(listing):
    from .models import VenueListing
    return {'venue': listing} if isinstance(listing, VenueListing) else {'vendor': listing}


def listing_owner_id(listing):
    return getattr(listing, 'owner_id', None) or getattr(listing, 'user_id', None)


# --- Customers picking a slot ---------------------------------------------------------------------

def reserve_slot(listing, slot_id, user, requested_space=None):
    """Lock an open slot of `listing` for a new booking request and mark it held. Call inside atomic().

    Raises 400 for a slot that can't be requested (wrong listing, past, own listing, unapproved listing) and
    409 `slot_unavailable` when it is not open (someone else requested it, booked, or blocked)."""
    slot = (Slot.objects.select_for_update().filter(pk=slot_id, **listing_filter(listing)).first())
    if slot is None:
        raise ValidationError({'slot_id': ['This slot does not belong to this listing.']})
    if listing.listing_status != ListingStatus.APPROVED:
        raise ValidationError({'slot_id': ['This listing is not taking bookings yet.']})
    if listing.is_paused:
        raise listing_paused()
    if user is not None and user.is_authenticated and listing_owner_id(listing) == user.id:
        raise ValidationError({'slot_id': ['You can’t book your own listing.']})
    if has_started(slot):
        raise ValidationError({'slot_id': ['This slot has already started or passed.']})
    if slot.space_id is not None and not slot.space.is_active:
        raise ValidationError({'slot_id': ['This space is not available for booking.']})
    if requested_space is not None and requested_space.pk != slot.space_id:
        raise ValidationError({'space': ['The selected space does not match the slot.']})
    claimed = Slot.objects.filter(pk=slot.pk, status=Slot.Status.OPEN).update(
        status=Slot.Status.HELD, updated_at=timezone.now())
    if not claimed:
        raise Conflict('Sorry, this slot is no longer available. Please pick another one.', 'slot_unavailable')
    slot.status = Slot.Status.HELD
    return slot


# --- Status changes on requests -------------------------------------------------------------------

def change_request_status(inquiry, new_status, note=None):
    """Move an inquiry to `new_status`, keeping its slot in step. Returns the previous status.

    Plain inquiries (no slot) just change status. Coming back from rejected/cancelled to an active status
    re-claims the slot, which fails with 409 if someone else took it in the meantime."""
    old_status = inquiry.status
    fields = ['status', 'updated_at']
    with transaction.atomic():
        if inquiry.slot_id and new_status != old_status:
            slot = Slot.objects.select_for_update().get(pk=inquiry.slot_id)
            target = SLOT_FOR_REQUEST_STATUS[new_status]
            if old_status in ACTIVE_REQUEST_STATUSES:
                expected = (Slot.Status.HELD, Slot.Status.BOOKED)  # this request owns the slot
            else:
                expected = (Slot.Status.OPEN,)  # closed request: only an open slot can be re-claimed
            if old_status in ACTIVE_REQUEST_STATUSES and slot.status == target:
                pass
            elif old_status not in ACTIVE_REQUEST_STATUSES and target == Slot.Status.OPEN:
                pass  # closed -> closed: the slot is not ours, leave it alone
            else:
                updated = Slot.objects.filter(pk=slot.pk, status__in=expected).update(
                    status=target, updated_at=timezone.now())
                if not updated:
                    raise Conflict('This slot has been taken by another booking.', 'slot_unavailable')
            inquiry.slot.status = target if (old_status in ACTIVE_REQUEST_STATUSES
                                             or target != Slot.Status.OPEN) else slot.status
        inquiry.status = new_status
        if note is not None:
            inquiry.owner_note = note
            fields.append('owner_note')
        inquiry.save(update_fields=fields)
    return old_status


def owner_decision(inquiry, action, note=None):
    """`confirm` -> booked, `decline` -> rejected. Returns (old_status, changed)."""
    if inquiry.status == S.CANCELLED:
        raise Conflict('The customer cancelled this request.', 'request_cancelled')
    new_status = S.BOOKED if action == 'confirm' else S.REJECTED
    if inquiry.status == new_status:
        if note is not None and note != inquiry.owner_note:
            inquiry.owner_note = note
            inquiry.save(update_fields=['owner_note', 'updated_at'])
        return new_status, False
    old = change_request_status(inquiry, new_status, note)
    if new_status == S.BOOKED and inquiry.agreed_amount is None:
        # Booking management starts from the slot or package price; the owner can change it
        price = (inquiry.slot.price if inquiry.slot_id else None) or (inquiry.package.price if inquiry.package_id else None)
        if price is not None:
            inquiry.agreed_amount = price
            inquiry.save(update_fields=['agreed_amount', 'updated_at'])
    return old, True


def customer_cancel_block(inquiry):
    """None if the customer may cancel now, else the reason."""
    if inquiry.status in (S.REJECTED, S.CANCELLED):
        return 'This request is already closed.'
    if inquiry.status == S.BOOKED:
        when = inquiry.slot.date if inquiry.slot_id else inquiry.event_date
        if when is not None and when <= today():
            return 'Confirmed bookings can only be cancelled before the booked day.'
    return None
