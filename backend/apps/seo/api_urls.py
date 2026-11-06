from django.urls import path

from . import views

urlpatterns = [
    path('meta/', views.meta_api, name='seo_meta'),
]
