from django.contrib import admin
from .models import User, FCMToken, PlatformModule, RoleModulePermission

@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ('email', 'role', 'organization_name', 'is_active', 'is_staff')
    search_fields = ('email', 'organization_name')
    list_filter = ('role', 'is_active')

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

