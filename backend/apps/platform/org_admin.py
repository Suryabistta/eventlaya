"""Platform admin actions on an organization account: create it, reset its password, verify it.

Every action is recorded as an AdminAction (shown on the organization page and in the activity feed).
"""
from django.contrib.auth import get_user_model
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.password_reset import reset_link, send_password_email
from apps.accounts.team import temporary_password, unique_username
from .models import AdminAction
from .views import ORG_ROLES, IsSuperadmin

User = get_user_model()


def log(request, target, kind, note=''):
    AdminAction.objects.create(actor=request.user, target=target, kind=kind, note=note[:255])


def actions_for(user, limit=10):
    return [
        {
            'kind': a.kind,
            'label': a.get_kind_display(),
            'actor': a.actor.email if a.actor else None,
            'note': a.note,
            'at': a.created_at,
        }
        for a in AdminAction.objects.filter(target=user).select_related('actor')[:limit]
    ]


def _org_or_error(pk):
    user = get_object_or_404(User, pk=pk)
    if user.role not in ORG_ROLES or user.is_superadmin:
        return None, Response({'error': 'Only organizer and vendor accounts can be changed here.'}, status=status.HTTP_400_BAD_REQUEST)
    return user, None


def create_organization(request):
    """POST /platform/organizations/ {organization_name, email, role?, phone?, city?, business_type?, is_verified?}."""
    d = request.data
    name = (d.get('organization_name') or '').strip()
    email = (d.get('email') or '').strip().lower()
    role = d.get('role') or User.Role.ORGANIZER
    errors = {}
    if not name:
        errors['organization_name'] = ['Enter the organization name.']
    try:
        validate_email(email)
    except ValidationError:
        errors['email'] = ['Enter a valid email address.']
    else:
        if User.objects.filter(email__iexact=email).exists():
            errors['email'] = ['An account with this email already exists.']
    if role not in ORG_ROLES:
        errors['role'] = ['Choose organizer or vendor.']
    if errors:
        return Response({'error': next(iter(errors.values()))[0], **errors}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        user = User(
            username=unique_username(email),
            email=email,
            role=role,
            organization_name=name[:255],
            phone=(d.get('phone') or '').strip()[:20],
            city=(d.get('city') or '').strip()[:100],
            business_type=(d.get('business_type') or '').strip()[:30],
            is_verified=bool(d.get('is_verified')),
            # A vendor is a marketplace business by definition
            marketplace_access=User.MarketplaceAccess.APPROVED if role == User.Role.VENDOR else User.MarketplaceAccess.NONE,
        )
        user.set_unusable_password()  # they choose one from the welcome email
        user.save()
        log(request, user, AdminAction.Kind.CREATED, f'{user.get_role_display()}{", verified" if user.is_verified else ""}')
        if user.is_verified:
            log(request, user, AdminAction.Kind.VERIFIED)

    sent = send_password_email(user, 'welcome')
    data = {'id': str(user.id), 'email': user.email, 'name': name, 'email_sent': sent}
    if not sent:
        # Mail is down: let the admin pass the link on another way (WhatsApp, phone)
        data['set_password_link'] = reset_link(user)
    return Response(data, status=status.HTTP_201_CREATED)


class OrganizationResetPasswordView(APIView):
    """POST {mode: 'email' | 'temporary'}. Either way the organization is signed out everywhere.

    email: they get a link to choose a new password. temporary: a password shown to the admin once,
    which the organization must change at their next sign-in.
    """
    permission_classes = [IsSuperadmin]

    def post(self, request, pk):
        user, err = _org_or_error(pk)
        if err:
            return err
        mode = request.data.get('mode', 'email')
        if mode == 'temporary':
            temp = temporary_password()
            user.set_password(temp)
            user.must_change_password = True
            user.revoke_sessions(save=False)
            user.save(update_fields=['password', 'must_change_password', 'sessions_valid_after', 'updated_at'])
            log(request, user, AdminAction.Kind.PASSWORD_TEMPORARY)
            return Response({'temporary_password': temp, 'message': 'Temporary password set. They must change it when they sign in.'})
        if mode != 'email':
            return Response({'error': 'mode must be "email" or "temporary".'}, status=status.HTTP_400_BAD_REQUEST)
        user.revoke_sessions()
        sent = send_password_email(user, 'admin_reset')
        log(request, user, AdminAction.Kind.PASSWORD_EMAIL, '' if sent else 'Email failed to send')
        data = {'email_sent': sent, 'message': f'Reset link sent to {user.email}.' if sent else 'The email couldn’t be sent. Share this link with them directly.'}
        if not sent:
            data['set_password_link'] = reset_link(user)
        return Response(data)


class OrganizationVerifyView(APIView):
    """POST {is_verified: bool}: the blue tick on the organization's name."""
    permission_classes = [IsSuperadmin]

    def post(self, request, pk):
        user, err = _org_or_error(pk)
        if err:
            return err
        verified = bool(request.data.get('is_verified'))
        if user.is_verified != verified:
            user.is_verified = verified
            user.save(update_fields=['is_verified', 'updated_at'])
            log(request, user, AdminAction.Kind.VERIFIED if verified else AdminAction.Kind.UNVERIFIED)
        return Response({'id': str(user.id), 'is_verified': user.is_verified})
