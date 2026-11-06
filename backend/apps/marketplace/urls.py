from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    VendorCategoryViewSet, VendorProfileViewSet,
    VenueListingViewSet, VenueInquiryViewSet,
    MyListingsView, MyInquiriesView, MyInquiryDetailView, MyVendorInquiriesView, MyVendorInquiryDetailView,
    OwnerDecisionView, AccessRequestCreateView, AccessRequestMineView,
)
from .slot_views import MySlotDetailView, MySlotsBlockView, MySlotsBulkView, MySlotsView

router = DefaultRouter()
router.register(r'categories', VendorCategoryViewSet, basename='vendor-categories')
router.register(r'vendors', VendorProfileViewSet, basename='vendors')
router.register(r'venues', VenueListingViewSet, basename='venues')
router.register(r'inquiries', VenueInquiryViewSet, basename='inquiries')

urlpatterns = [
    path('my/listings/', MyListingsView.as_view(), name='marketplace_my_listings'),
    path('my/inquiries/', MyInquiriesView.as_view(), name='marketplace_my_inquiries'),
    path('my/inquiries/<uuid:pk>/', MyInquiryDetailView.as_view(), name='marketplace_my_inquiry_detail'),
    path('my/vendor-inquiries/', MyVendorInquiriesView.as_view(), name='marketplace_my_vendor_inquiries'),
    path('my/vendor-inquiries/<uuid:pk>/', MyVendorInquiryDetailView.as_view(), name='marketplace_my_vendor_inquiry_detail'),
    path('my/inquiries/<uuid:pk>/confirm/', OwnerDecisionView.as_view(kind='venue', decision='confirm'),
         name='marketplace_my_inquiry_confirm'),
    path('my/inquiries/<uuid:pk>/decline/', OwnerDecisionView.as_view(kind='venue', decision='decline'),
         name='marketplace_my_inquiry_decline'),
    path('my/vendor-inquiries/<uuid:pk>/confirm/', OwnerDecisionView.as_view(kind='vendor', decision='confirm'),
         name='marketplace_my_vendor_inquiry_confirm'),
    path('my/vendor-inquiries/<uuid:pk>/decline/', OwnerDecisionView.as_view(kind='vendor', decision='decline'),
         name='marketplace_my_vendor_inquiry_decline'),
    path('my/slots/', MySlotsView.as_view(), name='marketplace_my_slots'),
    path('my/slots/bulk/', MySlotsBulkView.as_view(), name='marketplace_my_slots_bulk'),
    path('my/slots/block/', MySlotsBlockView.as_view(), name='marketplace_my_slots_block'),
    path('my/slots/<uuid:pk>/', MySlotDetailView.as_view(), name='marketplace_my_slot_detail'),
    path('access-requests/', AccessRequestCreateView.as_view(), name='marketplace_access_request_create'),
    path('access-requests/mine/', AccessRequestMineView.as_view(), name='marketplace_access_request_mine'),
    path('', include(router.urls)),
]
