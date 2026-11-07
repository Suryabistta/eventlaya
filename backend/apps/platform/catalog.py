"""Cities and banners: public read (live only), superadmin create/update/delete. ?all=1 as superadmin includes hidden ones."""
from django.db.models import Q
from django.utils import timezone
from rest_framework import permissions, serializers, viewsets

from .models import Banner, City
from .views import IsSuperadmin


class CitySerializer(serializers.ModelSerializer):
    def validate_name(self, value):
        value = value.strip()
        clash = City.objects.filter(name__iexact=value)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError('That city is already in the list.')
        return value

    class Meta:
        model = City
        fields = ['id', 'name', 'province', 'order', 'is_active']


class ReadPublicWriteSuperadmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.method in permissions.SAFE_METHODS or IsSuperadmin().has_permission(request, view)


def include_inactive(request):
    return request.query_params.get('all') == '1' and IsSuperadmin().has_permission(request, None)


class CityViewSet(viewsets.ModelViewSet):
    serializer_class = CitySerializer
    permission_classes = [ReadPublicWriteSuperadmin]
    pagination_class = None

    def get_queryset(self):
        qs = City.objects.all()
        return qs if include_inactive(self.request) or self.action != 'list' else qs.filter(is_active=True)


def safe_url(value, field):
    """Site paths or https links only (no javascript:, data: and the like)."""
    value = (value or '').strip()
    if value and not (value.startswith('/') and not value.startswith('//') or value.startswith('https://') or value.startswith('http://')):
        raise serializers.ValidationError(f'{field} must be a link starting with / or https://.')
    return value


class BannerSerializer(serializers.ModelSerializer):
    def validate_image(self, value):
        if not (value or '').strip():
            raise serializers.ValidationError('Upload an image.')
        return safe_url(value, 'Image')

    def validate_link(self, value):
        return safe_url(value, 'Link')

    def validate(self, attrs):
        starts = attrs.get('starts_at', getattr(self.instance, 'starts_at', None))
        ends = attrs.get('ends_at', getattr(self.instance, 'ends_at', None))
        if starts and ends and ends <= starts:
            raise serializers.ValidationError({'ends_at': 'The end must be after the start.'})
        return attrs

    class Meta:
        model = Banner
        fields = ['id', 'placement', 'image', 'title', 'link', 'order', 'is_active', 'starts_at', 'ends_at']


class BannerViewSet(viewsets.ModelViewSet):
    """GET ?placement=marketplace → live slides. The `banners` module switch is enforced by ModuleAccessMiddleware."""
    serializer_class = BannerSerializer
    permission_classes = [ReadPublicWriteSuperadmin]
    pagination_class = None

    def get_queryset(self):
        qs = Banner.objects.all()
        placement = self.request.query_params.get('placement')
        if placement:
            qs = qs.filter(placement=placement)
        if self.action != 'list' or include_inactive(self.request):
            return qs
        now = timezone.now()
        return qs.filter(is_active=True).filter(Q(starts_at__isnull=True) | Q(starts_at__lte=now)).filter(
            Q(ends_at__isnull=True) | Q(ends_at__gt=now)
        )
