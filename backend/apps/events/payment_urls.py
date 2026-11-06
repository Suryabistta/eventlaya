"""Mounted at /api/payments/events/ (payments module): per-event payment options."""
from django.urls import path

from .online_payments import EventPaymentSettingsView

urlpatterns = [
    path('<uuid:event_id>/settings/', EventPaymentSettingsView.as_view(), name='event_payment_settings'),
]
