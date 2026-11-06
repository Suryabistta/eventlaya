from django.urls import path
from . import billing_views as billing
from . import segments
from . import views

urlpatterns = [
    # White-label
    path('white-label/requests/', views.WhiteLabelRequestListCreateView.as_view(), name='platform_wl_requests'),
    path('white-label/requests/mine/', views.MyWhiteLabelRequestsView.as_view(), name='platform_wl_requests_mine'),
    path('white-label/requests/<uuid:pk>/approve/', views.WhiteLabelApproveView.as_view(), name='platform_wl_approve'),
    path('white-label/requests/<uuid:pk>/reject/', views.WhiteLabelRejectView.as_view(), name='platform_wl_reject'),
    path('white-label/requests/<uuid:pk>/revoke/', views.WhiteLabelRevokeView.as_view(), name='platform_wl_revoke'),
    path('white-label/requests/<uuid:pk>/check-domain/', views.WhiteLabelCheckDomainView.as_view(), name='platform_wl_check_domain'),
    path('white-label/requests/<uuid:pk>/reopen/', views.WhiteLabelReopenView.as_view(), name='platform_wl_reopen'),
    # Marketplace follow-ups (reviews themselves live in apps.marketplace.platform_urls)
    path('marketplace-businesses/', views.MarketplaceBusinessListView.as_view(), name='platform_marketplace_businesses'),
    path('marketplace-businesses/<uuid:pk>/revoke/', views.MarketplaceRevokeView.as_view(), name='platform_marketplace_revoke'),
    path('listings/<str:kind>/<uuid:pk>/unpublish/', views.ListingUnpublishView.as_view(), name='platform_listing_unpublish'),
    # Console
    path('stats/', views.PlatformStatsView.as_view(), name='platform_stats'),
    path('organizations/', views.OrganizationListView.as_view(), name='platform_organizations'),
    path('organizations/<uuid:pk>/', views.OrganizationDetailView.as_view(), name='platform_organization_detail'),
    path('organizations/<uuid:pk>/suspend/', views.OrganizationSuspendView.as_view(), name='platform_organization_suspend'),
    path('organizations/<uuid:pk>/activate/', views.OrganizationActivateView.as_view(), name='platform_organization_activate'),
    path('activity/', views.ActivityView.as_view(), name='platform_activity'),
    path('segments/', segments.SegmentsView.as_view(), name='platform_segments'),
    # Billing
    path('billing/plans/', billing.PlanListView.as_view(), name='platform_billing_plans'),
    path('billing/summary/', billing.BillingSummaryView.as_view(), name='platform_billing_summary'),
    path('billing/subscriptions/', billing.SubscriptionListView.as_view(), name='platform_billing_subscriptions'),
    path('billing/subscriptions/<uuid:org_id>/record-payment/', billing.RecordPaymentView.as_view(), name='platform_billing_record_payment'),
    path('billing/subscriptions/<uuid:org_id>/change-plan/', billing.ChangePlanView.as_view(), name='platform_billing_change_plan'),
    path('billing/subscriptions/<uuid:org_id>/cancel/', billing.CancelSubscriptionView.as_view(), name='platform_billing_cancel'),
    path('billing/payments/', billing.PaymentListView.as_view(), name='platform_billing_payments'),
    path('billing/payments/<uuid:pk>/refund/', billing.RefundPaymentView.as_view(), name='platform_billing_refund'),
    path('billing/upgrade-requests/', billing.UpgradeRequestListCreateView.as_view(), name='platform_billing_upgrade_requests'),
    path('billing/upgrade-requests/<uuid:pk>/approve/', billing.UpgradeRequestReviewView.as_view(decision='approve'), name='platform_billing_upgrade_approve'),
    path('billing/upgrade-requests/<uuid:pk>/decline/', billing.UpgradeRequestReviewView.as_view(decision='decline'), name='platform_billing_upgrade_decline'),
    path('billing/mine/', billing.MyBillingView.as_view(), name='platform_billing_mine'),
]
