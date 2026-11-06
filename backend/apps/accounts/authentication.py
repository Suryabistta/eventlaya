from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError


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
