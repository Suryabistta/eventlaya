from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from apps.core.uploads import ImageUploadView

urlpatterns = [
    path('admin/', admin.site.urls),
    
    # API endpoints
    path('api/auth/', include('apps.accounts.urls')),
    path('api/events/', include('apps.events.urls')),
    path('api/forms/', include('apps.dynamic_forms.urls')),
    path('api/voting/', include('apps.voting.urls')),
    path('api/marketplace/', include('apps.marketplace.urls')),
    path('api/uploads/', ImageUploadView.as_view(), name='image_upload'),
    path('api/platform/', include('apps.platform.urls')),
    path('api/platform/', include('apps.marketplace.platform_urls')),
    path('api/chat/', include('apps.chat.urls')),
    path('api/reviews/', include('apps.reviews.urls')),
    path('api/payments/events/', include('apps.events.payment_urls')),  # per-event payment options
    path('api/payments/', include('apps.payments.urls')),
    path('api/me/', include('apps.accounts.me_urls')),
    path('api/blog/', include('apps.blog.urls')),
    path('api/seo/', include('apps.seo.api_urls')),
    path('api/site/', include('apps.site_analytics.urls')),  # analytics config (public) + superadmin settings

    # OpenAPI Schema & Docs
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),

    # robots.txt, sitemaps, llms.txt and server-rendered metadata for public pages (apps/seo, docs/seo.md)
    path('', include('apps.seo.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
