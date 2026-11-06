from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register(r'admin/posts', views.AdminPostViewSet, basename='blog-admin-posts')

urlpatterns = [
    path('status/', views.BlogStatusView.as_view(), name='blog_status'),
    path('posts/', views.PostListView.as_view(), name='blog_posts'),
    path('posts/<slug:slug>/', views.PostDetailView.as_view(), name='blog_post_detail'),
    path('topics/', views.TopicsView.as_view(), name='blog_topics'),
    path('admin/preview/', views.AdminPreviewView.as_view(), name='blog_admin_preview'),
    path('admin/options/', views.AdminOptionsView.as_view(), name='blog_admin_options'),
    path('', include(router.urls)),
]
