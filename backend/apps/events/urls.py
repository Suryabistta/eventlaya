from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    EventViewSet, PublicEventListView, PublicEventDetailView, GateScanView,
    GateStatsView, EventTicketListView, MyGateAssignmentView,
    StaffAssignmentManageView, EventBroadcastNotificationView,
    ExportAttendeesCSVView, EventAnalyticsView, EventFundingView,
    EventTaskViewSet, EventGateListView, EventGateDetailView, EventPageView, PublicPassView
)

from .online_payments import EventOrderActionView, EventOrdersView
from .ticketing import (
    TicketTypeListView, TicketTypeDetailView, TicketPresetView,
    PromoCodeListView, PromoCodeDetailView, PublicPromoCheckView,
)

router = DefaultRouter()
router.register(r'tasks', EventTaskViewSet, basename='event-tasks')
router.register(r'', EventViewSet, basename='events')

urlpatterns = [
    path('my-assignment/', MyGateAssignmentView.as_view(), name='my_gate_assignment'),
    path('staff-assign/', StaffAssignmentManageView.as_view(), name='staff_assign_manage'),
    path('public/', PublicEventListView.as_view(), name='public_event_list'),
    path('public/<slug:slug>/', PublicEventDetailView.as_view(), name='public_event_detail'),
    path('passes/<str:token>/', PublicPassView.as_view(), name='public_pass'),
    path('public/<slug:slug>/promo/', PublicPromoCheckView.as_view(), name='public_promo_check'),
    path('<uuid:event_id>/ticket-types/', TicketTypeListView.as_view(), name='ticket_types'),
    path('<uuid:event_id>/ticket-types/preset/', TicketPresetView.as_view(), name='ticket_type_preset'),
    path('<uuid:event_id>/ticket-types/<uuid:type_id>/', TicketTypeDetailView.as_view(), name='ticket_type_detail'),
    path('<uuid:event_id>/promo-codes/', PromoCodeListView.as_view(), name='promo_codes'),
    path('<uuid:event_id>/promo-codes/<uuid:code_id>/', PromoCodeDetailView.as_view(), name='promo_code_detail'),
    path('<uuid:event_id>/orders/', EventOrdersView.as_view(), name='event_orders'),
    path('<uuid:event_id>/orders/<uuid:order_id>/<str:action>/', EventOrderActionView.as_view(), name='event_order_action'),
    path('<uuid:event_id>/analytics/', EventAnalyticsView.as_view(), name='event_analytics'),
    path('<uuid:event_id>/funding/', EventFundingView.as_view(), name='event_funding'),
    path('<uuid:event_id>/page/', EventPageView.as_view(), name='event_page'),
    path('<uuid:event_id>/gates/', EventGateListView.as_view(), name='event_gates'),
    path('<uuid:event_id>/gates/<uuid:gate_id>/', EventGateDetailView.as_view(), name='event_gate_detail'),
    path('<uuid:event_id>/gate/scan/', GateScanView.as_view(), name='gate_scan'),
    path('<uuid:event_id>/gate/stats/', GateStatsView.as_view(), name='gate_stats'),
    path('<uuid:event_id>/tickets/', EventTicketListView.as_view(), name='event_tickets'),
    path('<uuid:event_id>/broadcast/', EventBroadcastNotificationView.as_view(), name='event_broadcast'),
    path('<uuid:event_id>/export-attendees/', ExportAttendeesCSVView.as_view(), name='export_attendees_csv'),
    path('', include(router.urls)),
]
