from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q
from django.utils.text import slugify
from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.exceptions import NotAuthenticated, PermissionDenied
from rest_framework.views import APIView
from .models import (
    ListingStatus, MarketplaceAccessRequest, VendorCategory, VendorProfile,
    VenueListing, VenueSpace, VenueInquiry, VendorInquiry,
)
from . import notifications
from .booking import S as InquiryStatus, Conflict, change_request_status, listing_paused, owner_decision, reserve_slot
from .serializers import (
    InquiryStatusSerializer, MarketplaceAccessRequestSerializer, OwnerDecisionSerializer,
    VendorCategorySerializer, VendorProfileSerializer, VendorInquirySerializer,
    VenueListingSerializer, VenueSpaceSerializer, VenueInquirySerializer
)
from apps.reviews.rules import annotate_review_stats


def inquiry_data_with_sender(request, data):
    """Signed-in senders get their account details filled in when they leave them out."""
    user = request.user
    if user.is_authenticated:
        data.setdefault('sender_name', user.get_full_name() or user.organization_name or user.email.split('@')[0])
        data.setdefault('sender_email', user.email)
        if user.phone:
            data.setdefault('sender_phone', user.phone)
    return data

User = get_user_model()


def save_inquiry(request, serializer, listing, **save_kwargs):
    """Save a validated inquiry. With `slot_id` it becomes a booking request: the slot is locked and put on
    hold in the same transaction (409 if someone else got it first) and the owner is notified."""
    user = request.user if request.user.is_authenticated else None
    slot_id = serializer.validated_data.pop('slot_id', None)
    if not slot_id:
        return serializer.save(user=user, **save_kwargs)
    with transaction.atomic():
        requested_space = serializer.validated_data.pop('space', None)
        slot = reserve_slot(listing, slot_id, request.user, requested_space)
        extra = {'space': slot.space} if hasattr(listing, 'owner_id') else {}
        inquiry = serializer.save(user=user, slot=slot, event_date=slot.date, **extra, **save_kwargs)
        notifications.notify_new_request(inquiry)
    return inquiry


def availability_response(request, listing, kind):
    from .slot_views import public_availability
    return public_availability(request, listing, {kind: listing})


class HasMarketplaceAccess(permissions.BasePermission):
    """Vendors, organizers with approved marketplace access, and platform admins."""
    message = 'Your account does not have marketplace access yet. Request it from "List your business".'

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.has_marketplace_access)


def visible_listings(qs, user, owner_field):
    """Approved listings for everyone; owners also see their own, platform admins see all."""
    if user.is_authenticated and user.is_superadmin:
        return qs
    visible = Q(listing_status=ListingStatus.APPROVED)
    if user.is_authenticated:
        visible |= Q(**{owner_field: user})
    return qs.filter(visible)


def resubmit_if_rejected(instance, changed_fields=None):
    """Editing a listing that needed changes sends it back for review (pausing/resuming alone doesn't)."""
    if changed_fields is not None and set(changed_fields) <= {'is_paused'}:
        return
    if instance.listing_status == ListingStatus.REJECTED:
        instance.listing_status = ListingStatus.PENDING
        instance.save(update_fields=['listing_status'])


class ListingWritePermissionsMixin:
    """Anyone can read approved listings; creating needs marketplace access."""

    def get_permissions(self):
        if self.action == 'create':
            return [HasMarketplaceAccess()]
        return super().get_permissions()


class VendorCategoryViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = VendorCategory.objects.all().prefetch_related('vendors')
    serializer_class = VendorCategorySerializer
    permission_classes = [permissions.AllowAny]


