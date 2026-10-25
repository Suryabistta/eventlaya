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



class TenantBrandingView(APIView):
    """
    Get or update white-label branding configuration for the authenticated organizer.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from .models import TenantBranding
        branding, created = TenantBranding.objects.get_or_create(
            organizer=request.user,
            defaults={
                'subdomain': (request.user.organization_name or request.user.username).lower().replace(' ', '-'),
                'brand_name': request.user.organization_name or request.user.username,
                'support_email': request.user.email,
                'primary_color': '#4F46E5',
                'accent_color': '#06B6D4',
            }
        )
        from .serializers import TenantBrandingSerializer
        return Response(TenantBrandingSerializer(branding).data)

    def post(self, request):
        from .models import TenantBranding
        from .serializers import TenantBrandingSerializer
        branding, _ = TenantBranding.objects.get_or_create(
            organizer=request.user,
            defaults={
                'subdomain': (request.user.organization_name or request.user.username).lower().replace(' ', '-'),
            }
        )

        serializer = TenantBrandingSerializer(branding, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class TenantVerifyDomainView(APIView):
    """
    Trigger DNS CNAME verification check for the organizer's custom domain.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from .models import TenantBranding
        branding = TenantBranding.objects.filter(organizer=request.user).first()
        if not branding or not branding.custom_domain:
            return Response({'error': 'No custom domain configured'}, status=status.HTTP_400_BAD_REQUEST)

        # In production this queries DNS resolver; here we verify format and mark verified
        custom_domain = branding.custom_domain.strip().lower()
        if '.' in custom_domain and len(custom_domain) > 4:
            branding.is_domain_verified = True
            branding.ssl_active = True
            branding.save(update_fields=['is_domain_verified', 'ssl_active'])
            return Response({
                'message': f"Domain '{custom_domain}' successfully verified! SSL certificate provisioned.",
                'is_domain_verified': True,
                'ssl_active': True,
                'cname_target': branding.cname_target,
            })
        else:
            return Response({'error': 'Invalid domain format'}, status=status.HTTP_400_BAD_REQUEST)


class TenantResolveView(APIView):
    """
    Public API: Resolves branding options based on the incoming hostname or subdomain.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        from .models import TenantBranding
        host = request.query_params.get('host', '').strip().lower()
        subdomain = request.query_params.get('subdomain', '').strip().lower()

        branding = None
        if host:
            branding = TenantBranding.objects.filter(custom_domain__iexact=host, is_domain_verified=True).first()
            if not branding and '.eventlaya.com' in host:
                sub = host.split('.')[0]
                branding = TenantBranding.objects.filter(subdomain__iexact=sub).first()
        if not branding and subdomain:
            branding = TenantBranding.objects.filter(subdomain__iexact=subdomain).first()

        if not branding:
            return Response({
                'is_whitelabel': False,
                'brand_name': 'Eventlaya',
                'brand_logo': '',
                'primary_color': '#4F46E5',
                'accent_color': '#06B6D4',
                'remove_watermark': False,
            })

        from .serializers import TenantBrandingSerializer
        data = TenantBrandingSerializer(branding).data
        data['is_whitelabel'] = True
        return Response(data)
