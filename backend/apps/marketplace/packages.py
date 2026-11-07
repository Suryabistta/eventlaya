"""Vendor & venue packages (module `packages`): owners manage them, everyone reads the active ones of live listings.

GET  /api/marketplace/packages/?vendor=<id> | ?venue=<id>   active packages of an approved, unpaused listing
GET  /api/marketplace/packages/?mine=1                       the signed-in owner's packages (all, any state)
POST/PATCH/DELETE                                            owner of the listing (or a platform admin)
"""
from rest_framework import permissions, serializers, viewsets
from rest_framework.exceptions import PermissionDenied

from apps.platform.catalog import safe_url
from .models import ListingStatus, ServicePackage, VendorProfile, VenueListing

MAX_PACKAGES = 20
MAX_INCLUSIONS = 20


def _owns(user, listing):
    owner_id = listing.user_id if isinstance(listing, VendorProfile) else listing.owner_id
    return user.is_authenticated and (user.is_superadmin or owner_id == user.id)


class ServicePackageSerializer(serializers.ModelSerializer):
    price_unit_display = serializers.CharField(source='get_price_unit_display', read_only=True)

    class Meta:
        model = ServicePackage
        fields = [
            'id', 'vendor', 'venue', 'name', 'price', 'price_unit', 'price_unit_display', 'description',
            'inclusions', 'max_guests', 'image', 'is_active', 'order',
        ]

    def validate_image(self, value):
        return safe_url(value, 'Image')

    def validate_inclusions(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Send a list of short lines.')
        lines = [str(v).strip()[:120] for v in value if str(v).strip()]
        if len(lines) > MAX_INCLUSIONS:
            raise serializers.ValidationError(f'Keep it to {MAX_INCLUSIONS} lines or fewer.')
        return lines

    def validate_price(self, value):
        if value < 0:
            raise serializers.ValidationError('Price can’t be negative.')
        return value

    def validate(self, attrs):
        vendor = attrs.get('vendor', getattr(self.instance, 'vendor', None))
        venue = attrs.get('venue', getattr(self.instance, 'venue', None))
        if bool(vendor) == bool(venue):
            raise serializers.ValidationError('A package belongs to either a vendor profile or a venue.')
        listing = vendor or venue
        user = self.context['request'].user
        if not _owns(user, listing):
            raise PermissionDenied('You can only add packages to your own listings.')
        if self.instance is None and listing.packages.count() >= MAX_PACKAGES:
            raise serializers.ValidationError(f'A listing can have at most {MAX_PACKAGES} packages.')
        return attrs


class ServicePackageViewSet(viewsets.ModelViewSet):
    serializer_class = ServicePackageSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = None

    def get_queryset(self):
        qs = ServicePackage.objects.select_related('vendor', 'venue')
        params = self.request.query_params
        user = self.request.user
        if self.action != 'list':
            # Writes: only your own; reads of one package: same rules as the list
            if self.request.method not in permissions.SAFE_METHODS:
                return qs if user.is_superadmin else qs.filter(vendor__user=user) | qs.filter(venue__owner=user)
            return qs
        if params.get('mine') == '1':
            if not user.is_authenticated:
                return qs.none()
            return qs.filter(vendor__user=user) | qs.filter(venue__owner=user)
        live = {'listing_status': ListingStatus.APPROVED, 'is_paused': False}
        if params.get('vendor'):
            listing = VendorProfile.objects.filter(pk=params['vendor']).first()
            qs = qs.filter(vendor_id=params['vendor'])
        elif params.get('venue'):
            listing = VenueListing.objects.filter(pk=params['venue']).first()
            qs = qs.filter(venue_id=params['venue'])
        else:
            return qs.none()
        if listing is None:
            return qs.none()
        # The owner previews their own (even pending) listing; everyone else sees live listings only
        if not _owns(user, listing) and not all(getattr(listing, k) == v for k, v in live.items()):
            return qs.none()
        return qs.filter(is_active=True)


def package_for(attrs, listing):
    """Validates the optional `package` on a new inquiry: it must be an active package of that listing."""
    package = attrs.get('package')
    if package is None:
        return attrs
    belongs = package.vendor_id == listing.id if isinstance(listing, VendorProfile) else package.venue_id == listing.id
    if not belongs or not package.is_active:
        raise serializers.ValidationError({'package': 'This package isn’t offered by this listing.'})
    return attrs