class VendorProfileViewSet(ListingWritePermissionsMixin, viewsets.ModelViewSet):
    serializer_class = VendorProfileSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        qs = annotate_review_stats(VendorProfile.objects.all().select_related('category'), 'vendor')
        user = self.request.user
        if self.action == 'list':
            # The public directory only lists approved, unpaused profiles; `?mine=1` lists the caller's own.
            if self.request.query_params.get('mine') and user.is_authenticated:
                qs = qs.filter(user=user)
            else:
                qs = qs.filter(listing_status=ListingStatus.APPROVED, is_paused=False)
        else:
            qs = visible_listings(qs, user, 'user')

        category_slug = self.request.query_params.get('category')
        city = self.request.query_params.get('city')

        if category_slug:
            qs = qs.filter(category__slug=category_slug)
        if city:
            qs = qs.filter(city__iexact=city)

        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user, listing_status=ListingStatus.PENDING)

    def _require_owner(self, profile):
        user = self.request.user
        if profile.user_id != user.id and not user.is_superadmin:
            raise PermissionDenied('Only the owner can change this profile.')

    def perform_update(self, serializer):
        self._require_owner(serializer.instance)
        resubmit_if_rejected(serializer.save(), serializer.validated_data.keys())

    def perform_destroy(self, instance):
        self._require_owner(instance)
        instance.delete()

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.AllowAny])
    def inquiries(self, request, pk=None):
        """POST: anyone can ask a vendor about their services (stored against the account when signed in).
        GET: the vendor's owner (or a platform admin) lists inquiries."""
        vendor = self.get_object()
        if request.method == 'POST':
            if vendor.is_paused:
                raise listing_paused()
            data = inquiry_data_with_sender(request, {k: v for k, v in request.data.items()})
            serializer = VendorInquirySerializer(data=data)
            serializer.is_valid(raise_exception=True)
            save_inquiry(request, serializer, vendor, vendor=vendor)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        user = request.user
        if not user.is_authenticated or (vendor.user_id != user.id and not user.is_superadmin):
            return Response({'error': 'Unauthorized'}, status=status.HTTP_403_FORBIDDEN)
        return Response(VendorInquirySerializer(
            vendor.inquiries.select_related('slot', 'slot__space', 'slot__vendor'), many=True).data)

    @action(detail=True, methods=['get'], permission_classes=[permissions.AllowAny])
    def availability(self, request, pk=None):
        """Public availability calendar (approved listings only). ?from&to&include_unavailable=1"""
        return availability_response(request, self.get_object(), 'vendor')


class VenueListingViewSet(ListingWritePermissionsMixin, viewsets.ModelViewSet):
    serializer_class = VenueListingSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    lookup_field = 'id'

    def get_queryset(self):
        qs = annotate_review_stats(
            VenueListing.objects.all().select_related('owner').prefetch_related('spaces'), 'venue',
        )
        user = self.request.user
        params = self.request.query_params
        if self.action == 'list' and not (params.get('slug') or params.get('my_venues')):
            # The public directory only lists approved venues that aren't paused by their owner.
            qs = qs.filter(listing_status=ListingStatus.APPROVED, is_paused=False)
        else:
            # Detail lookups (by id or slug) also let owners preview and edit their own listing.
            qs = visible_listings(qs, user, 'owner')
        city = self.request.query_params.get('city')
        venue_type = self.request.query_params.get('type')
        min_cap = self.request.query_params.get('min_capacity')
        max_price = self.request.query_params.get('max_price')
        search = self.request.query_params.get('search')
        owner_me = self.request.query_params.get('my_venues')
        slug = self.request.query_params.get('slug')

        if slug:
            qs = qs.filter(slug=slug)

        if owner_me and self.request.user.is_authenticated:
            qs = qs.filter(owner=self.request.user)
        if city:
            qs = qs.filter(city__iexact=city)
        if venue_type:
            qs = qs.filter(venue_type=venue_type)
        if min_cap:
            try:
                qs = qs.filter(capacity_max__gte=int(min_cap))
            except ValueError:
                pass
        if max_price:
            try:
                qs = qs.filter(price_per_day__lte=float(max_price))
            except ValueError:
                pass
        if search:
            qs = qs.filter(name__icontains=search)

        return qs

    def perform_create(self, serializer):
        name = serializer.validated_data.get('name', 'Venue')
        base_slug = slugify(name)
        slug = base_slug
        counter = 1
        while VenueListing.objects.filter(slug=slug).exists():
            slug = f"{base_slug}-{counter}"
            counter += 1
        serializer.save(owner=self.request.user, slug=slug, listing_status=ListingStatus.PENDING)

    def _require_owner(self, venue):
        user = self.request.user
        if not user.is_authenticated:
            raise NotAuthenticated()
        if venue.owner_id != user.id and not user.is_superadmin:
            raise PermissionDenied('Only the venue owner can change this venue.')

    def perform_update(self, serializer):
        self._require_owner(serializer.instance)
        resubmit_if_rejected(serializer.save(), serializer.validated_data.keys())

    def perform_destroy(self, instance):
        self._require_owner(instance)
        instance.delete()

    @action(detail=True, methods=['get', 'post'], url_path='spaces', permission_classes=[permissions.AllowAny])
    def spaces(self, request, id=None):
        venue = self.get_object()
        if request.method == 'POST':
            self._require_owner(venue)
            serializer = VenueSpaceSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            if 'order' not in request.data:
                serializer.validated_data['order'] = venue.spaces.count()
            serializer.save(venue=venue)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        spaces = venue.spaces.all()
        user = request.user
        if not (user.is_authenticated and (venue.owner_id == user.id or user.is_superadmin)):
            spaces = spaces.filter(is_active=True)
        return Response(VenueSpaceSerializer(spaces, many=True).data)

    @action(detail=True, methods=['get', 'put', 'patch', 'delete'], url_path=r'spaces/(?P<space_id>[0-9a-f-]+)',
            permission_classes=[permissions.AllowAny])
    def space_detail(self, request, id=None, space_id=None):
        venue = self.get_object()
        try:
            space = venue.spaces.filter(id=space_id).first()
        except DjangoValidationError:
            space = None
        if space is None:
            return Response({'detail': 'Space not found.'}, status=status.HTTP_404_NOT_FOUND)
        if request.method == 'GET':
            return Response(VenueSpaceSerializer(space).data)
        self._require_owner(venue)
        if request.method == 'DELETE':
            space.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = VenueSpaceSerializer(space, data=request.data, partial=request.method == 'PATCH')
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.AllowAny])
    def inquiries(self, request, id=None):
        venue = self.get_object()
        if request.method == 'POST':
            if venue.is_paused:
                raise listing_paused()
            data = inquiry_data_with_sender(request, {k: v for k, v in request.data.items()})
            data['venue'] = str(venue.id)
            serializer = VenueInquirySerializer(data=data)
            if serializer.is_valid():
                save_inquiry(request, serializer, venue, venue=venue)
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        else:
            # Only venue owner can see inquiries
            if not request.user.is_authenticated or request.user != venue.owner:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_403_FORBIDDEN)
            inquiries = venue.inquiries.select_related('space', 'slot', 'slot__space', 'slot__venue')
            return Response(VenueInquirySerializer(inquiries, many=True).data)

    @action(detail=True, methods=['get'], permission_classes=[permissions.AllowAny])
    def availability(self, request, id=None):
        """Public availability calendar (approved listings only). ?from&to&space&include_unavailable=1"""
        return availability_response(request, self.get_object(), 'venue')


