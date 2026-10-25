from rest_framework import viewsets, permissions
from .models import VendorCategory, VendorProfile
from .serializers import VendorCategorySerializer, VendorProfileSerializer

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
