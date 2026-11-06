"""Sign in with Google or Facebook.

The app gets a token from the provider SDK and posts it here; the server verifies it with the provider and
answers with the same {refresh, access, user} payload as /api/auth/login/.

Linking rules:
- A known (provider, provider user id) signs into the account it is linked to.
- Otherwise the provider-verified email is matched (case-insensitive) to an existing account and linked,
  except platform admin and gate staff accounts, which must keep using their password.
  If that existing account never verified its email, its password is removed: whoever created it may not own
  the address (account pre-hijacking). The owner can set a password again from the app.
- Otherwise a new attendee account is created with an unusable password.
Every social sign-in counts as email verification and attaches tickets registered with that email.
"""
import hashlib
import hmac
import logging
from dataclasses import dataclass

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .linking import mark_email_verified
from .models import SocialAccount

logger = logging.getLogger(__name__)
User = get_user_model()

HTTP_TIMEOUT = 5  # seconds, for every call to a provider
GOOGLE_ISSUERS = ('accounts.google.com', 'https://accounts.google.com')
FACEBOOK_GRAPH = 'https://graph.facebook.com'


class SocialAuthError(Exception):
    def __init__(self, message, code, http=status.HTTP_400_BAD_REQUEST):
        super().__init__(message)
        self.message, self.code, self.http = message, code, http

    def response(self):
        return Response({'error': self.message, 'code': self.code}, status=self.http)


@dataclass
class Identity:
    provider: str
    uid: str
    email: str = ''
    email_verified: bool = False
    first_name: str = ''
    last_name: str = ''


# ---- provider configuration ----------------------------------------------------------------------

def google_configured():
    return bool(settings.GOOGLE_CLIENT_IDS)


def facebook_configured():
    return bool(settings.FACEBOOK_APP_ID and settings.FACEBOOK_APP_SECRET)


NOT_CONFIGURED = SocialAuthError('This sign-in option isn’t available right now.', 'provider_not_configured',
                                 status.HTTP_503_SERVICE_UNAVAILABLE)
UNAVAILABLE = SocialAuthError('We couldn’t reach the sign-in provider. Try again in a moment.', 'provider_unavailable',
                              status.HTTP_503_SERVICE_UNAVAILABLE)


# ---- token verification (mocked in tests) ---------------------------------------------------------

def verify_google_token(token):
    """Verify a Google ID token (signature, expiry, issuer, audience) and return an Identity."""
    from google.auth import exceptions as google_exceptions
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    class TimeoutRequest(google_requests.Request):
        def __call__(self, url, method='GET', body=None, headers=None, timeout=None, **kwargs):
            return super().__call__(url, method=method, body=body, headers=headers,
                                    timeout=timeout or HTTP_TIMEOUT, **kwargs)

    try:
        claims = google_id_token.verify_oauth2_token(token, TimeoutRequest())
    except google_exceptions.TransportError:
        raise UNAVAILABLE
    except (ValueError, google_exceptions.GoogleAuthError):
        raise SocialAuthError('Google sign-in failed. Try again.', 'invalid_token', status.HTTP_401_UNAUTHORIZED)
    if claims.get('iss') not in GOOGLE_ISSUERS or claims.get('aud') not in settings.GOOGLE_CLIENT_IDS:
        raise SocialAuthError('Google sign-in failed. Try again.', 'invalid_token', status.HTTP_401_UNAUTHORIZED)
    return Identity(
        provider=SocialAccount.Provider.GOOGLE,
        uid=str(claims['sub']),
        email=(claims.get('email') or '').strip().lower(),
        email_verified=claims.get('email_verified') in (True, 'true'),
        first_name=claims.get('given_name') or '',
        last_name=claims.get('family_name') or '',
    )


def verify_facebook_token(access_token):
    """Check the user access token was issued to our app (debug_token), then read the profile."""
    app_id, secret = settings.FACEBOOK_APP_ID, settings.FACEBOOK_APP_SECRET
    invalid = SocialAuthError('Facebook sign-in failed. Try again.', 'invalid_token', status.HTTP_401_UNAUTHORIZED)
    try:
        debug = requests.get(
            f'{FACEBOOK_GRAPH}/debug_token',
            params={'input_token': access_token, 'access_token': f'{app_id}|{secret}'},
            timeout=HTTP_TIMEOUT,
        ).json().get('data') or {}
        if not debug.get('is_valid') or str(debug.get('app_id')) != str(app_id) or not debug.get('user_id'):
            raise invalid
        proof = hmac.new(secret.encode(), access_token.encode(), hashlib.sha256).hexdigest()
        me = requests.get(
            f'{FACEBOOK_GRAPH}/me',
            params={'fields': 'id,email,first_name,last_name', 'access_token': access_token, 'appsecret_proof': proof},
            timeout=HTTP_TIMEOUT,
        ).json()
    except (requests.RequestException, ValueError):
        raise UNAVAILABLE
    if str(me.get('id')) != str(debug['user_id']):
        raise invalid
    email = (me.get('email') or '').strip().lower()
    return Identity(
        provider=SocialAccount.Provider.FACEBOOK,
        uid=str(me['id']),
        email=email,
        email_verified=bool(email),  # Facebook only returns confirmed addresses
        first_name=me.get('first_name') or '',
        last_name=me.get('last_name') or '',
    )


