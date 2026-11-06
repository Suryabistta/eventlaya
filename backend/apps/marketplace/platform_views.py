"""Platform-admin review endpoints for the marketplace (mounted under /api/platform/)."""
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ListingStatus, MarketplaceAccessRequest, VendorProfile, VenueListing
from .serializers import MarketplaceAccessRequestSerializer, ReviewSerializer

User = get_user_model()

STATUS_FILTERS = ('pending', 'approved', 'rejected', 'all')


class IsPlatformAdmin(permissions.BasePermission):
    message = 'Only platform admins can review marketplace requests.'

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_superadmin)


def _status_param(request):
    value = request.query_params.get('status', 'pending')
    return value if value in STATUS_FILTERS else 'pending'


def _review_note(request, required):
    serializer = ReviewSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    note = serializer.validated_data['note'].strip()
    if required and not note:
        return None, Response({'note': ['Add a short reason so the applicant knows what to change.']},
                              status=status.HTTP_400_BAD_REQUEST)
    return note, None


def _get_or_404(model, pk, **filters):
    try:
        return model.objects.get(pk=pk, **filters)
    except (model.DoesNotExist, DjangoValidationError, ValueError):
        return None


# --- Marketplace access requests -----------------------------------------------------------------

class MarketplaceRequestListView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        qs = MarketplaceAccessRequest.objects.select_related('user', 'reviewed_by')
        wanted = _status_param(request)
        if wanted != 'all':
            qs = qs.filter(status=wanted)
        return Response(MarketplaceAccessRequestSerializer(qs, many=True).data)


class MarketplaceRequestReviewView(APIView):
    permission_classes = [IsPlatformAdmin]
    decision = None  # 'approved' | 'rejected'

    def post(self, request, pk):
        access_request = _get_or_404(MarketplaceAccessRequest, pk)
        if access_request is None:
            return Response({'detail': 'Request not found.'}, status=status.HTTP_404_NOT_FOUND)
        approve = self.decision == MarketplaceAccessRequest.Status.APPROVED
        note, error = _review_note(request, required=not approve)
        if error:
            return error
        with transaction.atomic():
            access_request.status = self.decision
            access_request.review_note = note
            access_request.reviewed_by = request.user
            access_request.reviewed_at = timezone.now()
            access_request.save()
            user = access_request.user
            user.marketplace_access = (
                User.MarketplaceAccess.APPROVED if approve else User.MarketplaceAccess.REJECTED
            )
            user.save(update_fields=['marketplace_access'])
        return Response(MarketplaceAccessRequestSerializer(access_request).data)


# --- Listing approvals ----------------------------------------------------------------------------

def _venue_row(v):
    return {
        'kind': 'venue', 'id': str(v.id), 'name': v.name, 'slug': v.slug,
        'subtitle': v.get_venue_type_display(), 'city': v.city,
        'owner_id': str(v.owner_id), 'owner_email': v.owner.email,
        'owner_name': v.owner.organization_name or v.owner.get_full_name() or v.owner.username,
        'phone': v.contact_phone, 'description': v.description,
        'image': (v.images or [None])[0],
        'listing_status': v.listing_status, 'review_note': v.review_note,
        'public_url': f'/marketplace/venues/{v.slug}',
        'created_at': v.created_at,
    }


def _vendor_row(p):
    return {
        'kind': 'vendor', 'id': str(p.id), 'name': p.business_name, 'slug': None,
        'subtitle': p.category.name, 'city': p.city,
        'owner_id': str(p.user_id), 'owner_email': p.user.email,
        'owner_name': p.user.organization_name or p.user.get_full_name() or p.user.username,
        'phone': p.phone, 'description': p.description,
        'image': (p.portfolio_images or [None])[0],
        'listing_status': p.listing_status, 'review_note': p.review_note,
        'public_url': f'/marketplace/vendors/{p.id}',
        'created_at': p.created_at,
    }


LISTING_KINDS = {
    'venue': (VenueListing, _venue_row, ('owner',)),
    'vendor': (VendorProfile, _vendor_row, ('user', 'category')),
}


class ListingReviewListView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        wanted = _status_param(request)
        kind = request.query_params.get('kind', 'all')
        kinds = [kind] if kind in LISTING_KINDS else list(LISTING_KINDS)
        rows = []
        for k in kinds:
            model, to_row, related = LISTING_KINDS[k]
            qs = model.objects.select_related(*related)
            if wanted != 'all':
                qs = qs.filter(listing_status=wanted)
            rows.extend(to_row(obj) for obj in qs)
        rows.sort(key=lambda r: r['created_at'], reverse=True)
        return Response(rows)


class ListingReviewView(APIView):
    permission_classes = [IsPlatformAdmin]
    decision = None  # 'approved' | 'rejected'

    def post(self, request, kind, pk):
        if kind not in LISTING_KINDS:
            return Response({'detail': 'Unknown listing type. Use "venue" or "vendor".'}, status=status.HTTP_404_NOT_FOUND)
        model, to_row, _ = LISTING_KINDS[kind]
        listing = _get_or_404(model, pk)
        if listing is None:
            return Response({'detail': 'Listing not found.'}, status=status.HTTP_404_NOT_FOUND)
        approve = self.decision == ListingStatus.APPROVED
        note, error = _review_note(request, required=not approve)
        if error:
            return error
        listing.listing_status = self.decision
        listing.review_note = note
        listing.save(update_fields=['listing_status', 'review_note'])
        return Response(to_row(listing))
