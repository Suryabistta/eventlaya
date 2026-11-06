"""Email verification with a 6-digit code (needed before guest tickets are attached to an account)."""
import hashlib
import hmac
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .linking import mark_email_verified
from .models import EmailVerificationCode

logger = logging.getLogger(__name__)

CODE_TTL = timedelta(minutes=15)
MAX_ATTEMPTS = 5  # wrong guesses per code before a new one is needed
RESEND_GAP = timedelta(minutes=1)
HOURLY_LIMIT = 5


def _hash(user, code):
    # Keyed hash: the attempt limit, not hash cost, is what protects a 6-digit code.
    return hmac.new(settings.SECRET_KEY.encode(), f'{user.pk}:{code}'.encode(), hashlib.sha256).hexdigest()


def _wait_seconds(user, now):
    """Seconds until another code may be sent (0 when allowed): 1 per minute, 5 per hour."""
    recent = list(
        EmailVerificationCode.objects.filter(user=user, created_at__gte=now - timedelta(hours=1))
        .order_by('-created_at').values_list('created_at', flat=True)
    )
    waits = [0]
    if recent and now - recent[0] < RESEND_GAP:
        waits.append((recent[0] + RESEND_GAP - now).total_seconds())
    if len(recent) >= HOURLY_LIMIT:
        waits.append((recent[HOURLY_LIMIT - 1] + timedelta(hours=1) - now).total_seconds())
    return int(max(waits) + 0.999)


def send_code(user):
    """Create and email a fresh code (older open codes stop working). Returns the code row."""
    code = f'{secrets.randbelow(1_000_000):06d}'
    now = timezone.now()
    with transaction.atomic():
        EmailVerificationCode.objects.filter(user=user, used_at__isnull=True).update(used_at=now)
        row = EmailVerificationCode.objects.create(
            user=user, email=user.email, code_hash=_hash(user, code), expires_at=now + CODE_TTL,
        )
    name = user.first_name or user.organization_name or 'there'
    try:
        send_mail(
            subject=f'{code} is your Eventlaya verification code',
            message=(
                f'Namaste {name},\n\n'
                f'Your Eventlaya verification code is:\n\n    {code}\n\n'
                'Enter it in the app to confirm this email address. It expires in 15 minutes.\n'
                'If you didn’t create an Eventlaya account, you can ignore this email.\n\n'
                'Eventlaya'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
        )
    except Exception:
        logger.exception('Verification email failed for user %s', user.pk)
    return row


class SendVerificationCodeView(APIView):
    """POST → email a new code to the signed-in user's address. 1 per minute, 5 per hour."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        if user.email_verified:
            return Response({'error': 'Your email is already verified.', 'code': 'already_verified'},
                            status=status.HTTP_400_BAD_REQUEST)
        wait = _wait_seconds(user, timezone.now())
        if wait:
            return Response(
                {'error': f'Please wait {wait} seconds before asking for another code.', 'code': 'rate_limited',
                 'retry_after': wait},
                status=status.HTTP_429_TOO_MANY_REQUESTS, headers={'Retry-After': str(wait)},
            )
        send_code(user)
        return Response({
            'message': f'We sent a 6-digit code to {user.email}.',
            'email': user.email,
            'expires_in': int(CODE_TTL.total_seconds()),
            'resend_available_in': _wait_seconds(user, timezone.now()),
        })


class VerifyEmailView(APIView):
    """POST {code} → marks the email verified and attaches tickets registered with it."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from .serializers import UserSerializer
        user = request.user
        if user.email_verified:
            return Response({'message': 'Your email is already verified.', 'linked_tickets': 0,
                             'user': UserSerializer(user).data})
        code = str(request.data.get('code') or '').strip().replace(' ', '')
        if not code.isdigit() or len(code) != 6:
            return Response({'error': 'Enter the 6-digit code from the email.', 'code': 'invalid_code'},
                            status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        with transaction.atomic():
            row = (EmailVerificationCode.objects.select_for_update()
                   .filter(user=user, used_at__isnull=True).order_by('-created_at').first())
            if row is None or row.expires_at <= now or row.email.lower() != user.email.lower():
                return Response({'error': 'This code has expired. Ask for a new one.', 'code': 'code_expired'},
                                status=status.HTTP_400_BAD_REQUEST)
            if row.attempts >= MAX_ATTEMPTS:
                return Response({'error': 'Too many wrong tries. Ask for a new code.', 'code': 'too_many_attempts'},
                                status=status.HTTP_429_TOO_MANY_REQUESTS)
            if not hmac.compare_digest(_hash(user, code), row.code_hash):
                row.attempts += 1
                row.save(update_fields=['attempts', 'updated_at'])
                left = MAX_ATTEMPTS - row.attempts
                return Response(
                    {'error': 'That code isn’t right.' + (f' {left} tries left.' if left else ' Ask for a new code.'),
                     'code': 'invalid_code', 'attempts_left': left},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            row.used_at = now
            row.save(update_fields=['used_at', 'updated_at'])
            linked = mark_email_verified(user)
        return Response({
            'message': 'Email verified.' + (f' {linked} ticket(s) added to your account.' if linked else ''),
            'linked_tickets': linked,
            'user': UserSerializer(user).data,
        })
