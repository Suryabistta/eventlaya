"""Voter verification by one-time code (SMS or email).

6-digit code, valid 5 minutes, 5 wrong tries per code, 60 s resend cooldown and 5 codes per hour per destination,
30 per hour per IP. Only keyed hashes of the destination and code are stored. A verified voter gets a signed
`voter_token` (12 h) that the vote endpoint accepts instead of re-entering a code for every vote.
"""
import logging
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from .models import Poll, VoteOTP, hash_voter, keyed_hash
from .sms import SMSError, normalize_nepal_mobile, send_sms

logger = logging.getLogger(__name__)

CODE_TTL = timedelta(minutes=5)
MAX_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=60)
HOURLY_PER_DESTINATION = 5
HOURLY_PER_IP = 30
TOKEN_MAX_AGE = 12 * 3600
TOKEN_SALT = 'eventlaya.voting.voter-token'


class OTPError(Exception):
    def __init__(self, message, code=400, retry_after=None):
        super().__init__(message)
        self.message, self.code, self.retry_after = message, code, retry_after


def channel_for(poll):
    return {Poll.VoteMode.SMS_OTP: VoteOTP.Channel.SMS, Poll.VoteMode.EMAIL_OTP: VoteOTP.Channel.EMAIL}.get(poll.vote_mode)


def normalize_destination(channel, value):
    value = (value or '').strip()
    if channel == VoteOTP.Channel.SMS:
        try:
            return normalize_nepal_mobile(value)
        except ValueError as e:
            raise OTPError(str(e))
    value = value.lower()
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', value):
        raise OTPError('That email address doesn’t look right. Check it and try again.')
    return value


def voter_raw_key(destination):
    """Same key as the contact vote mode, so a phone/email is one voter however it was verified."""
    return f'contact:{destination}'


def _code_hash(otp_poll_id, destination, code):
    return keyed_hash(f'otp:{otp_poll_id}:{destination}:{code}')


def send_code(poll, destination_raw, ip_hash=''):
    """Send a fresh code. Returns {'expires_in', 'resend_in', 'destination'} or raises OTPError."""
    channel = channel_for(poll)
    if not channel:
        raise OTPError('This contest doesn’t use verification codes.')
    destination = normalize_destination(channel, destination_raw)
    dest_hash = keyed_hash(f'{channel}:{destination}')
    now = timezone.now()
    recent = VoteOTP.objects.filter(poll=poll, destination_hash=dest_hash, created_at__gte=now - timedelta(hours=1))
    last = recent.order_by('-created_at').first()
    if last and now - last.created_at < RESEND_COOLDOWN:
        wait = int((last.created_at + RESEND_COOLDOWN - now).total_seconds() + 0.999)
        raise OTPError(f'We just sent a code. You can ask for a new one in {wait} seconds.', 429, wait)
    if recent.count() >= HOURLY_PER_DESTINATION:
        raise OTPError('Too many codes for this number or email. Try again in an hour.', 429, 3600)
    if ip_hash and VoteOTP.objects.filter(ip_hash=ip_hash, created_at__gte=now - timedelta(hours=1)).count() >= HOURLY_PER_IP:
        raise OTPError('Too many codes requested from this network. Try again later.', 429, 3600)

    code = f'{secrets.randbelow(1_000_000):06d}'
    with transaction.atomic():
        # Older open codes for this destination stop working
        VoteOTP.objects.filter(poll=poll, destination_hash=dest_hash, verified_at__isnull=True, expires_at__gt=now).update(expires_at=now)
        row = VoteOTP.objects.create(
            poll=poll, channel=channel, destination_hash=dest_hash, code_hash=_code_hash(poll.id, destination, code),
            expires_at=now + CODE_TTL, ip_hash=ip_hash, created_at=now,
        )
    # Plain ASCII on purpose: one curly quote makes the SMS Unicode (70 chars/credit instead of 160)
    title = poll.title[:60].encode('ascii', 'ignore').decode().strip() or 'the contest'
    text = f"{code} is your code to vote in {title}. It expires in 5 minutes. Do not share it."
    if channel == VoteOTP.Channel.EMAIL:
        text = f'{code} is your code to vote in {poll.title}. It expires in 5 minutes. Don’t share it.'
    try:
        if channel == VoteOTP.Channel.SMS:
            send_sms(destination, text)
        else:
            send_mail(subject=f'{code} is your voting code', message=f'Namaste,\n\n{text}\n\nEventlaya',
                      from_email=settings.DEFAULT_FROM_EMAIL, recipient_list=[destination])
    except (SMSError, Exception) as e:
        row.delete()
        logger.exception('Voting OTP delivery failed (%s)', channel)
        raise OTPError('We couldn’t send the code right now. Try again in a minute.', 503) from e
    return {'expires_in': int(CODE_TTL.total_seconds()), 'resend_in': int(RESEND_COOLDOWN.total_seconds()),
            'channel': channel, 'destination': mask(channel, destination)}


def mask(channel, destination):
    if channel == VoteOTP.Channel.SMS:
        return f'{destination[:3]}*****{destination[-2:]}'
    name, _, domain = destination.partition('@')
    return f'{name[:2]}***@{domain}'


def verify_code(poll, destination_raw, code):
    """Check a code. Returns {'voter_token', 'expires_in'} or raises OTPError."""
    channel = channel_for(poll)
    if not channel:
        raise OTPError('This contest doesn’t use verification codes.')
    destination = normalize_destination(channel, destination_raw)
    code = re.sub(r'\D', '', str(code or ''))
    if len(code) != 6:
        raise OTPError('Enter the 6-digit code we sent you.')
    dest_hash = keyed_hash(f'{channel}:{destination}')
    now = timezone.now()
    failure = None
    with transaction.atomic():
        row = (VoteOTP.objects.select_for_update()
               .filter(poll=poll, destination_hash=dest_hash, verified_at__isnull=True).order_by('-created_at').first())
        if not row or row.expires_at <= now:
            raise OTPError('That code has expired. Ask for a new one.', 410)
        if row.attempts >= MAX_ATTEMPTS:
            raise OTPError('Too many wrong tries. Ask for a new code.', 429)
        if not secrets.compare_digest(row.code_hash, _code_hash(poll.id, destination, code)):
            # Count the wrong try (committed: raising inside the atomic block would roll it back)
            row.attempts += 1
            row.save(update_fields=['attempts'])
            left = MAX_ATTEMPTS - row.attempts
            failure = OTPError(f'That code isn’t right. {left} {"try" if left == 1 else "tries"} left.', 400) if left else \
                OTPError('Too many wrong tries. Ask for a new code.', 429)
        else:
            row.verified_at = now
            row.save(update_fields=['verified_at'])
    if failure:
        raise failure
    return {'voter_token': make_voter_token(poll, voter_raw_key(destination), poll.vote_mode),
            'expires_in': TOKEN_MAX_AGE, 'destination': mask(channel, destination)}


def make_voter_token(poll, raw_key, method):
    return signing.dumps({'p': str(poll.id), 'h': hash_voter(raw_key), 'm': method}, salt=TOKEN_SALT, compress=True)


def read_voter_token(poll, token):
    """(voter_hash, method) from a voter_token issued for this poll, or None."""
    if not token:
        return None
    try:
        data = signing.loads(str(token), salt=TOKEN_SALT, max_age=TOKEN_MAX_AGE)
    except signing.BadSignature:
        return None
    if data.get('p') != str(poll.id):
        return None
    return data.get('h'), data.get('m')
