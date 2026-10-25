from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import VendorCategoryViewSet, VendorProfileViewSet

router = DefaultRouter()
router.register(r'categories', VendorCategoryViewSet, basename='vendor-categories')
router.register(r'vendors', VendorProfileViewSet, basename='vendors')

urlpatterns = [
    path('', include(router.urls)),
]
