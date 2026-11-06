"""Voting sub-modules, checked per view (everything lives under /api/voting/, which the middleware maps to `voting`).

    voting      master switch (middleware, PATH_MODULES)
    contests    requires voting            — contests, contestants, rounds, categories, public contest pages, presenter
    judging     requires contests          — judges' scoring and judge management; judges' scores in results
    paid_votes  requires contests+payments — vote packs

apps.accounts.modules.module_enabled() applies the requirements, so a child is off whenever a parent is off.
Two checks apply to a contest: the requesting user's role (anonymous visitors: the global switch) and the contest
organizer's role (a feature switched off for organizers is off on their contests for everyone).
"""
from rest_framework import permissions
from rest_framework.exceptions import APIException

from apps.accounts.modules import module_enabled

CONTESTS, JUDGING, PAID_VOTES = 'contests', 'judging', 'paid_votes'


class ModuleDisabled(APIException):
    status_code = 403
    default_code = 'module_disabled'

    def __init__(self, slug):
        super().__init__()
        # Same body as the middleware's disabled_response()
        self.detail = {'error': 'This feature is turned off for your account.', 'code': 'module_disabled', 'module': slug}


def user_of(request):
    user = getattr(request, 'user', None)
    return user if user is not None and getattr(user, 'is_authenticated', False) else None


def on_for_contest(slug, poll, user=None):
    """The module is on for this visitor and for the contest's organizer."""
    return module_enabled(slug, user) and module_enabled(slug, poll.event.organizer)


def require(slug, request, poll=None):
    user = user_of(request)
    if not module_enabled(slug, user) or (poll is not None and not module_enabled(slug, poll.event.organizer)):
        raise ModuleDisabled(slug)


def judging_counts(poll):
    """Whether judges' scores count in this contest's results (the organizer's judging module)."""
    return module_enabled(JUDGING, poll.event.organizer)


def RequiresModule(slug):  # noqa: N802 — used like a class in permission_classes
    class _Requires(permissions.BasePermission):
        def has_permission(self, request, view):
            if not module_enabled(slug, user_of(request)):
                raise ModuleDisabled(slug)
            return True
    _Requires.__name__ = f'Requires_{slug}'
    return _Requires
