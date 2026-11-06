"""GET /api/site/config/ (public: what the browser loads) and GET/PUT /api/site/settings/ (superadmin).

The URLs avoid the word "analytics" on purpose: ad blockers block such paths, which would break the admin page.
"""
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import config
from .models import AnalyticsSettings, AnalyticsSettingsChange

HISTORY_LIMIT = 20


@require_GET
def public_config_view(request):
    response = JsonResponse(config.public_config(request))
    # Short: a switch-off in the console reaches visitors within a couple of minutes
    response['Cache-Control'] = 'public, max-age=60'
    response['Vary'] = 'Host, X-Tenant-Host'
    return response


class IsSuperadmin(permissions.BasePermission):
    message = 'Only platform admins can do this.'

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and getattr(request.user, 'is_superadmin', False))


class SettingsSerializer(serializers.ModelSerializer):
    # Long input allowed: a pasted snippet is reduced to the value (and checked) in validate_<field>
    measurement_id = serializers.CharField(allow_blank=True, required=False, max_length=5000, trim_whitespace=True)
    google_site_verification = serializers.CharField(allow_blank=True, required=False, max_length=5000)
    bing_site_verification = serializers.CharField(allow_blank=True, required=False, max_length=5000)
    cloudflare_token = serializers.CharField(allow_blank=True, required=False, max_length=5000)

    class Meta:
        model = AnalyticsSettings
        fields = config.FIELDS

    def _clean(self, fn, value):
        try:
            return fn(value)
        except ValueError as e:
            raise serializers.ValidationError(str(e))

    def validate_measurement_id(self, value):
        return self._clean(config.clean_measurement_id, value)

    def validate_google_site_verification(self, value):
        return self._clean(config.clean_google_verification, value)

    def validate_bing_site_verification(self, value):
        return self._clean(config.clean_bing_verification, value)

    def validate_cloudflare_token(self, value):
        return self._clean(config.clean_cloudflare_token, value)


def _values(row):
    if row is None:
        return {'enabled': True, 'measurement_id': '', 'track_app_pages': False, 'google_site_verification': '',
                'bing_site_verification': '', 'cloudflare_token': ''}
    return {f: getattr(row, f) for f in config.FIELDS}


def _payload(row):
    eff = config.compute(row)
    history = AnalyticsSettingsChange.objects.select_related('changed_by')[:HISTORY_LIMIT]
    return {
        'settings': _values(row),
        'saved': row is not None,
        'updated_at': row.updated_at if row else None,
        'updated_by_email': (row.updated_by.email if row and row.updated_by else None),
        'env_measurement_id': config.env_measurement_id(),
        'effective': eff.as_dict(),
        'history': [
            {'id': h.id, 'changed_at': h.changed_at, 'changed_by_email': h.changed_by_email or (h.changed_by.email if h.changed_by else ''),
             'changes': h.changes}
            for h in history
        ],
    }


class SettingsView(APIView):
    """The superadmin's Analytics page. PUT/PATCH saves (partial updates allowed) and logs who changed what."""

    permission_classes = [IsSuperadmin]

    def get(self, request):
        return Response(_payload(config.stored()))

    def put(self, request):
        return self._save(request)

    def patch(self, request):
        return self._save(request)

    def _save(self, request):
        row = config.stored()
        before = _values(row)
        serializer = SettingsSerializer(row, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response({**serializer.errors, 'error': _first_error(serializer.errors)}, status=status.HTTP_400_BAD_REQUEST)
        after = {**before, **serializer.validated_data}
        changes = {f: [before[f], after[f]] for f in config.FIELDS if before[f] != after[f]}
        if row is not None and not changes:
            return Response(_payload(row))
        row = serializer.save(updated_by=request.user) if row is not None else AnalyticsSettings.objects.create(
            **after, updated_by=request.user)
        AnalyticsSettingsChange.objects.create(changed_by=request.user, changed_by_email=request.user.email or '',
                                               changes=changes)
        config.clear_cache()
        return Response(_payload(config.stored()))


def _first_error(errors):
    for messages in errors.values():
        if messages:
            return str(messages[0])
    return 'Check the values.'
