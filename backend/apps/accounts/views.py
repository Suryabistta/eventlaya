from datetime import timedelta

from rest_framework import generics, permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from .serializers import RegisterSerializer, UserSerializer
from .models import FCMToken

SHORT_SESSION = timedelta(hours=12)


def login_response(user, remember=True):
    """The sign-in payload {refresh, access, user} shared by password and social login.

    "Remember me" off → the refresh token lasts SHORT_SESSION instead of SIMPLE_JWT's 30 days.
    """
    refresh = RefreshToken.for_user(user)
    if not remember:
        refresh.set_exp(lifetime=SHORT_SESSION)
        # Rotation would otherwise reset exp to 30 days; the refresh view keeps this end time
        refresh['session_end'] = refresh['exp']
    return {'refresh': str(refresh), 'access': str(refresh.access_token), 'user': UserSerializer(user).data}


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    remember = serializers.BooleanField(required=False, default=True)
    SHORT_SESSION = SHORT_SESSION

    def validate(self, attrs):
        remember = attrs.pop('remember', True)
        data = super().validate(attrs)
        if not remember:
            refresh = self.get_token(self.user)
            refresh.set_exp(lifetime=self.SHORT_SESSION)
            # Rotation would otherwise reset exp to 30 days; the refresh view keeps this end time
            refresh['session_end'] = refresh['exp']
            data['refresh'] = str(refresh)
            data['access'] = str(refresh.access_token)
        data['user'] = UserSerializer(self.user).data
        return data


class SessionAwareRefreshSerializer(TokenRefreshSerializer):
    """Token refresh that never extends a short ("don't remember me") session past its original end."""

    def validate(self, attrs):
        from django.contrib.auth import get_user_model
        from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
        from .authentication import issued_before_revocation
        try:
            incoming = RefreshToken(attrs['refresh'])
        except TokenError as e:
            raise InvalidToken(e.args[0])
        user = get_user_model().objects.filter(pk=incoming.get('user_id')).first()
        if user and issued_before_revocation(incoming, user):
            raise InvalidToken('You were signed out. Sign in again.')
        data = super().validate(attrs)
        if 'refresh' in data:
            rotated = RefreshToken(data['refresh'])
            session_end = rotated.get('session_end')
            if session_end:
                rotated.payload['exp'] = session_end
                data['refresh'] = str(rotated)
        return data


class SessionAwareRefreshView(TokenRefreshView):
    serializer_class = SessionAwareRefreshSerializer

class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer

