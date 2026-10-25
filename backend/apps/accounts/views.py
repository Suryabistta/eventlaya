from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .serializers import RegisterSerializer, UserSerializer
from .models import FCMToken

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        data['user'] = UserSerializer(self.user).data
        return data

class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer

class RegisterView(generics.CreateAPIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = RegisterSerializer

class CurrentUserView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class FCMTokenView(APIView):
    """Register or update FCM push notification token for the current user."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        token = request.data.get('token')
        platform = request.data.get('platform', 'android')
        if not token:
            return Response({'error': 'token is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        FCMToken.objects.update_or_create(
            token=token,
            defaults={'user': request.user, 'platform': platform}
        )
        return Response({'message': 'FCM token registered'})

    def delete(self, request):
        token = request.data.get('token')
        if token:
            FCMToken.objects.filter(user=request.user, token=token).delete()
        return Response({'message': 'FCM token removed'})


class UserModulesView(APIView):
    """
    Returns accessible modules and permissions for the authenticated user.
    Used by Web and Mobile apps to dynamically render UI based on RBAC.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from .models import PlatformModule, RoleModulePermission
        user = request.user
        is_super = getattr(user, 'is_superadmin', False)

        modules = PlatformModule.objects.all()
        # Non-superadmins only see globally enabled modules
        if not is_super:
            modules = modules.filter(is_globally_enabled=True)

        perms_map = {}
        if not is_super:
            perms = RoleModulePermission.objects.filter(role=user.role, module__in=modules)
            for p in perms:
                perms_map[str(p.module_id)] = {
                    'view': p.can_view,
                    'create': p.can_create,
                    'edit': p.can_edit,
                    'delete': p.can_delete,
                    'is_enabled': p.is_enabled,
                }

        result = []
        for m in modules:
            m_id = str(m.id)
            if is_super:
                perm = {'view': True, 'create': True, 'edit': True, 'delete': True, 'is_enabled': True}
            else:
                perm = perms_map.get(m_id, {
                    'view': True if user.role == 'organizer' else False,
                    'create': False,
                    'edit': False,
                    'delete': False,
                    'is_enabled': True,
                })

            # If role permission explicitly disabled this module for this role, skip or flag
            if not is_super and not perm.get('is_enabled', True):
                continue

            result.append({
                'id': m_id,
                'slug': m.slug,
                'name': m.name,
                'description': m.description,
                'icon': m.icon,
                'is_globally_enabled': m.is_globally_enabled,
                'permissions': perm,
            })

        return Response({
            'role': user.role,
            'is_superadmin': is_super,
            'modules': result,
        })


class SuperadminRBACManageView(APIView):
    """
    Superadmin API to view and update module permissions across all roles.
    """
    permission_classes = [permissions.IsAuthenticated]

    def _check_superadmin(self, user):
        if not getattr(user, 'is_superadmin', False):
            return False
        return True

    def get(self, request):
        if not self._check_superadmin(request.user):
            return Response({'error': 'Superadmin privileges required.'}, status=status.HTTP_403_FORBIDDEN)

        from .models import PlatformModule, RoleModulePermission, User
        modules = PlatformModule.objects.all()
        roles = [r[0] for r in User.Role.choices]

        data = []
        for m in modules:
            role_perms = []
            for role in roles:
                perm, _ = RoleModulePermission.objects.get_or_create(
                    role=role,
                    module=m,
                    defaults={
                        'can_view': True if role in ['superadmin', 'organizer'] else (role == 'staff' and m.slug in ['gate_scanner', 'events']),
                        'can_create': role in ['superadmin', 'organizer'],
                        'can_edit': role in ['superadmin', 'organizer'],
                        'can_delete': role == 'superadmin',
                        'is_enabled': True,
                    }
                )
                role_perms.append({
                    'role': role,
                    'can_view': perm.can_view,
                    'can_create': perm.can_create,
                    'can_edit': perm.can_edit,
                    'can_delete': perm.can_delete,
                    'is_enabled': perm.is_enabled,
                })

            data.append({
                'id': str(m.id),
                'slug': m.slug,
                'name': m.name,
                'description': m.description,
                'icon': m.icon,
                'is_globally_enabled': m.is_globally_enabled,
                'order': m.order,
                'role_permissions': role_perms,
            })

        return Response({
            'roles': roles,
            'modules': data,
        })

    def post(self, request):
        if not self._check_superadmin(request.user):
            return Response({'error': 'Superadmin privileges required.'}, status=status.HTTP_403_FORBIDDEN)

        from .models import PlatformModule, RoleModulePermission
        module_id = request.data.get('module_id')
        is_globally_enabled = request.data.get('is_globally_enabled')
        role_permissions = request.data.get('role_permissions', [])

        if not module_id:
            return Response({'error': 'module_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            module = PlatformModule.objects.get(id=module_id)
        except PlatformModule.DoesNotExist:
            return Response({'error': 'Module not found'}, status=status.HTTP_404_NOT_FOUND)

        if is_globally_enabled is not None:
            module.is_globally_enabled = bool(is_globally_enabled)
            module.save(update_fields=['is_globally_enabled'])

        for rp in role_permissions:
            role = rp.get('role')
            if role:
                RoleModulePermission.objects.update_or_create(
                    module=module,
                    role=role,
                    defaults={
                        'can_view': rp.get('can_view', True),
                        'can_create': rp.get('can_create', False),
                        'can_edit': rp.get('can_edit', False),
                        'can_delete': rp.get('can_delete', False),
                        'is_enabled': rp.get('is_enabled', True),
                    }
                )

        return Response({'message': f'RBAC permissions updated for {module.name}'})


class SuperadminToggleModuleView(APIView):
    """Instant killswitch/toggle for a module globally."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not getattr(request.user, 'is_superadmin', False):
            return Response({'error': 'Superadmin privileges required.'}, status=status.HTTP_403_FORBIDDEN)

        from .models import PlatformModule
        slug = request.data.get('slug')
        is_enabled = request.data.get('is_enabled')

        if not slug or is_enabled is None:
            return Response({'error': 'slug and is_enabled are required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            module = PlatformModule.objects.get(slug=slug)
            module.is_globally_enabled = bool(is_enabled)
            module.save(update_fields=['is_globally_enabled'])
            return Response({
                'message': f"Module '{module.name}' is now {'ENABLED' if module.is_globally_enabled else 'DISABLED'}",
                'slug': module.slug,
                'is_globally_enabled': module.is_globally_enabled,
            })
        except PlatformModule.DoesNotExist:
            return Response({'error': f"Module with slug '{slug}' not found"}, status=status.HTTP_404_NOT_FOUND)

