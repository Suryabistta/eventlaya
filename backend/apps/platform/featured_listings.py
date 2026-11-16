"""Superadmin → Featured listings: pick venues and vendors to show first in the marketplace and in the home page's
featured band (same idea as Featured events).

GET  /api/platform/featured-listings/?kind=venue|vendor&search=&featured=1   approved listings, featured first
POST /api/platform/featured-listings/<kind>/<id>/feature/                    {is_featured: bool}
"""
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.marketplace.models import ListingStatus, VendorProfile, VenueListing
from .models import AdminAction
from .org_admin import log
from .views import IsSuperadmin


def row(kind, x):
    owner = x.owner if kind == 'venue' else x.user
    return {
        'id': str(x.id), 'kind': kind, 'name': x.name if kind == 'venue' else x.business_name,
        'city': x.city, 'is_featured': x.is_featured, 'image': x.featured_image,
        'type': x.get_venue_type_display() if kind == 'venue' else (x.category.name if x.category_id else ''),
        'owner': (owner.organization_name or owner.get_full_name() or owner.email) if owner else '',
    }


class FeaturedListingListView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        kinds = [request.query_params['kind']] if request.query_params.get('kind') in ('venue', 'vendor') else ['venue', 'vendor']
        search = request.query_params.get('search', '').strip()
        only = request.query_params.get('featured') == '1'
        out = []
        if 'venue' in kinds:
            qs = VenueListing.objects.filter(listing_status=ListingStatus.APPROVED).select_related('owner')
            if search:
                qs = qs.filter(Q(name__icontains=search) | Q(city__icontains=search))
            if only:
                qs = qs.filter(is_featured=True)
            out += [row('venue', v) for v in qs.order_by('-is_featured', 'name')[:100]]
        if 'vendor' in kinds:
            qs = VendorProfile.objects.filter(listing_status=ListingStatus.APPROVED).select_related('user', 'category')
            if search:
                qs = qs.filter(Q(business_name__icontains=search) | Q(city__icontains=search))
            if only:
                qs = qs.filter(is_featured=True)
            out += [row('vendor', v) for v in qs.order_by('-is_featured', 'business_name')[:100]]
        out.sort(key=lambda r: (not r['is_featured'], r['name'].lower()))
        return Response(out)


class FeatureListingView(APIView):
    permission_classes = [IsSuperadmin]

    def post(self, request, kind, pk):
        model = {'venue': VenueListing, 'vendor': VendorProfile}.get(kind)
        if model is None:
            return Response({'error': 'kind must be venue or vendor.'}, status=400)
        x = get_object_or_404(model, pk=pk)
        featured = bool(request.data.get('is_featured'))
        if x.is_featured != featured:
            x.is_featured = featured
            x.save(update_fields=['is_featured'])
            owner = x.owner if kind == 'venue' else x.user
            name = x.name if kind == 'venue' else x.business_name
            log(request, owner, AdminAction.Kind.FEATURED_LISTING if featured else AdminAction.Kind.UNFEATURED_LISTING, name)
        return Response(row(kind, x))
