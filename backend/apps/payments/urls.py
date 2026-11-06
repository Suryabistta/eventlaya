from django.urls import path

from . import views

urlpatterns = [
    path('providers/', views.ProvidersView.as_view(), name='payment_providers'),
    path('mine/', views.MyPaymentsView.as_view(), name='my_payments'),
    path('intents/<uuid:intent_id>/', views.IntentStatusView.as_view(), name='payment_intent'),
    path('intents/<uuid:intent_id>/checkout/', views.IntentCheckoutView.as_view(), name='payment_checkout'),
    path('intents/<uuid:intent_id>/refund/', views.IntentRefundView.as_view(), name='payment_refund'),
    # Provider returns (the browser comes back here; we verify server to server, then redirect to the web app)
    path('return/khalti/<uuid:intent_id>/', views.KhaltiReturnView.as_view(), name='payment_return_khalti'),
    path('return/esewa/<uuid:intent_id>/<str:outcome>/', views.EsewaReturnView.as_view(), name='payment_return_esewa'),
    path('return/test/<uuid:intent_id>/', views.TestReturnView.as_view(), name='payment_return_test'),
    path('test/<uuid:intent_id>/', views.TestCheckoutPage.as_view(), name='payment_test_page'),
    # Organizer
    path('organizer/payments/', views.OrganizerPaymentsView.as_view(), name='organizer_payments'),
    path('organizer/summary/', views.OrganizerSummaryView.as_view(), name='organizer_payment_summary'),
    # Superadmin
    path('admin/overview/', views.AdminOverviewView.as_view(), name='payments_admin_overview'),
    path('admin/payments/', views.AdminPaymentsView.as_view(), name='payments_admin_list'),
    path('admin/payments/<uuid:intent_id>/', views.AdminPaymentDetailView.as_view(), name='payments_admin_detail'),
    path('admin/settings/', views.AdminSettingsView.as_view(), name='payments_admin_settings'),
    path('admin/payouts/', views.AdminPayoutsView.as_view(), name='payments_admin_payouts'),
    path('admin/payouts/<uuid:payout_id>/', views.AdminPayoutDetailView.as_view(), name='payments_admin_payout'),
]
