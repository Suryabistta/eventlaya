"""Platform modules the superadmin can switch on/off, globally and per role, enforced for the whole API.

Every feature belongs to a module (MODULES). ModuleAccessMiddleware maps request paths to modules and
answers 403 {"code": "module_disabled"} when the module is off. Clients also read /api/auth/modules/ to
hide the feature, but the server check is what actually blocks it.
"""
import re

from django.core.cache import cache
from django.http import JsonResponse

# slug, name, description, icon, order, roles that get it by default
MODULES = [
    ('events', 'Events Management', 'Create, manage, and monitor live events and attendee capacity.', 'Calendar', 1,
     ['organizer', 'staff', 'attendee']),
    ('gate_scanner', 'Gate QR Scanner Terminal', 'Real-time entry/exit QR scanning, attendee roster, and fraud detection.',
     'QrCode', 2, ['organizer', 'staff']),
    ('dynamic_forms', 'Dynamic Registration Forms', 'Custom form builder with 10 question types and live preview canvas.',
     'FormInput', 3, ['organizer']),
    ('voting', 'Voting', 'Master switch for all voting: quick audience polls, and contests when those are on.', 'Vote', 4,
     ['organizer', 'attendee']),
    ('marketplace', 'Vendor Services Marketplace', 'Vendor and venue directory, inquiries and listings.', 'Store', 5,
     ['organizer', 'vendor', 'attendee']),
    ('staff_management', 'Gate Staff & Team', 'Onboard team members and assign them to gates.', 'Users', 6, ['organizer']),
    ('chat', 'Team Chat', 'Personal and group chat between organizers and their team.', 'MessageCircle', 7,
     ['organizer', 'staff']),
    ('reviews', 'Reviews & Ratings', 'Attendees review events they attended and vendors or venues they contacted.',
     'Star', 8, ['organizer', 'vendor', 'attendee']),
    ('white_label', 'White-label sites', 'Organizer sites on their own domain or <name>.eventlaya.com, with their brand.',
     'Globe', 9, ['organizer']),
    ('payments', 'Online payments', 'Khalti and eSewa checkout (tickets first); payments reports and payouts.',
     'CreditCard', 10, ['organizer', 'attendee']),
    ('blog', 'Blog', 'Public blog and guides on eventlaya.com, written by the platform team in the superadmin editor.',
     'Newspaper', 11, ['organizer', 'staff', 'attendee', 'vendor']),
    # Voting sub-modules (apps.voting.access enforces them per view; all live under /api/voting/)
    ('contests', 'Pageant & contests', 'Contests with numbered contestants, categories, rounds, public contest pages and '
     'the presenter. Requires Voting.', 'Crown', 12, ['organizer', 'attendee']),
    ('judging', "Judges' scoring", "Judges score contestants; judges' scores count in contest results. Requires Pageant & "
     'contests.', 'Gavel', 13, ['organizer', 'attendee', 'staff']),
    ('paid_votes', 'Paid votes', 'Voters buy vote packs in contests. Requires Pageant & contests and Online payments.',
     'Coins', 14, ['organizer', 'attendee']),
    # November 2026 batch (docs/plan-2026-11-feature-batch.md)
    ('banners', 'Marketplace banners', 'Sliding banner images at the top of the marketplace, uploaded by the platform team.',
     'GalleryHorizontal', 15, ['organizer', 'staff', 'attendee', 'vendor']),
    ('seat_numbers', 'Seat numbers', 'Organizers assign seat numbers to tickets and choose whether attendees see them.',
     'Armchair', 16, ['organizer', 'staff', 'attendee']),
    ('packages', 'Vendor & venue packages', 'Vendors and venues publish priced packages that customers can ask about.',
     'Package', 17, ['organizer', 'vendor', 'attendee']),
    ('sub_events', 'Sub-events', 'A main event with child events, each with its own registration form and tickets.',
     'ListTree', 18, ['organizer', 'staff', 'attendee']),
    ('offline_tickets', 'Printed tickets', 'Bulk printed tickets with QR codes for shop, counter and door sales; '
     'scanned at the gate like online passes.', 'Printer', 19, ['organizer', 'staff']),
]

# A module is only on when every module it requires is on too (for the same user).
MODULE_REQUIRES = {
    'contests': ['voting'],
    'judging': ['contests'],
    'paid_votes': ['contests', 'payments'],
    'packages': ['marketplace'],
}
ROLES = ['superadmin', 'organizer', 'staff', 'attendee', 'vendor']

