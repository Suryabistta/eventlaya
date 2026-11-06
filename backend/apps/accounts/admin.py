from django.contrib import admin
from .models import User, FCMToken, PlatformModule, RoleModulePermission, EmailVerificationCode, SocialAccount

@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ('email', 'role', 'marketplace_access', 'organization_name', 'email_verified', 'is_active', 'is_staff')
    search_fields = ('email', 'organization_name')
    list_filter = ('role', 'marketplace_access', 'email_verified', 'is_active')
    readonly_fields = ('terms_accepted_at', 'terms_version')


@admin.register(SocialAccount)
class SocialAccountAdmin(admin.ModelAdmin):
    list_display = ('user', 'provider', 'provider_uid', 'email', 'last_login_at', 'created_at')
    search_fields = ('user__email', 'email', 'provider_uid')
    list_filter = ('provider',)
    raw_id_fields = ('user',)


@admin.register(EmailVerificationCode)
class EmailVerificationCodeAdmin(admin.ModelAdmin):
    list_display = ('user', 'email', 'attempts', 'expires_at', 'used_at', 'created_at')
    search_fields = ('user__email', 'email')
    readonly_fields = ('code_hash',)
    raw_id_fields = ('user',)

@admin.register(FCMToken)
class FCMTokenAdmin(admin.ModelAdmin):
    list_display = ('user', 'platform', 'token', 'updated_at')
    search_fields = ('user__email', 'token')
    list_filter = ('platform',)

@admin.register(PlatformModule)
class PlatformModuleAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'is_globally_enabled', 'order', 'created_at')
    list_editable = ('is_globally_enabled', 'order')
    search_fields = ('name', 'slug', 'description')
    list_filter = ('is_globally_enabled',)

@admin.register(RoleModulePermission)
class RoleModulePermissionAdmin(admin.ModelAdmin):
    list_display = ('role', 'module', 'is_enabled', 'can_view', 'can_create', 'can_edit', 'can_delete')
    list_editable = ('is_enabled', 'can_view', 'can_create', 'can_edit', 'can_delete')
    list_filter = ('role', 'is_enabled', 'module')



from .models import TenantBranding

@admin.register(TenantBranding)
class TenantBrandingAdmin(admin.ModelAdmin):
    list_display = ('brand_name', 'organizer', 'subdomain', 'custom_domain', 'dns_status', 'is_domain_verified', 'ssl_active',
                    'ssl_provider', 'provider_status')
    search_fields = ('brand_name', 'subdomain', 'custom_domain', 'organizer__email')
    list_filter = ('dns_status', 'is_domain_verified', 'ssl_active', 'ssl_provider')
    readonly_fields = ('verification_token', 'dns_checked_at', 'verified_at', 'provider_hostname_id', 'provider_status',
                       'provider_ssl_status', 'provider_message', 'provider_synced_at')
