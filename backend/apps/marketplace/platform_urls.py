from django.urls import path

from .models import ListingStatus, MarketplaceAccessRequest
from .platform_views import (
    ListingReviewListView, ListingReviewView,
    MarketplaceRequestListView, MarketplaceRequestReviewView,
)

APPROVED, REJECTED = MarketplaceAccessRequest.Status.APPROVED, MarketplaceAccessRequest.Status.REJECTED

urlpatterns = [
    path('marketplace-requests/', MarketplaceRequestListView.as_view(), name='platform_marketplace_requests'),
    path('marketplace-requests/<uuid:pk>/approve/', MarketplaceRequestReviewView.as_view(decision=APPROVED),
         name='platform_marketplace_request_approve'),
    path('marketplace-requests/<uuid:pk>/reject/', MarketplaceRequestReviewView.as_view(decision=REJECTED),
         name='platform_marketplace_request_reject'),
    path('listings/', ListingReviewListView.as_view(), name='platform_listings'),
    path('listings/<str:kind>/<uuid:pk>/approve/', ListingReviewView.as_view(decision=ListingStatus.APPROVED),
         name='platform_listing_approve'),
    path('listings/<str:kind>/<uuid:pk>/reject/', ListingReviewView.as_view(decision=ListingStatus.REJECTED),
         name='platform_listing_reject'),
]
