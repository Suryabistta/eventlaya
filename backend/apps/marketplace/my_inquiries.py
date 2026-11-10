"""Attendee-facing: marketplace inquiries / booking requests the signed-in user sent (venues and vendors)."""
from decimal import Decimal
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import notifications
from .booking import S, Conflict, change_request_status, customer_cancel_block
from .models import VendorInquiry, VenueInquiry
from .serializers import slot_summary


def _review_maps(user):
    from apps.reviews.models import Review
    return (dict(Review.objects.filter(author=user, kind='venue').values_list('venue_id', 'id')),
            dict(Review.objects.filter(author=user, kind='vendor').values_list('vendor_id', 'id')))


def _common(q, user, review_id, owner_id):
    return {
        'event_type': q.event_type, 'event_date': q.event_date,
        'budget_range': q.budget_range, 'message': q.message, 'status': q.status,
        'slot': slot_summary(q.slot) if q.slot_id else None,
        'owner_note': q.owner_note,
        # Confirmed bookings: what was agreed and what the owner recorded as paid (offline payments)
        'agreed_amount': str(q.agreed_amount) if q.agreed_amount is not None else None,
        'paid': str(sum((p.amount for p in q.payments.all()), Decimal('0')).quantize(Decimal('0.01'))) if q.status == 'booked' else None,
        'can_cancel': customer_cancel_block(q) is None,
        'created_at': q.created_at, 'updated_at': q.updated_at,
        'my_review_id': str(review_id) if review_id else None,
        'can_review': review_id is None and owner_id != user.id,
    }


def venue_item(q, user, review_id):
    return {
        'id': str(q.id), 'kind': 'venue',
        'target': {'id': str(q.venue_id), 'name': q.venue.name, 'slug': q.venue.slug, 'city': q.venue.city,
                   'image': (q.venue.images or [None])[0]},
        'space': {'id': str(q.space_id), 'name': q.space.name} if q.space_id else None,
        'guest_count': q.guest_count,
        **_common(q, user, review_id, q.venue.owner_id),
    }


def vendor_item(q, user, review_id):
    return {
        'id': str(q.id), 'kind': 'vendor',
        'target': {'id': str(q.vendor_id), 'name': q.vendor.business_name, 'slug': None,
                   'city': q.vendor.city, 'category': q.vendor.category.name,
                   'image': (q.vendor.portfolio_images or [None])[0]},
        'space': None,
        'guest_count': None,
        **_common(q, user, review_id, q.vendor.user_id),
    }


VENUE_RELATED = ('venue', 'space', 'slot', 'slot__space', 'slot__venue')
VENDOR_RELATED = ('vendor', 'vendor__category', 'slot', 'slot__vendor')


class MySentInquiriesView(APIView):
    """GET ?kind=venue|vendor (default both), newest first."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        kind = request.query_params.get('kind')
        reviewed_venues, reviewed_vendors = _review_maps(user)
        items = []
        if kind in (None, '', 'venue'):
            for q in VenueInquiry.objects.filter(user=user).select_related(*VENUE_RELATED):
                items.append(venue_item(q, user, reviewed_venues.get(q.venue_id)))
        if kind in (None, '', 'vendor'):
            for q in VendorInquiry.objects.filter(user=user).select_related(*VENDOR_RELATED):
                items.append(vendor_item(q, user, reviewed_vendors.get(q.vendor_id)))
        items.sort(key=lambda i: i['created_at'], reverse=True)
        return Response({'count': len(items), 'results': items})


class CancelMyInquiryView(APIView):
    """POST /api/me/inquiries/<venue|vendor>/<id>/cancel/ — the sender withdraws a request.

    Allowed while pending/contacted, or once confirmed as long as the booked day is still ahead. A slot on
    the request is reopened for other customers and the owner is notified."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, kind, pk):
        user = request.user
        if kind == 'venue':
            qs, build = VenueInquiry.objects.select_related(*VENUE_RELATED, 'venue__owner'), venue_item
        elif kind == 'vendor':
            qs, build = VendorInquiry.objects.select_related(*VENDOR_RELATED, 'vendor__user'), vendor_item
        else:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            inquiry = qs.get(pk=pk, user=user)
        except (VenueInquiry.DoesNotExist, VendorInquiry.DoesNotExist, DjangoValidationError):
            return Response({'detail': 'Inquiry not found.'}, status=status.HTTP_404_NOT_FOUND)
        reason = customer_cancel_block(inquiry)
        if reason:
            raise Conflict(reason, 'cannot_cancel')
        change_request_status(inquiry, S.CANCELLED)
        notifications.notify_cancelled(inquiry)
        reviewed_venues, reviewed_vendors = _review_maps(user)
        review_id = (reviewed_venues.get(inquiry.venue_id) if kind == 'venue'
                     else reviewed_vendors.get(inquiry.vendor_id))
        return Response(build(inquiry, user, review_id))
