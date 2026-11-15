"""/api/me/… — the signed-in user's own things (tickets → events module, inquiries → marketplace module)."""
from django.urls import path

from apps.events.favourites import MyFavouriteDetailView, MyFavouritesView
from apps.events.my_tickets import MyTicketDetailView, MyTicketsView
from apps.marketplace.my_inquiries import CancelMyInquiryView, MySentInquiriesView
from apps.marketplace.receipts import CustomerReceiptView

urlpatterns = [
    path('favourites/', MyFavouritesView.as_view(), name='me_favourites'),
    path('favourites/<uuid:event_id>/', MyFavouriteDetailView.as_view(), name='me_favourite_detail'),
    path('tickets/', MyTicketsView.as_view(), name='me_tickets'),
    path('tickets/<uuid:ticket_id>/', MyTicketDetailView.as_view(), name='me_ticket_detail'),
    path('inquiries/', MySentInquiriesView.as_view(), name='me_inquiries'),
    path('inquiries/<str:kind>/<uuid:pk>/cancel/', CancelMyInquiryView.as_view(), name='me_inquiry_cancel'),
    path('inquiries/<str:kind>/<uuid:pk>/receipt/', CustomerReceiptView.as_view(), name='me_inquiry_receipt'),
]
