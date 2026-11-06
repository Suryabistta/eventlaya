from rest_framework import serializers
from django.contrib.auth import get_user_model

User = get_user_model()

class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    has_password = serializers.SerializerMethodField()
    social_providers = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'phone', 'role', 'organization_name', 'avatar', 'marketplace_access',
                  'business_type', 'city', 'first_name', 'last_name', 'full_name',
                  'email_verified', 'email_verified_at', 'has_password', 'social_providers', 'date_joined',
                  'terms_accepted_at', 'terms_version']
        read_only_fields = ['id', 'marketplace_access', 'email_verified', 'email_verified_at', 'date_joined',
                            'terms_accepted_at', 'terms_version']

    def get_full_name(self, obj):
        return obj.get_full_name()

    def get_has_password(self, obj):
        # False for accounts created through Google/Facebook that never set a password
        return obj.has_usable_password()

    def get_social_providers(self, obj):
        return sorted({s.provider for s in obj.social_accounts.all()})


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """PATCH /api/auth/me/. Email and role are not editable here."""
    # Path of an image uploaded via /api/uploads/ (kind=avatar), e.g. "/media/uploads/avatar/<user id>/x.jpg".
    # Empty string removes the avatar.
    avatar_url = serializers.CharField(write_only=True, required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'phone', 'city', 'organization_name', 'avatar_url']
        extra_kwargs = {
            'first_name': {'required': False, 'allow_blank': True, 'max_length': 150},
            'last_name': {'required': False, 'allow_blank': True, 'max_length': 150},
            'phone': {'required': False, 'allow_blank': True},
            'city': {'required': False, 'allow_blank': True},
            'organization_name': {'required': False, 'allow_blank': True},
        }

    def validate_avatar_url(self, value):
        from django.conf import settings
        if not value:
            return ''
        # Only images this user uploaded themselves (the uploader stores them under uploads/<kind>/<user id>/)
        prefix = f"{settings.MEDIA_URL}uploads/"
        if not value.startswith(prefix) or '..' in value or f"/{self.instance.id}/" not in value:
            raise serializers.ValidationError('Upload the photo with the image uploader.')
        return value[len(settings.MEDIA_URL):]

    def validate(self, attrs):
        for key in ('first_name', 'last_name', 'phone', 'city', 'organization_name'):
            if isinstance(attrs.get(key), str):
                attrs[key] = attrs[key].strip()
        return attrs

    def update(self, instance, validated_data):
        path = validated_data.pop('avatar_url', None)
        instance = super().update(instance, validated_data)
        if path is not None:
            instance.avatar.name = path or None
            instance.save(update_fields=['avatar', 'updated_at'])
        return instance


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    username = serializers.CharField(required=False, allow_blank=True)
    # Self-signup creates an organizer (event company) or a vendor (marketplace business).
    # Staff and superadmin roles are only ever granted by a platform admin.
    # 'attendee' is a normal user who registers for events, votes and writes reviews (the mobile app sign-up).
    account_type = serializers.ChoiceField(
        choices=[('organizer', 'I run events'), ('vendor', 'I list my business on the marketplace'),
                 ('attendee', 'I go to events')],
        default='organizer', write_only=True,
    )
    # The "I agree to the Terms of Service and Privacy Policy" box. Required: sign-ups without it are refused.
    TERMS_ERROR = 'Agree to the Terms of Service and Privacy Policy to create your account.'
    terms = serializers.BooleanField(write_only=True, required=True, error_messages={'required': TERMS_ERROR})

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'password', 'phone', 'organization_name', 'role',
                  'account_type', 'marketplace_access', 'business_type', 'city', 'first_name', 'last_name',
                  'email_verified', 'terms']
        read_only_fields = ['id', 'role', 'marketplace_access', 'email_verified']
        extra_kwargs = {
            'email': {'error_messages': {'unique': 'An account with this email already exists.'}},
            'first_name': {'required': False, 'allow_blank': True, 'max_length': 150},
            'last_name': {'required': False, 'allow_blank': True, 'max_length': 150},
        }

    BUSINESS_TYPES = ('venue', 'sound_stage', 'photo_video', 'decoration', 'catering', 'other')

    def validate_email(self, value):
        value = value.strip()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('An account with this email already exists.')
        return value

    def validate(self, attrs):
        if attrs.get('account_type') == 'vendor':
            errors = {}
            if not (attrs.get('phone') or '').strip():
                errors['phone'] = 'Add a phone number so organizers can reach your business.'
            if attrs.get('business_type') not in self.BUSINESS_TYPES:
                errors['business_type'] = 'Choose what your business offers.'
            if errors:
                raise serializers.ValidationError(errors)
        elif attrs.get('business_type') and attrs['business_type'] not in self.BUSINESS_TYPES:
            raise serializers.ValidationError({'business_type': 'Choose what your business offers.'})
        return attrs

    def validate_terms(self, value):
        if value is not True:
            raise serializers.ValidationError(self.TERMS_ERROR)
        return value

    def validate_username(self, value):
        if value and User.objects.filter(username=value).exists():
            raise serializers.ValidationError('This username is taken.')
        return value

    def create(self, validated_data):
        account_type = validated_data.get('account_type')
        is_vendor = account_type == 'vendor'
        role = {'vendor': User.Role.VENDOR, 'attendee': User.Role.ATTENDEE}.get(account_type, User.Role.ORGANIZER)
        user = User.objects.create_user(
            username=validated_data.get('username') or validated_data['email'],
            email=validated_data['email'],
            password=validated_data['password'],
            phone=validated_data.get('phone', ''),
            organization_name=validated_data.get('organization_name', ''),
            business_type=validated_data.get('business_type', ''),
            city=validated_data.get('city', ''),
            first_name=(validated_data.get('first_name') or '').strip(),
            last_name=(validated_data.get('last_name') or '').strip(),
            role=role,
            marketplace_access=User.MarketplaceAccess.APPROVED if is_vendor else User.MarketplaceAccess.NONE,
        )
        user.accept_terms()
        return user


