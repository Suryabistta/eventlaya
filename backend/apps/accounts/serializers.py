from rest_framework import serializers
from django.contrib.auth import get_user_model

User = get_user_model()

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'phone', 'role', 'organization_name', 'avatar']
        read_only_fields = ['id']


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'password', 'phone', 'organization_name', 'role']

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data.get('username') or validated_data['email'],
            email=validated_data['email'],
            password=validated_data['password'],
            phone=validated_data.get('phone', ''),
            organization_name=validated_data.get('organization_name', ''),
            role=validated_data.get('role', User.Role.ORGANIZER),
        )
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