# First match wins, so more specific paths come first.
PATH_MODULES = [
    (re.compile(r'^/api/events/staff-assign/'), 'staff_management'),
    (re.compile(r'^/api/events/[0-9a-f-]{36}/seats/'), 'seat_numbers'),
    (re.compile(r'^/api/events/[0-9a-f-]{36}/ticket-batches/'), 'offline_tickets'),
    (re.compile(r'^/api/auth/team/'), 'staff_management'),
    (re.compile(r'^/api/events/my-assignment/'), 'gate_scanner'),
    (re.compile(r'^/api/events/[0-9a-f-]{36}/(gate|gates|tickets|export-attendees|broadcast)/'), 'gate_scanner'),
    (re.compile(r'^/api/events/'), 'events'),
    (re.compile(r'^/api/forms/events/[^/]+/register/'), 'events'),  # attendee registration belongs to events
    (re.compile(r'^/api/forms/'), 'dynamic_forms'),
    (re.compile(r'^/api/voting/'), 'voting'),
    (re.compile(r'^/api/marketplace/packages/'), 'packages'),
    (re.compile(r'^/api/marketplace/'), 'marketplace'),
    (re.compile(r'^/api/chat/'), 'chat'),
    (re.compile(r'^/ws/chat/'), 'chat'),
    (re.compile(r'^/api/reviews/'), 'reviews'),
    # Payment returns and status polls stay reachable even when the module is off: money already taken must settle
    (re.compile(r'^/api/payments/(return|test)/'), None),
    (re.compile(r'^/api/payments/intents/[0-9a-f-]{36}/$'), None),
    (re.compile(r'^/api/payments/'), 'payments'),
    (re.compile(r'^/api/me/tickets/'), 'events'),  # attendee's own tickets
    (re.compile(r'^/api/me/inquiries/'), 'marketplace'),  # attendee's sent marketplace inquiries
    # Organizer branding + requests. Not the public resolve endpoint: visitors of a tenant site must get an
    # answer ("not available") even when the module is off; tenancy.white_label_active() stops the site itself.
    (re.compile(r'^/api/auth/tenant-branding/(?!resolve/)'), 'white_label'),
    (re.compile(r'^/api/platform/white-label/'), 'white_label'),
    (re.compile(r'^/api/blog/'), 'blog'),
    (re.compile(r'^/api/platform/banners/'), 'banners'),  # public reading too: off → the blog 404s (apps.seo checks it for pages)
]

CACHE_KEY = 'platform-modules:v1'
CACHE_SECONDS = 15


def module_for_path(path):
    for pattern, slug in PATH_MODULES:
        if pattern.match(path):
            return slug
    return None


def _state():
    """{slug: (globally_enabled, {role: is_enabled})}, cached briefly."""
    state = cache.get(CACHE_KEY)
    if state is None:
        from .models import PlatformModule, RoleModulePermission
        state = {m.slug: [m.is_globally_enabled, {}] for m in PlatformModule.objects.all()}
        by_id = {m.id: m.slug for m in PlatformModule.objects.all()}
        for p in RoleModulePermission.objects.all():
            if p.module_id in by_id:
                state[by_id[p.module_id]][1][p.role] = p.is_enabled
        cache.set(CACHE_KEY, state, CACHE_SECONDS)
    return state


def clear_cache():
    cache.delete(CACHE_KEY)


def module_enabled(slug, user=None):
    """Whether `slug` is on for this user (anonymous visitors only need the global switch), including every module
    it requires (MODULE_REQUIRES): a child is off when its parent is off.

    Unknown modules count as enabled, so a missing row never locks people out; superadmins always pass.
    """
    return _module_enabled(slug, user) and all(module_enabled(parent, user) for parent in MODULE_REQUIRES.get(slug, ()))


def _module_enabled(slug, user=None):
    if user is not None and getattr(user, 'is_authenticated', False) and getattr(user, 'is_superadmin', False):
        return True
    entry = _state().get(slug)
    if entry is None:
        return True
    globally_enabled, roles = entry
    if not globally_enabled:
        return False
    if user is not None and getattr(user, 'is_authenticated', False):
        return roles.get(user.role, True)
    return True


def disabled_response(slug):
    return JsonResponse(
        {'error': 'This feature is turned off for your account.', 'code': 'module_disabled', 'module': slug},
        status=403,
    )


def _jwt_user(request):
    """The JWT user behind an API request (DRF authenticates inside views, too late for middleware)."""
    user = getattr(request, 'user', None)
    if user is not None and user.is_authenticated:
        return user
    try:
        from apps.accounts.authentication import JWTAuthentication
        result = JWTAuthentication().authenticate(request)
    except Exception:
        return None
    return result[0] if result else None


class ModuleAccessMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        slug = module_for_path(request.path)
        if slug and not module_enabled(slug, _jwt_user(request)):
            return disabled_response(slug)
        return self.get_response(request)
