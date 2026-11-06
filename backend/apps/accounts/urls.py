from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import SessionAwareRefreshView
from .team import TeamListView, TeamMemberView
from .password_reset import PasswordResetRequestView, PasswordResetConfirmView
from .account import ChangePasswordView
from .social import FacebookLoginView, GoogleLoginView, SocialConfigView
from .verification import SendVerificationCodeView, VerifyEmailView
from .views import (
    RegisterView, CurrentUserView, CustomTokenObtainPairView, FCMTokenView,
    UserModulesView, SuperadminRBACManageView, SuperadminToggleModuleView,
    TenantBrandingView, TenantVerifyDomainView, TenantResolveView, EmailAvailableView
)

urlpatterns = [
    path('register/', RegisterView.as_view(), name='auth_register'),
    path('email-available/', EmailAvailableView.as_view(), name='auth_email_available'),
    path('login/', CustomTokenObtainPairView.as_view(), name='auth_login'),
    path('password-reset/', PasswordResetRequestView.as_view(), name='auth_password_reset'),
    path('password-reset/confirm/', PasswordResetConfirmView.as_view(), name='auth_password_reset_confirm'),
    path('refresh/', SessionAwareRefreshView.as_view(), name='auth_refresh'),
    path('me/', CurrentUserView.as_view(), name='auth_me'),
    path('password/', ChangePasswordView.as_view(), name='auth_change_password'),
    path('email/send-code/', SendVerificationCodeView.as_view(), name='auth_email_send_code'),
    path('email/verify/', VerifyEmailView.as_view(), name='auth_email_verify'),
    path('social/config/', SocialConfigView.as_view(), name='auth_social_config'),
    path('social/google/', GoogleLoginView.as_view(), name='auth_social_google'),
    path('social/facebook/', FacebookLoginView.as_view(), name='auth_social_facebook'),
    path('fcm-token/', FCMTokenView.as_view(), name='fcm_token'),
    path('modules/', UserModulesView.as_view(), name='user_modules'),
    path('rbac/', SuperadminRBACManageView.as_view(), name='superadmin_rbac'),
    path('rbac/toggle/', SuperadminToggleModuleView.as_view(), name='superadmin_rbac_toggle'),
    path('team/', TeamListView.as_view(), name='team_list'),
    path('team/<uuid:member_id>/', TeamMemberView.as_view(), name='team_member'),
    path('tenant-branding/', TenantBrandingView.as_view(), name='tenant_branding'),
    path('tenant-branding/verify-domain/', TenantVerifyDomainView.as_view(), name='tenant_verify_domain'),
    path('tenant-branding/resolve/', TenantResolveView.as_view(), name='tenant_resolve'),
]
