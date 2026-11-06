from django.urls import path

from . import views

urlpatterns = [
    path('config/', views.public_config_view, name='site_public_config'),
    path('settings/', views.SettingsView.as_view(), name='site_analytics_settings'),
]