class VenueInquiryViewSet(viewsets.ModelViewSet):
    serializer_class = VenueInquirySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Owners see inquiries on their venues
        return VenueInquiry.objects.filter(venue__owner=self.request.user).select_related('venue')

    def perform_destroy(self, instance):
        # Deleting a booking request frees its slot.
        if instance.slot_id and instance.status not in (InquiryStatus.REJECTED, InquiryStatus.CANCELLED):
            change_request_status(instance, InquiryStatus.REJECTED)
        instance.delete()


# --- Business portal: the signed-in vendor's own listings & inquiries ---------------------------

class MyListingsView(APIView):
    permission_classes = [HasMarketplaceAccess]

    def get(self, request):
        venues = annotate_review_stats(
            VenueListing.objects.filter(owner=request.user).prefetch_related('spaces'), 'venue').order_by('-created_at')
        vendors = annotate_review_stats(
            VendorProfile.objects.filter(user=request.user).select_related('category'), 'vendor').order_by('-created_at')
        ctx = {'request': request}
        return Response({
            'venues': VenueListingSerializer(venues, many=True, context=ctx).data,
            'vendor_profiles': VendorProfileSerializer(vendors, many=True, context=ctx).data,
        })


class MyInquiriesView(APIView):
    permission_classes = [HasMarketplaceAccess]

    def get(self, request):
        qs = VenueInquiry.objects.filter(venue__owner=request.user).select_related(
            'venue', 'space', 'slot', 'slot__space', 'slot__venue')
        if request.query_params.get('has_slot') in ('1', 'true'):
            qs = qs.filter(slot__isnull=False)
        status_filter = request.query_params.get('status')
        if status_filter and status_filter != 'all':
            qs = qs.filter(status=status_filter)
        return Response(VenueInquirySerializer(qs.order_by('-created_at'), many=True).data)


