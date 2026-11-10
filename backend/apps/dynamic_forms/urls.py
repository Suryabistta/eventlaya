from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import FormViewSet, FormFieldViewSet, EventRegisterView, EventSubmissionsListView, ResponseReviewView, FormUploadView, ApplyView, EventApplicationsView, PrivateFileView

router = DefaultRouter()
router.register(r'fields', FormFieldViewSet, basename='form-fields')
router.register(r'', FormViewSet, basename='forms')

urlpatterns = [
    path('events/<slug:slug>/register/', EventRegisterView.as_view(), name='event_register'),
    path('events/<uuid:event_id>/applications/', EventApplicationsView.as_view(), name='event_applications'),
    path('events/<slug:slug>/apply/', ApplyView.as_view(), name='event_apply'),
    path('files/<uuid:event_id>/<str:name>', PrivateFileView.as_view(), name='form_private_file'),
    path('events/<slug:slug>/upload/', FormUploadView.as_view(), name='form_upload'),
    path('responses/<uuid:pk>/review/', ResponseReviewView.as_view(), name='response_review'),
    path('events/<uuid:event_id>/submissions/', EventSubmissionsListView.as_view(), name='event_submissions'),
    path('', include(router.urls)),
]