class PlatformModuleSerializer(serializers.ModelSerializer):
    class Meta:
        from .models import PlatformModule
        model = PlatformModule
        fields = ['id', 'slug', 'name', 'description', 'icon', 'is_globally_enabled', 'order']


class RoleModulePermissionSerializer(serializers.ModelSerializer):
    module_slug = serializers.CharField(source='module.slug', read_only=True)
    module_name = serializers.CharField(source='module.name', read_only=True)
    module_icon = serializers.CharField(source='module.icon', read_only=True)
    is_globally_enabled = serializers.BooleanField(source='module.is_globally_enabled', read_only=True)

    class Meta:
        from .models import RoleModulePermission
        model = RoleModulePermission
        fields = [
            'id', 'role', 'module', 'module_slug', 'module_name', 'module_icon',
            'can_view', 'can_create', 'can_edit', 'can_delete', 'is_enabled',
            'is_globally_enabled'
        ]



class TenantBrandingSerializer(serializers.ModelSerializer):
    organizer_email = serializers.CharField(source='organizer.email', read_only=True)
    organizer_name = serializers.CharField(source='organizer.organization_name', read_only=True)
    cname_target = serializers.SerializerMethodField()

    class Meta:
        from .models import TenantBranding
        model = TenantBranding
        fields = [
            'id', 'organizer', 'organizer_email', 'organizer_name',
            'subdomain', 'custom_domain', 'cname_target', 'is_domain_verified',
            'ssl_active', 'brand_name', 'brand_logo', 'primary_color',
            'accent_color', 'custom_css', 'support_email', 'footer_text',
            'remove_watermark', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'organizer', 'cname_target', 'custom_domain', 'is_domain_verified', 'ssl_active',
                            'created_at', 'updated_at']

    def get_cname_target(self, obj):
        from .tenancy import cname_target
        return cname_target()

    def validate_subdomain(self, value):
        from .tenancy import subdomain_error
        value = (value or '').strip().lower()
        if self.instance is not None and value == (self.instance.subdomain or '').lower():
            return value
        error = subdomain_error(value, self.instance.organizer if self.instance else None)
        if error:
            raise serializers.ValidationError(error)
        return value

    def _color(self, value):
        import re
        if not re.match(r'^#[0-9a-fA-F]{6}$', value or ''):
            raise serializers.ValidationError('Use a 6-digit hex code like #C2215A.')
        return value.upper()

    def validate_primary_color(self, value):
        return self._color(value)

    def validate_accent_color(self, value):
        return self._color(value)

    def validate_custom_css(self, value):
        # Rendered inside a <style> tag on the tenant site: no way out of it.
        if '<' in (value or ''):
            raise serializers.ValidationError('Custom CSS can’t contain “<”.')
        return value


class PublicTenantSerializer(serializers.ModelSerializer):
    """What visitors of a tenant site may see (no emails of the account, no internal status)."""
    organizer_name = serializers.SerializerMethodField()

    class Meta:
        from .models import TenantBranding
        model = TenantBranding
        fields = [
            'subdomain', 'custom_domain', 'brand_name', 'brand_logo', 'primary_color', 'accent_color', 'custom_css',
            'support_email', 'footer_text', 'remove_watermark', 'organizer_name',
        ]

    def get_organizer_name(self, obj):
        u = obj.organizer
        return u.organization_name or u.get_full_name() or u.username
