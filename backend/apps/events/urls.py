from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    EventViewSet, PublicEventDetailView, GateScanView,
    GateStatsView, EventTicketListView, MyGateAssignmentView,
    StaffAssignmentManageView, EventBroadcastNotificationView,
    ExportAttendeesCSVView, EventAnalyticsView, EventFundingView,
    EventTaskViewSet
)

router = DefaultRouter()
router.register(r'tasks', EventTaskViewSet, basename='event-tasks')
router.register(r'', EventViewSet, basename='events')

urlpatterns = [
    path('my-assignment/', MyGateAssignmentView.as_view(), name='my_gate_assignment'),
    path('staff-assign/', StaffAssignmentManageView.as_view(), name='staff_assign_manage'),
    path('public/<slug:slug>/', PublicEventDetailView.as_view(), name='public_event_detail'),
    path('<uuid:event_id>/analytics/', EventAnalyticsView.as_view(), name='event_analytics'),
    path('<uuid:event_id>/funding/', EventFundingView.as_view(), name='event_funding'),
    path('<uuid:event_id>/gate/scan/', GateScanView.as_view(), name='gate_scan'),
    path('<uuid:event_id>/gate/stats/', GateStatsView.as_view(), name='gate_stats'),
    path('<uuid:event_id>/tickets/', EventTicketListView.as_view(), name='event_tickets'),
    path('<uuid:event_id>/broadcast/', EventBroadcastNotificationView.as_view(), name='event_broadcast'),
    path('<uuid:event_id>/export-attendees/', ExportAttendeesCSVView.as_view(), name='export_attendees_csv'),
    path('', include(router.urls)),
]
