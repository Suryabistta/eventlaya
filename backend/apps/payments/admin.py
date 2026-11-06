from django.contrib import admin

from .models import PaymentIntent, PaymentLog, PaymentSettings, Payout


class PaymentLogInline(admin.TabularInline):
    model = PaymentLog
    extra = 0
    can_delete = False
    readonly_fields = ['created_at', 'kind', 'message', 'data', 'actor']


@admin.register(PaymentIntent)
class PaymentIntentAdmin(admin.ModelAdmin):
    list_display = ['created_at', 'purpose', 'description', 'amount', 'provider', 'status', 'payer_email', 'organizer']
    list_filter = ['status', 'provider', 'purpose']
    search_fields = ['id', 'reference', 'provider_ref', 'provider_txn_id', 'payer_email', 'payer_name', 'description']
    readonly_fields = [f.name for f in PaymentIntent._meta.fields]
    inlines = [PaymentLogInline]


@admin.register(Payout)
class PayoutAdmin(admin.ModelAdmin):
    list_display = ['paid_on', 'organizer', 'event', 'amount', 'method', 'reference']


admin.site.register(PaymentSettings)
