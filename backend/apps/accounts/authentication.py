from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication as BaseJWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError


def issued_before_revocation(token, user):
    """True when [token] was issued before the user's sessions were revoked (admin password reset)."""
    cutoff = getattr(user, 'sessions_valid_after', None)
    iat = token.get('iat')
    # iat is whole seconds: a sign-in in the same second as the reset must still work
    return bool(cutoff and (iat is None or iat < int(cutoff.timestamp())))


class JWTAuthentication(BaseJWTAuthentication):
    """simplejwt auth that also rejects tokens issued before User.sessions_valid_after."""

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if issued_before_revocation(validated_token, user):
            raise AuthenticationFailed('You were signed out. Sign in again.', code='session_revoked')
        return user


class OptionalJWTAuthentication(JWTAuthentication):
    """JWT auth for public endpoints: a valid token identifies the user, a bad/expired one is ignored.

    Public pages (event registration, voting) must keep working for a visitor whose stored token expired,
    so they are treated as anonymous instead of getting a 401.
    """

    def authenticate(self, request):
        try:
            return super().authenticate(request)
        except (InvalidToken, TokenError, AuthenticationFailed):
            return None
