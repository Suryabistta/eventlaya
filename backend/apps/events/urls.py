from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import EventViewSet, PublicEventDetailView, GateScanView, GateStatsView, EventTicketListView

router = DefaultRouter()
router.register(r'', EventViewSet, basename='events')

urlpatterns = [
    path('public/<slug:slug>/', PublicEventDetailView.as_view(), name='public_event_detail'),
    path('<uuid:event_id>/gate/scan/', GateScanView.as_view(), name='gate_scan'),
    path('<uuid:event_id>/gate/stats/', GateStatsView.as_view(), name='gate_stats'),
    path('<uuid:event_id>/tickets/', EventTicketListView.as_view(), name='event_tickets'),
    path('', include(router.urls)),
]
