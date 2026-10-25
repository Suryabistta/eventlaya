from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    RegisterView, CurrentUserView, CustomTokenObtainPairView, FCMTokenView,
    UserModulesView, SuperadminRBACManageView, SuperadminToggleModuleView,
    TenantBrandingView, TenantVerifyDomainView, TenantResolveView
)

urlpatterns = [
    path('register/', RegisterView.as_view(), name='auth_register'),
    path('login/', CustomTokenObtainPairView.as_view(), name='auth_login'),
    path('refresh/', TokenRefreshView.as_view(), name='auth_refresh'),
    path('me/', CurrentUserView.as_view(), name='auth_me'),
    path('fcm-token/', FCMTokenView.as_view(), name='fcm_token'),
    path('modules/', UserModulesView.as_view(), name='user_modules'),
    path('rbac/', SuperadminRBACManageView.as_view(), name='superadmin_rbac'),
    path('rbac/toggle/', SuperadminToggleModuleView.as_view(), name='superadmin_rbac_toggle'),
    path('tenant-branding/', TenantBrandingView.as_view(), name='tenant_branding'),
    path('tenant-branding/verify-domain/', TenantVerifyDomainView.as_view(), name='tenant_verify_domain'),
    path('tenant-branding/resolve/', TenantResolveView.as_view(), name='tenant_resolve'),
]
