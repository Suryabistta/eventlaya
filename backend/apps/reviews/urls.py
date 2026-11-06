from django.urls import path

from .views import (
    EventReviewsView, ManageReviewsView, MyReviewsView, ReviewDetailView, ReviewHideView, ReviewReplyView,
    VendorReviewsView, VenueReviewsView,
)

urlpatterns = [
    path('mine/', MyReviewsView.as_view(), name='reviews_mine'),
    path('manage/', ManageReviewsView.as_view(), name='reviews_manage'),
    path('events/<slug:key>/', EventReviewsView.as_view(), name='reviews_event'),
    path('vendors/<uuid:key>/', VendorReviewsView.as_view(), name='reviews_vendor'),
    path('venues/<uuid:key>/', VenueReviewsView.as_view(), name='reviews_venue'),
    path('<uuid:review_id>/', ReviewDetailView.as_view(), name='review_detail'),
    path('<uuid:review_id>/hide/', ReviewHideView.as_view(), name='review_hide'),
    path('<uuid:review_id>/reply/', ReviewReplyView.as_view(), name='review_reply'),
]