# ---- account resolution ---------------------------------------------------------------------------

def _password_only(user):
    """Accounts that must never be reachable through a social sign-in."""
    return user.is_superadmin or user.is_staff or user.is_superuser or user.role == User.Role.STAFF


PASSWORD_ONLY = SocialAuthError(
    'This account must sign in with its email and password.', 'password_login_required', status.HTTP_403_FORBIDDEN,
)


def resolve_user(identity):
    """Return (user, created) for a verified identity, linking or creating the account as needed."""
    from .team import unique_username

    link = SocialAccount.objects.select_related('user').filter(
        provider=identity.provider, provider_uid=identity.uid,
    ).first()
    created = False
    if link:
        user = link.user
    else:
        if not identity.email:
            raise SocialAuthError(
                f'Your {identity.provider.title()} account didn’t share an email address. Allow email access, '
                'or sign up with your email instead.', 'email_required',
            )
        if not identity.email_verified:
            raise SocialAuthError(
                f'Your {identity.provider.title()} email address isn’t verified yet.', 'email_not_verified',
            )
        user = User.objects.filter(email__iexact=identity.email).first()
        if user:
            if _password_only(user):
                raise PASSWORD_ONLY
            if not user.email_verified and user.has_usable_password():
                user.set_unusable_password()
                user.save(update_fields=['password', 'updated_at'])
        else:
            user = User(
                username=unique_username(identity.email), email=identity.email, role=User.Role.ATTENDEE,
                first_name=identity.first_name[:150], last_name=identity.last_name[:150],
            )
            user.set_unusable_password()
            user.save()
            created = True
        link = SocialAccount.objects.create(
            user=user, provider=identity.provider, provider_uid=identity.uid, email=identity.email,
        )

    if _password_only(user):
        raise PASSWORD_ONLY
    if not user.is_active:
        raise SocialAuthError('This account has been deactivated.', 'account_disabled', status.HTTP_403_FORBIDDEN)

    if user.terms_accepted_at is None:
        user.accept_terms()  # the buttons say "By continuing you agree to the Terms and Privacy Policy"

    link.email = identity.email or link.email
    link.last_login_at = timezone.now()
    link.save(update_fields=['email', 'last_login_at', 'updated_at'])
    return user, created


class SocialLoginThrottle(AnonRateThrottle):
    scope = 'social_login'
    rate = '20/min'


class _SocialLoginView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [SocialLoginThrottle]
    token_field = ''

    def configured(self):
        raise NotImplementedError

    def verify(self, token):
        raise NotImplementedError

    def get_token(self, data):
        return data.get(self.token_field)

    def post(self, request):
        from .views import login_response
        try:
            if not self.configured():
                raise NOT_CONFIGURED
            token = str(self.get_token(request.data) or '').strip()
            if not token:
                raise SocialAuthError(f'{self.token_field} is required.', 'token_required')
            identity = self.verify(token)
            try:
                with transaction.atomic():
                    user, created = resolve_user(identity)
            except IntegrityError:  # two first sign-ins racing: the other request created the link
                with transaction.atomic():
                    user, created = resolve_user(identity)
        except SocialAuthError as e:
            return e.response()

        linked = 0
        if identity.email_verified and identity.email and identity.email.lower() == user.email.lower():
            linked = mark_email_verified(user)
            user.refresh_from_db()
        data = login_response(user, remember=request.data.get('remember', True) is not False)
        data.update({'created': created, 'provider': identity.provider, 'linked_tickets': linked})
        return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class GoogleLoginView(_SocialLoginView):
    """POST {id_token, remember?} — the ID token from Google Sign-In (web `credential` is accepted too)."""
    token_field = 'id_token'

    def get_token(self, data):
        return data.get('id_token') or data.get('credential')

    def configured(self):
        return google_configured()

    def verify(self, token):
        return verify_google_token(token)


class FacebookLoginView(_SocialLoginView):
    """POST {access_token, remember?} — the user access token from Facebook Login."""
    token_field = 'access_token'

    def configured(self):
        return facebook_configured()

    def verify(self, token):
        return verify_facebook_token(token)


class SocialConfigView(APIView):
    """Public: which social sign-in buttons the apps should show."""
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request):
        google, facebook = google_configured(), facebook_configured()
        return Response({
            'enabled': [p for p, on in (('google', google), ('facebook', facebook)) if on],
            'terms_version': settings.TERMS_VERSION,
            'google': {'enabled': google, 'client_ids': settings.GOOGLE_CLIENT_IDS if google else []},
            'facebook': {'enabled': facebook, 'app_id': settings.FACEBOOK_APP_ID if facebook else None},
        })
