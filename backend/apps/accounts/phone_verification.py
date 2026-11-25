"""Mobile number check at sign-up: POST /api/auth/phone/send-code/ texts a 6-digit code, and
POST /api/auth/register/ must carry it as `phone_code` (RegisterSerializer calls check_code / use_code)."""
import hashlib
import hmac
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from apps.voting.sms import SMSError, normalize_nepal_mobile, send_sms

from .models import PhoneVerificationCode

logger = logging.getLogger(__name__)

CODE_TTL = timedelta(minutes=10)
MAX_ATTEMPTS = 5
RESEND_GAP = timedelta(minutes=1)
HOURLY_LIMIT = 5


class CodeError(Exception):
    def __init__(self, message, code):
        super().__init__(message)
        self.message, self.code = message, code


def _hash(phone, code):
    return hmac.new(settings.SECRET_KEY.encode(), f'phone:{phone}:{code}'.encode(), hashlib.sha256).hexdigest()


def wait_seconds(phone, now):
    """Seconds until another code may be sent to this number: 1 per minute, 5 per hour."""
    recent = list(PhoneVerificationCode.objects.filter(phone=phone, created_at__gte=now - timedelta(hours=1))
                  .order_by('-created_at').values_list('created_at', flat=True))
    waits = [0]
    if recent and now - recent[0] < RESEND_GAP:
        waits.append((recent[0] + RESEND_GAP - now).total_seconds())
    if len(recent) >= HOURLY_LIMIT:
        waits.append((recent[HOURLY_LIMIT - 1] + timedelta(hours=1) - now).total_seconds())
    return int(max(waits) + 0.999)


def send_code(phone):
    """Text a fresh code to the normalized [phone]; older open codes stop working. Raises SMSError."""
    code = f'{secrets.randbelow(1_000_000):06d}'
    now = timezone.now()
    with transaction.atomic():
        PhoneVerificationCode.objects.filter(phone=phone, used_at__isnull=True).update(used_at=now)
        PhoneVerificationCode.objects.create(phone=phone, code_hash=_hash(phone, code), expires_at=now + CODE_TTL)
    send_sms(phone, f'{code} is your Eventlaya verification code. It expires in 10 minutes.')


def _open_row(phone, now):
    row = (PhoneVerificationCode.objects.select_for_update()
           .filter(phone=phone, used_at__isnull=True).order_by('-created_at').first())
    if row is None or row.expires_at <= now:
        raise CodeError('This code has expired. Ask for a new one.', 'code_expired')
    if row.attempts >= MAX_ATTEMPTS:
        raise CodeError('Too many wrong tries. Ask for a new code.', 'too_many_attempts')
    return row


def check_code(phone, code):
    """Raises CodeError unless [code] is the open code for [phone]. Wrong guesses count toward the limit."""
    code = str(code or '').strip().replace(' ', '')
    if not code.isdigit() or len(code) != 6:
        raise CodeError('Enter the 6-digit code we sent by SMS.', 'invalid_code')
    # The wrong-guess count must be saved, so the error is raised after the transaction commits.
    with transaction.atomic():
        row = _open_row(phone, timezone.now())
        wrong = not hmac.compare_digest(_hash(phone, code), row.code_hash)
        if wrong:
            row.attempts += 1
            row.save(update_fields=['attempts', 'updated_at'])
    if wrong:
        left = MAX_ATTEMPTS - row.attempts
        raise CodeError('That code isn’t right.' + (f' {left} tries left.' if left else ' Ask for a new code.'),
                        'invalid_code')


def use_code(phone):
    """Marks the open code for [phone] used (after the account is created)."""
    PhoneVerificationCode.objects.filter(phone=phone, used_at__isnull=True).update(used_at=timezone.now())


class PhoneCodeThrottle(AnonRateThrottle):
    scope = 'phone_code'
    rate = '10/hour'  # per IP, on top of the per-number limits


class SendPhoneCodeView(APIView):
    """POST {phone} → texts a 6-digit sign-up code. 1 per minute and 5 per hour per number, 10 per hour per IP."""
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [PhoneCodeThrottle]

    def post(self, request):
        try:
            phone = normalize_nepal_mobile(request.data.get('phone'))
        except ValueError as e:
            return Response({'error': str(e), 'code': 'invalid_phone'}, status=status.HTTP_400_BAD_REQUEST)
        wait = wait_seconds(phone, timezone.now())
        if wait:
            return Response(
                {'error': f'Please wait {wait} seconds before asking for another code.', 'code': 'rate_limited',
                 'retry_after': wait},
                status=status.HTTP_429_TOO_MANY_REQUESTS, headers={'Retry-After': str(wait)},
            )
        try:
            send_code(phone)
        except SMSError:
            logger.exception('Sign-up SMS failed for %s', phone[-4:])
            return Response({'error': 'We couldn’t send the SMS right now. Please try again in a few minutes.',
                             'code': 'sms_failed'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({
            'message': f'We sent a 6-digit code to {phone}.',
            'phone': phone,
            'expires_in': int(CODE_TTL.total_seconds()),
            'resend_available_in': wait_seconds(phone, timezone.now()),
        })
