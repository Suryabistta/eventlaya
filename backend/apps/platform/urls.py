from django.urls import include, path
from rest_framework.routers import DefaultRouter
from . import billing_views as billing
from . import sms_views as sms
from . import segments
from . import featured_events, org_admin, views
from .catalog import BannerViewSet, CityViewSet, EventCategoryViewSet, SiteBrandingView

router = DefaultRouter()
router.register(r'cities', CityViewSet, basename='platform-cities')
router.register(r'banners', BannerViewSet, basename='platform-banners')
router.register(r'event-categories', EventCategoryViewSet, basename='platform-event-categories')

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
    path('organizations/<uuid:pk>/reset-password/', org_admin.OrganizationResetPasswordView.as_view(), name='platform_organization_reset_password'),
    path('organizations/<uuid:pk>/verify/', org_admin.OrganizationVerifyView.as_view(), name='platform_organization_verify'),
    path('site-branding/', SiteBrandingView.as_view(), name='platform_site_branding'),
    path('events/', featured_events.FeaturedEventListView.as_view(), name='platform_events'),
    path('events/<uuid:pk>/feature/', featured_events.FeatureEventView.as_view(), name='platform_event_feature'),
    path('activity/', views.ActivityView.as_view(), name='platform_activity'),
    path('segments/', segments.SegmentsView.as_view(), name='platform_segments'),
    # Billing
    path('billing/plans/', billing.PlanListView.as_view(), name='platform_billing_plans'),
    path('billing/plans/<str:code>/sms/', billing.PlanSmsView.as_view(), name='platform_billing_plan_sms'),
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
    path('sms/mine/', sms.MySmsView.as_view(), name='platform_sms_mine'),
    path('sms/requests/', sms.SmsRequestListView.as_view(), name='platform_sms_requests'),
    path('sms/requests/<uuid:pk>/approve/', sms.SmsRequestReviewView.as_view(decision='approve'), name='platform_sms_approve'),
    path('sms/requests/<uuid:pk>/decline/', sms.SmsRequestReviewView.as_view(decision='decline'), name='platform_sms_decline'),
    path('sms/orgs/<uuid:org_id>/', sms.OrgSmsView.as_view(), name='platform_sms_org'),
    path('', include(router.urls)),
]
