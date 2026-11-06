from django.contrib import admin

from . import config
from .models import AnalyticsSettings, AnalyticsSettingsChange


@admin.register(AnalyticsSettings)
class AnalyticsSettingsAdmin(admin.ModelAdmin):
    list_display = ('measurement_id', 'enabled', 'track_app_pages', 'updated_at', 'updated_by')
    readonly_fields = ('updated_at', 'updated_by')

    def save_model(self, request, obj, form, change):
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)
        AnalyticsSettingsChange.objects.create(
            changed_by=request.user, changed_by_email=request.user.email or '',
            changes={f: ['?', form.cleaned_data.get(f)] for f in form.changed_data})
        config.clear_cache()


@admin.register(AnalyticsSettingsChange)
class AnalyticsSettingsChangeAdmin(admin.ModelAdmin):
    list_display = ('changed_at', 'changed_by_email', 'changes')
    readonly_fields = ('changed_at', 'changed_by', 'changed_by_email', 'changes')

    def has_add_permission(self, request):
        return False
