"""Site-wide web analytics settings: Google Analytics 4, search-engine verification tags, Cloudflare Web Analytics.

One row (pk=1), edited by the superadmin in the console (Admin → Analytics); every change is logged in
AnalyticsSettingsChange. While there is no row, the GA_MEASUREMENT_ID environment variable is used (switched on).
How it is used: apps/site_analytics/config.py, docs/analytics.md.
"""
from django.conf import settings
from django.db import models


class AnalyticsSettings(models.Model):
    enabled = models.BooleanField(
        default=True, help_text='Master switch: Google Analytics (and Cloudflare Web Analytics) on eventlaya.com.')
    measurement_id = models.CharField(
        max_length=20, blank=True, help_text='GA4 Measurement ID, e.g. G-ABC123XYZ9. Empty: GA_MEASUREMENT_ID from the environment.')
    track_app_pages = models.BooleanField(
        default=False, help_text='Also measure signed-in pages (/app, /admin, /judge). Off: public pages only.')
    google_site_verification = models.CharField(
        max_length=100, blank=True, help_text='Search Console: content of the google-site-verification meta tag.')
    bing_site_verification = models.CharField(
        max_length=100, blank=True, help_text='Bing Webmaster Tools: content of the msvalidate.01 meta tag.')
    cloudflare_token = models.CharField(max_length=64, blank=True, help_text='Cloudflare Web Analytics site token (optional).')
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
        verbose_name = 'analytics settings'
        verbose_name_plural = 'analytics settings'

    def __str__(self):
        return f'Analytics settings ({self.measurement_id or "no ID"}, {"on" if self.enabled else "off"})'

    def save(self, *args, **kwargs):
        self.pk = 1  # singleton
        super().save(*args, **kwargs)


class AnalyticsSettingsChange(models.Model):
    """Audit trail: who changed which setting, from what to what."""

    changed_at = models.DateTimeField(auto_now_add=True, db_index=True)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    # Kept even if the account is deleted later
    changed_by_email = models.EmailField(blank=True)
    # {field: [old, new]}
    changes = models.JSONField(default=dict)

    class Meta:
        ordering = ['-changed_at', '-id']

    def __str__(self):
        return f'{self.changed_by_email or "?"} changed {", ".join(self.changes)} at {self.changed_at:%Y-%m-%d %H:%M}'
