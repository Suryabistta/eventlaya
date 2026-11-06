"""Site-level URLs served by Django for eventlaya.com and white-label hosts (Nginx routes them here)."""
from django.urls import path, re_path

from . import views

urlpatterns = [
    path('robots.txt', views.robots_txt, name='robots_txt'),
    path('sitemap.xml', views.sitemap_xml, name='sitemap_xml'),
    re_path(r'^sitemaps/(?P<section>[a-z]+)\.xml$', views.sitemap_section, name='sitemap_section'),
    path('llms.txt', views.llms_txt, name='llms_txt'),
    path('llms-full.txt', views.llms_full_txt, name='llms_full_txt'),
    # The homepage (Nginx sends / here on eventlaya.com so the Search Console / Bing verification tags saved in
    # Admin → Analytics are always current; it serves the prerendered copy).
    path('', views.page_view, name='seo_home'),
    # Pages with server-visible metadata. /e/... is routed whole so other apps can register pages under it.
    re_path(r'^(?P<path>e/.+|blog|blog/[^/]+|marketplace/venues/[^/]+|marketplace/vendors/[^/]+)/?$',
            views.page_view, name='seo_page'),
]
