from django.utils.text import slugify
from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action
from .models import VendorCategory, VendorProfile, VenueListing, VenueInquiry
from .serializers import (
    VendorCategorySerializer, VendorProfileSerializer,
    VenueListingSerializer, VenueInquirySerializer
)

class VendorCategoryViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = VendorCategory.objects.all().prefetch_related('vendors')
    serializer_class = VendorCategorySerializer
    permission_classes = [permissions.AllowAny]


class VendorProfileViewSet(viewsets.ModelViewSet):
    serializer_class = VendorProfileSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        qs = VendorProfile.objects.all().select_related('category')
        category_slug = self.request.query_params.get('category')
        city = self.request.query_params.get('city')

        if category_slug:
            qs = qs.filter(category__slug=category_slug)
        if city:
            qs = qs.filter(city__iexact=city)

        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class VenueListingViewSet(viewsets.ModelViewSet):
    serializer_class = VenueListingSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    lookup_field = 'id'

    def get_queryset(self):
        qs = VenueListing.objects.all().select_related('owner')
        city = self.request.query_params.get('city')
        venue_type = self.request.query_params.get('type')
        min_cap = self.request.query_params.get('min_capacity')
        max_price = self.request.query_params.get('max_price')
        search = self.request.query_params.get('search')
        owner_me = self.request.query_params.get('my_venues')

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
        serializer.save(owner=self.request.user, slug=slug)

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.AllowAny])
    def inquiries(self, request, id=None):
        venue = self.get_object()
        if request.method == 'POST':
            data = request.data.copy()
            data['venue'] = str(venue.id)
            serializer = VenueInquirySerializer(data=data)
            if serializer.is_valid():
                serializer.save(venue=venue)
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        else:
            # Only venue owner can see inquiries
            if not request.user.is_authenticated or request.user != venue.owner:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_403_FORBIDDEN)
            inquiries = venue.inquiries.all()
            return Response(VenueInquirySerializer(inquiries, many=True).data)


class VenueInquiryViewSet(viewsets.ModelViewSet):
    serializer_class = VenueInquirySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Owners see inquiries on their venues
        return VenueInquiry.objects.filter(venue__owner=self.request.user).select_related('venue')
