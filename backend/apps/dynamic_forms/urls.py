from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import FormViewSet, FormFieldViewSet, EventRegisterView, EventSubmissionsListView, ResponseReviewView

router = DefaultRouter()
router.register(r'fields', FormFieldViewSet, basename='form-fields')
router.register(r'', FormViewSet, basename='forms')

urlpatterns = [
    path('events/<slug:slug>/register/', EventRegisterView.as_view(), name='event_register'),
    path('responses/<uuid:pk>/review/', ResponseReviewView.as_view(), name='response_review'),
    path('events/<uuid:event_id>/submissions/', EventSubmissionsListView.as_view(), name='event_submissions'),
    path('', include(router.urls)),
]
