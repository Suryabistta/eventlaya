from django.contrib import admin
from .models import Payment, Plan, PlanChangeRequest, Subscription, WhiteLabelRequest


@admin.register(WhiteLabelRequest)
class WhiteLabelRequestAdmin(admin.ModelAdmin):
    list_display = ('brand_name', 'organizer', 'requested_domain', 'remove_watermark', 'status', 'created_at', 'reviewed_at')
    list_filter = ('status', 'remove_watermark')
    search_fields = ('brand_name', 'requested_domain', 'organizer__email', 'organizer__organization_name')
    readonly_fields = ('created_at', 'reviewed_at', 'reviewed_by')
    raw_id_fields = ('organizer',)


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'monthly_price', 'yearly_price', 'attendee_limit', 'is_active', 'order')
    list_editable = ('is_active', 'order')


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ('organization', 'plan', 'status', 'billing_cycle', 'current_period_end', 'auto_renew')
    list_filter = ('plan', 'status', 'billing_cycle')
    search_fields = ('organization__email', 'organization__organization_name')
    raw_id_fields = ('organization',)


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ('organization', 'amount', 'method', 'plan', 'months_covered', 'paid_at', 'status')
    list_filter = ('method', 'status', 'plan')
    search_fields = ('organization__email', 'reference')
    raw_id_fields = ('organization', 'subscription')
    readonly_fields = ('recorded_by',)


@admin.register(PlanChangeRequest)
class PlanChangeRequestAdmin(admin.ModelAdmin):
    list_display = ('organization', 'requested_plan', 'billing_cycle', 'status', 'created_at')
    list_filter = ('status', 'requested_plan')
    raw_id_fields = ('organization',)
