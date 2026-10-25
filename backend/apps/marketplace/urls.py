from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    VendorCategoryViewSet, VendorProfileViewSet,
    VenueListingViewSet, VenueInquiryViewSet
)

router = DefaultRouter()
router.register(r'categories', VendorCategoryViewSet, basename='vendor-categories')
router.register(r'vendors', VendorProfileViewSet, basename='vendors')
router.register(r'venues', VenueListingViewSet, basename='venues')
router.register(r'inquiries', VenueInquiryViewSet, basename='inquiries')

urlpatterns = [
    path('', include(router.urls)),
]
