import re
from rest_framework import serializers
from apps.accounts.models import TenantBranding
from .models import WhiteLabelRequest

HEX = re.compile(r'^#[0-9a-fA-F]{6}$')


class WhiteLabelRequestSerializer(serializers.ModelSerializer):
    organizer_email = serializers.CharField(source='organizer.email', read_only=True)
    organizer_name = serializers.SerializerMethodField()
    reviewed_by_email = serializers.CharField(source='reviewed_by.email', read_only=True, default=None)
    tenant = serializers.SerializerMethodField()

    class Meta:
        model = WhiteLabelRequest
        fields = [
            'id', 'organizer', 'organizer_email', 'organizer_name',
            'requested_domain', 'brand_name', 'logo_url', 'primary_color', 'accent_color',
            'remove_watermark', 'note', 'status', 'review_note', 'reviewed_by_email',
            'created_at', 'reviewed_at', 'tenant',
        ]
        read_only_fields = [
            'id', 'organizer', 'status', 'review_note', 'reviewed_by_email', 'created_at', 'reviewed_at',
        ]

    def get_tenant(self, obj):
        """Live domain state for approved requests (admin tenant list)."""
        if obj.status != WhiteLabelRequest.Status.APPROVED:
            return None
        from apps.accounts.domains import domain_status
        b = TenantBranding.objects.filter(organizer_id=obj.organizer_id).select_related('organizer').first()
        if not b:
            return None
        return {
            'subdomain': b.subdomain, 'custom_domain': b.custom_domain,
            'is_domain_verified': b.is_domain_verified, 'ssl_active': b.ssl_active,
            'status': domain_status(b, approved=True),
        }

    def get_organizer_name(self, obj):
        u = obj.organizer
        return u.organization_name or u.get_full_name() or u.email

    def validate_requested_domain(self, value):
        from apps.accounts.tenancy import custom_domain_error
        value = (value or '').strip().lower().rstrip('.')
        if not value:
            return ''
        error = custom_domain_error(value, self.context['request'].user)
        if error:
            raise serializers.ValidationError(error)
        return value

    def validate_brand_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Enter the name attendees should see.')
        return value

    def _color(self, value):
        if not HEX.match(value or ''):
            raise serializers.ValidationError('Use a 6-digit hex code like #C2215A.')
        return value.upper()

    def validate_primary_color(self, value):
        return self._color(value)

    def validate_accent_color(self, value):
        return self._color(value)


class ReviewSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, max_length=2000)