class OwnerInquiryMixin:
    """Venue (`kind='venue'`) or vendor inquiries the caller owns; PATCH status keeps any slot in step."""
    permission_classes = [HasMarketplaceAccess]
    kind = 'venue'

    def get_inquiry(self, request, pk):
        if self.kind == 'venue':
            qs = VenueInquiry.objects.select_related('venue', 'venue__owner', 'space', 'slot', 'slot__space',
                                                     'slot__venue').filter(venue__owner=request.user)
        else:
            qs = VendorInquiry.objects.select_related('vendor', 'vendor__user', 'slot', 'slot__vendor').filter(
                vendor__user=request.user)
        try:
            return qs.get(pk=pk)
        except (VenueInquiry.DoesNotExist, VendorInquiry.DoesNotExist, DjangoValidationError):
            return None

    def serialize(self, inquiry):
        return (VenueInquirySerializer if self.kind == 'venue' else VendorInquirySerializer)(inquiry).data

    def not_found(self):
        return Response({'detail': 'Inquiry not found.'}, status=status.HTTP_404_NOT_FOUND)

    def patch(self, request, pk):
        inquiry = self.get_inquiry(request, pk)
        if inquiry is None:
            return self.not_found()
        serializer = InquiryStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data['status']
        if inquiry.status == InquiryStatus.CANCELLED and new_status != inquiry.status:
            raise Conflict('The customer cancelled this request.', 'request_cancelled')
        old = change_request_status(inquiry, new_status)
        if old != new_status and new_status in (InquiryStatus.BOOKED, InquiryStatus.REJECTED):
            notifications.notify_decision(inquiry)
        return Response(self.serialize(inquiry))


class OwnerDecisionView(OwnerInquiryMixin, APIView):
    """POST …/confirm/ (-> booked, slot booked) or …/decline/ (-> rejected, slot reopened). Body: {note?}."""
    decision = 'confirm'
    http_method_names = ['post', 'options']

    def post(self, request, pk):
        inquiry = self.get_inquiry(request, pk)
        if inquiry is None:
            return self.not_found()
        serializer = OwnerDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _old, changed = owner_decision(inquiry, self.decision, serializer.validated_data.get('note'))
        if changed:
            notifications.notify_decision(inquiry)
        return Response(self.serialize(inquiry))


class MyInquiryDetailView(OwnerInquiryMixin, APIView):
    kind = 'venue'


class MyVendorInquiriesView(APIView):
    """Business portal: inquiries sent to the signed-in vendor's profiles. ?status= filters."""
    permission_classes = [HasMarketplaceAccess]

    def get(self, request):
        qs = VendorInquiry.objects.filter(vendor__user=request.user).select_related('vendor', 'slot', 'slot__vendor')
        if request.query_params.get('has_slot') in ('1', 'true'):
            qs = qs.filter(slot__isnull=False)
        status_filter = request.query_params.get('status')
        if status_filter and status_filter != 'all':
            qs = qs.filter(status=status_filter)
        return Response(VendorInquirySerializer(qs.order_by('-created_at'), many=True).data)


class MyVendorInquiryDetailView(OwnerInquiryMixin, APIView):
    kind = 'vendor'


# --- Organizers asking for a marketplace business portal ----------------------------------------

class AccessRequestCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        if user.role != User.Role.ORGANIZER:
            return Response({'detail': 'Only event organizer accounts can request marketplace access.'},
                            status=status.HTTP_403_FORBIDDEN)
        if user.marketplace_access == User.MarketplaceAccess.APPROVED:
            return Response({'detail': 'Your account already has marketplace access.'}, status=status.HTTP_400_BAD_REQUEST)
        if MarketplaceAccessRequest.objects.filter(user=user, status=MarketplaceAccessRequest.Status.PENDING).exists():
            return Response({'detail': 'Your request is already waiting for review.'}, status=status.HTTP_400_BAD_REQUEST)
        serializer = MarketplaceAccessRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(user=user)
        user.marketplace_access = User.MarketplaceAccess.PENDING
        user.save(update_fields=['marketplace_access'])
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class AccessRequestMineView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        latest = MarketplaceAccessRequest.objects.filter(user=request.user).select_related('user', 'reviewed_by').first()
        if latest is None:
            return Response({'detail': 'You have not requested marketplace access yet.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(MarketplaceAccessRequestSerializer(latest).data)
