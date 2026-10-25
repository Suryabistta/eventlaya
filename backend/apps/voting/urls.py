from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import PollViewSet, CandidateViewSet, CastVoteView

router = DefaultRouter()
router.register(r'polls', PollViewSet, basename='polls')
router.register(r'candidates', CandidateViewSet, basename='candidates')

urlpatterns = [
    path('polls/<uuid:poll_id>/vote/', CastVoteView.as_view(), name='cast_vote'),
    path('', include(router.urls)),
]
