"""Who may review what.

Events: the author needs a non-cancelled ticket for the event (linked to their account) that was checked in at
the gate. Reviews open from check-in onwards, so people can rate an event on their way out; the event must not
be a draft or cancelled. Organizers can't review their own events.
Vendors / venues: the author must have sent that listing an inquiry while signed in (or with their verified
email). Owners can't review their own listing.
"""
from django.db.models import Avg, Count, OuterRef, Q, Subquery

from apps.events.models import EventTicket

from .models import Review

CHECKED_IN = Q(is_attended=True) | Q(first_check_in__isnull=False) | Q(status__in=['checked_in', 'checked_out'])


def event_review_block(user, event):
    """None when `user` may review `event`, else a human-readable reason."""
    if not user or not user.is_authenticated:
        return 'Sign in to review this event.'
    if event.organizer_id == user.id:
        return 'You can’t review your own event.'
    if event.phase() in ('draft', 'cancelled'):
        return 'This event can’t be reviewed.'
    tickets = EventTicket.objects.filter(event=event, user=user).exclude(status=EventTicket.Status.CANCELLED)
    if not tickets.exists():
        return 'Only people with a ticket for this event can review it.'
    if not tickets.filter(CHECKED_IN).exists():
        return 'You can review this event after your ticket is scanned at the gate.'
    return None


def vendor_review_block(user, vendor):
    if not user or not user.is_authenticated:
        return 'Sign in to review this business.'
    if vendor.user_id == user.id:
        return 'You can’t review your own listing.'
    if not vendor.inquiries.filter(user=user).exists():
        return 'Only people who sent this business an inquiry can review it.'
    return None


def venue_review_block(user, venue):
    if not user or not user.is_authenticated:
        return 'Sign in to review this venue.'
    if venue.owner_id == user.id:
        return 'You can’t review your own venue.'
    if not venue.inquiries.filter(user=user).exists():
        return 'Only people who sent this venue an inquiry can review it.'
    return None


def review_block(user, kind, target):
    return {
        Review.Kind.EVENT: event_review_block,
        Review.Kind.VENDOR: vendor_review_block,
        Review.Kind.VENUE: venue_review_block,
    }[kind](user, target)


def public_reviews():
    return Review.objects.filter(is_hidden=False)


def summary(qs):
    """{average, count, distribution} over visible reviews in `qs`."""
    agg = qs.aggregate(average=Avg('rating'), count=Count('id'))
    dist = {str(i): 0 for i in range(1, 6)}
    for row in qs.values('rating').annotate(n=Count('id')):
        dist[str(row['rating'])] = row['n']
    return {
        'average': round(agg['average'], 2) if agg['average'] is not None else None,
        'count': agg['count'],
        'distribution': dist,
    }


def annotate_review_stats(qs, field):
    """Add _review_avg / _review_count (visible reviews) to a VendorProfile ('vendor') or VenueListing ('venue') queryset."""
    base = Review.objects.filter(is_hidden=False, **{field: OuterRef('pk')}).order_by().values(field)
    return qs.annotate(
        _review_avg=Subquery(base.annotate(a=Avg('rating')).values('a')[:1]),
        _review_count=Subquery(base.annotate(c=Count('id')).values('c')[:1]),
    )


def review_stats(obj, field):
    """(average or None, count) for one listing, using annotate_review_stats values when present."""
    if hasattr(obj, '_review_count'):
        avg, count = obj._review_avg, obj._review_count or 0
    else:
        agg = Review.objects.filter(is_hidden=False, **{field: obj}).aggregate(a=Avg('rating'), c=Count('id'))
        avg, count = agg['a'], agg['c']
    return (round(float(avg), 2) if avg is not None and count else None), count
