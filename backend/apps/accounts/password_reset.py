"""Forgot-password flow: email a one-time link, then set a new password with it."""
import logging

from django.conf import settings
from django.contrib.auth import get_user_model, password_validation
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

logger = logging.getLogger(__name__)
User = get_user_model()

GENERIC_OK = 'If an account exists for that email, we’ve sent a link to reset the password. It expires in 3 days.'


class PasswordResetThrottle(AnonRateThrottle):
    """Sending reset emails: strict, to stop email bombing."""

    scope = 'password_reset'
    rate = '5/hour'


class PasswordResetConfirmThrottle(AnonRateThrottle):
    """Opening/using a link: separate and looser, so asking for a few links never blocks using one."""

    scope = 'password_reset_confirm'
    rate = '30/hour'


def reset_link(user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?uid={uid}&token={token}"


INTRO = {
    'reset': (
        'Reset your Eventlaya password',
        'Someone asked to reset the password for your Eventlaya account. Open this link to choose a new one:',
        'If you didn’t ask for this, you can ignore this email; your password stays the same.',
    ),
    'admin_reset': (
        'Set a new Eventlaya password',
        'An Eventlaya administrator reset the password for your account, so you have been signed out. '
        'Open this link to choose a new one:',
        'If you didn’t expect this, reply to this email.',
    ),
    'welcome': (
        'Your Eventlaya account is ready',
        'An Eventlaya administrator created an account for your organization. Open this link to set your password and sign in:',
        'Questions? Reply to this email.',
    ),
}


def send_password_email(user, kind='reset'):
    """Email a one-time set-password link. Returns True when the email was handed to the mail server."""
    subject, intro, outro = INTRO[kind]
    name = user.organization_name or user.username or 'there'
    try:
        send_mail(
            subject=subject,
            message=(
                f'Namaste {name},\n\n{intro}\n\n{reset_link(user)}\n\n'
                f'The link works once and expires in 3 days. {outro}\n\nEventlaya'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
        )
        return True
    except Exception:
        logger.exception('Password email (%s) failed for user %s', kind, user.pk)
        return False


class PasswordResetRequestView(APIView):
    """POST {email}. Always answers the same way so it can't be used to find accounts."""

    permission_classes = [permissions.AllowAny]
    throttle_classes = [PasswordResetThrottle]

    def post(self, request):
        email = (request.data.get('email') or '').strip()
        if not email:
            return Response({'error': 'Enter the email you sign in with.'}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user and user.has_usable_password():
            send_password_email(user)  # never reveal delivery problems to the requester
        return Response({'message': GENERIC_OK})


class PasswordResetConfirmView(APIView):
    """POST {uid, token, new_password}. GET ?uid=&token= checks a link before showing the form."""

    permission_classes = [permissions.AllowAny]
    throttle_classes = [PasswordResetConfirmThrottle]

    @staticmethod
    def _user_for(uid, token):
        try:
            user = User.objects.get(pk=force_str(urlsafe_base64_decode(uid or '')), is_active=True)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError, ValidationError):
            return None
        return user if default_token_generator.check_token(user, token or '') else None

    def get(self, request):
        user = self._user_for(request.query_params.get('uid'), request.query_params.get('token'))
        if not user:
            return Response({'valid': False, 'error': 'This reset link is invalid or has expired.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'valid': True, 'email': user.email})

    def post(self, request):
        user = self._user_for(request.data.get('uid'), request.data.get('token'))
        if not user:
            return Response({'error': 'This reset link is invalid or has expired. Ask for a new one.'}, status=status.HTTP_400_BAD_REQUEST)

        new_password = request.data.get('new_password') or ''
        try:
            password_validation.validate_password(new_password, user)
        except ValidationError as e:
            return Response({'error': ' '.join(e.messages), 'new_password': e.messages}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)  # also invalidates the link: tokens are tied to the password hash
        user.must_change_password = False
        user.save(update_fields=['password', 'must_change_password'])
        return Response({'message': 'Password changed. Sign in with your new password.'})