class RegisterView(generics.CreateAPIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = RegisterSerializer

    def perform_create(self, serializer):
        from .verification import send_code
        user = serializer.save()
        send_code(user)  # 6-digit email code; the app asks for it after the first sign-in


class CurrentUserView(APIView):
    """GET the signed-in profile, PATCH to edit it, DELETE to delete the account."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        from .serializers import ProfileUpdateSerializer
        serializer = ProfileUpdateSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(UserSerializer(request.user).data)

    def delete(self, request):
        from .account import check_deletion_confirmation, delete_account, deletion_blocker
        user = request.user
        error = check_deletion_confirmation(user, request.data)
        if error:
            return error
        blocker = deletion_blocker(user)
        if blocker:
            code, message = blocker
            http = status.HTTP_403_FORBIDDEN if code == 'admin_account' else status.HTTP_409_CONFLICT
            return Response({'error': message, 'code': code}, status=http)
        delete_account(user)
        return Response(status=status.HTTP_204_NO_CONTENT)


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
        from .modules import MODULE_REQUIRES, module_enabled
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
            # A module that requires another (e.g. contests → voting) is off when that one is off
            if not is_super and not module_enabled(m.slug, user):
                continue

            result.append({
                'id': m_id,
                'slug': m.slug,
                'name': m.name,
                'description': m.description,
                'icon': m.icon,
                'is_globally_enabled': m.is_globally_enabled,
                'requires': MODULE_REQUIRES.get(m.slug, []),
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



def _branding_for(user):
    from .models import TenantBranding
    from .tenancy import unique_subdomain
    branding = TenantBranding.objects.filter(organizer=user).first()
    if branding is None:
        branding = TenantBranding.objects.create(
            organizer=user,
            subdomain=unique_subdomain(user),
            brand_name=user.organization_name or user.get_full_name() or user.username,
            support_email=user.email,
        )
    return branding


def _branding_payload(branding):
    from apps.platform.models import WhiteLabelRequest
    from .domains import domain_status
    from .serializers import TenantBrandingSerializer
    approved = WhiteLabelRequest.approved_for(branding.organizer) is not None
    data = TenantBrandingSerializer(branding).data
    data['approved'] = approved
    data['status'] = domain_status(branding, approved=approved)
    return data


class TenantBrandingView(APIView):
    """GET / POST the signed-in organizer's white-label branding (+ live domain status)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(_branding_payload(_branding_for(request.user)))

    def post(self, request):
        from .serializers import TenantBrandingSerializer
        branding = _branding_for(request.user)

        # White-label is granted by a platform admin (apps.platform), never self-served:
        # the custom domain and its verification state only change through an approved request,
        # and the watermark can only be hidden when the approved request included that.
        from apps.platform.models import WhiteLabelRequest
        approved = WhiteLabelRequest.approved_for(request.user)
        data = {k: v for k, v in request.data.items() if k not in TenantBrandingSerializer.Meta.read_only_fields
                and k not in ('custom_domain', 'remove_watermark')}
        if 'remove_watermark' in request.data and approved and approved.remove_watermark:
            data['remove_watermark'] = request.data['remove_watermark']

        serializer = TenantBrandingSerializer(branding, data=data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(_branding_payload(serializer.instance))
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class TenantVerifyDomainView(APIView):
    """POST: check the organizer's custom domain now — DNS (CNAME + ownership TXT), then the certificate."""
    permission_classes = [permissions.IsAuthenticated]
    MIN_INTERVAL_SECONDS = 5

    def post(self, request):
        from django.utils import timezone
        from apps.platform.models import WhiteLabelRequest
        from .domains import check_domain
        from .models import TenantBranding
        if not WhiteLabelRequest.approved_for(request.user):
            return Response(
                {'error': 'Custom domains are part of white-label. Request white-label and wait for approval before verifying a domain.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        branding = TenantBranding.objects.filter(organizer=request.user).select_related('organizer').first()
        if not branding or not branding.custom_domain:
            return Response({'error': 'No custom domain is approved for your organization yet.'}, status=status.HTTP_400_BAD_REQUEST)

        recent = branding.dns_checked_at and (timezone.now() - branding.dns_checked_at).total_seconds() < self.MIN_INTERVAL_SECONDS
        if not recent:
            check_domain(branding)
        return Response(verify_response(branding))


def verify_response(branding, approved=True):
    from .domains import domain_status
    from .tenancy import cname_target
    st = domain_status(branding, approved=approved)
    custom = st['custom_domain'] or {}
    if custom.get('live'):
        message = f'Your site is live at https://{branding.custom_domain}'
    elif branding.is_domain_verified:
        message = f'DNS verified. {branding.provider_message or "The HTTPS certificate is on its way."}'
    else:
        message = branding.dns_message or 'Add the DNS records below, then check again.'
    return {
        'message': message,
        'is_domain_verified': branding.is_domain_verified,
        'ssl_active': branding.ssl_active,
        'cname_target': cname_target(),
        'status': st,
    }


class TenantResolveView(APIView):
    """Public: which white-label site is this host? The web app calls it on boot (tenant mode).

    Host: ?host= (explicit), else X-Tenant-Host, else the Host header.
    state: 'platform' (eventlaya.com) | 'live' | 'not_set_up' | 'unavailable' (revoked / switched off).
    """
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request):
        from . import tenancy
        host = tenancy.normalize_host(request.query_params.get('host', '')) or tenancy.request_host(request)
        subdomain = request.query_params.get('subdomain', '').strip().lower()
        if subdomain and not request.query_params.get('host'):
            host = f'{subdomain}.{tenancy.platform_domain()}'

        branding = tenancy.resolve_tenant(host)
        state = 'live' if branding else tenancy.lookup(host)[1]
        if branding is None:
            return Response({
                'is_whitelabel': False,
                'state': state,
                'host': host,
                'brand_name': 'Eventlaya',
                'brand_logo': '',
                'primary_color': '#C2215A',
                'accent_color': '#E39400',
                'remove_watermark': False,
            })

        from .serializers import PublicTenantSerializer
        data = PublicTenantSerializer(branding).data
        data.update({'is_whitelabel': True, 'state': 'live', 'host': host, 'counts': _event_counts(branding.organizer_id)})
        return Response(data)


def _event_counts(organizer_id):
    from apps.events.models import Event
    from apps.events.views import PUBLIC_EVENT_STATUSES
    counts = {'live': 0, 'upcoming': 0, 'past': 0}
    for event in Event.objects.filter(organizer_id=organizer_id, status__in=PUBLIC_EVENT_STATUSES):
        phase = event.phase()
        if phase == 'live':
            counts['live'] += 1
        elif phase == 'upcoming':
            counts['upcoming'] += 1
        elif phase == 'ended':
            counts['past'] += 1
    return counts


class EmailAvailableView(APIView):
    """Sign-up helper: GET ?email= -> {available: bool}. Throttled like other anonymous calls."""
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request):
        from django.contrib.auth import get_user_model
        from django.core.validators import validate_email
        from django.core.exceptions import ValidationError

        email = (request.query_params.get('email') or '').strip()
        try:
            validate_email(email)
        except ValidationError:
            return Response({'available': False, 'error': 'Enter a valid email address.'}, status=status.HTTP_400_BAD_REQUEST)
        taken = get_user_model().objects.filter(email__iexact=email).exists()
        return Response({'available': not taken})
