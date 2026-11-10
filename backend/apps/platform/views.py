from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import FieldError
from django.db import DatabaseError, transaction
from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import TenantBranding
from apps.events.models import Event, EventTicket
from .models import ContactMessage, SmsCreditRequest, WhiteLabelRequest
from .serializers import ReviewSerializer, WhiteLabelRequestSerializer

User = get_user_model()

# Errors raised while Agent M's marketplace models/migrations are still landing
OPTIONAL_MODEL_ERRORS = (ImportError, LookupError, FieldError, DatabaseError, AttributeError)

ORG_ROLES = ('organizer', 'vendor')
LIVE_EVENT_STATUSES = (Event.Status.PUBLISHED, Event.Status.ONGOING)


class IsSuperadmin(permissions.BasePermission):
    message = 'Only platform admins can do this.'

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superadmin)


def display_name(user):
    return user.organization_name or user.get_full_name() or user.email


# ---------------------------------------------------------------------------
# White-label requests
# ---------------------------------------------------------------------------

class WhiteLabelRequestListCreateView(APIView):
    """GET (admin): all requests, filter with ?status=. POST (organizer): submit a request."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not request.user.is_superadmin:
            return Response({'error': IsSuperadmin.message}, status=status.HTTP_403_FORBIDDEN)
        qs = WhiteLabelRequest.objects.select_related('organizer', 'reviewed_by')
        st = request.query_params.get('status', 'pending')
        if st != 'all':
            qs = qs.filter(status=st)
        return Response(WhiteLabelRequestSerializer(qs, many=True).data)

    def post(self, request):
        if request.user.role != User.Role.ORGANIZER:
            return Response(
                {'error': 'Only event organizer accounts can request white-label.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if WhiteLabelRequest.objects.filter(organizer=request.user, status=WhiteLabelRequest.Status.PENDING).exists():
            return Response(
                {'error': 'You already have a request waiting for review. We’ll let you know once it’s decided.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = WhiteLabelRequestSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        obj = serializer.save(organizer=request.user)
        return Response(WhiteLabelRequestSerializer(obj).data, status=status.HTTP_201_CREATED)


class MyWhiteLabelRequestsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        qs = WhiteLabelRequest.objects.filter(organizer=request.user).select_related('organizer', 'reviewed_by')
        return Response(WhiteLabelRequestSerializer(qs, many=True).data)


def apply_white_label(req):
    """Copy an approved request onto the organizer's TenantBranding."""
    from apps.accounts import domains
    from apps.accounts.tenancy import unique_subdomain
    branding = TenantBranding.objects.filter(organizer=req.organizer).first()
    if branding is None:
        branding = TenantBranding(
            organizer=req.organizer,
            subdomain=unique_subdomain(req.organizer),
            support_email=req.organizer.email,
        )
    domain = req.requested_domain or None
    if branding.custom_domain != domain:
        if branding.provider_hostname_id:
            domains.deprovision(branding, branding.custom_domain or '')
        branding.custom_domain = domain
        domains.reset_domain_state(branding)
    branding.brand_name = req.brand_name
    if req.logo_url:
        branding.brand_logo = req.logo_url
    branding.primary_color = req.primary_color
    branding.accent_color = req.accent_color
    branding.remove_watermark = req.remove_watermark
    branding.save()
    return branding


class WhiteLabelApproveView(APIView):
    permission_classes = [IsSuperadmin]

    def post(self, request, pk):
        req = get_object_or_404(WhiteLabelRequest.objects.select_related('organizer'), pk=pk)
        if req.status != WhiteLabelRequest.Status.PENDING:
            return Response({'error': f'This request was already {req.status}.'}, status=status.HTTP_400_BAD_REQUEST)
        ser = ReviewSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        if req.requested_domain and TenantBranding.objects.filter(
            custom_domain__iexact=req.requested_domain
        ).exclude(organizer=req.organizer).exists():
            return Response(
                {'error': f'{req.requested_domain} is already connected to another organization. Reject this request and ask for a different domain.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            req.status = WhiteLabelRequest.Status.APPROVED
            req.review_note = ser.validated_data.get('note', '')
            req.reviewed_by = request.user
            req.reviewed_at = timezone.now()
            req.save()
            apply_white_label(req)
        return Response(WhiteLabelRequestSerializer(req).data)


class WhiteLabelRejectView(APIView):
    permission_classes = [IsSuperadmin]

    def post(self, request, pk):
        req = get_object_or_404(WhiteLabelRequest.objects.select_related('organizer'), pk=pk)
        if req.status != WhiteLabelRequest.Status.PENDING:
            return Response({'error': f'This request was already {req.status}.'}, status=status.HTTP_400_BAD_REQUEST)
        note = (request.data.get('note') or '').strip()
        if not note:
            return Response(
                {'error': 'Add a reason so the organizer knows what to change.'}, status=status.HTTP_400_BAD_REQUEST
            )
        req.status = WhiteLabelRequest.Status.REJECTED
        req.review_note = note
        req.reviewed_by = request.user
        req.reviewed_at = timezone.now()
        req.save()
        return Response(WhiteLabelRequestSerializer(req).data)


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def _pending_marketplace_access():
    try:
        from apps.marketplace.models import MarketplaceAccessRequest
        return MarketplaceAccessRequest.objects.filter(status='pending').count()
    except OPTIONAL_MODEL_ERRORS:
        return 0


def _pending_listings():
    try:
        from apps.marketplace.models import VendorProfile, VenueListing
        return (
            VenueListing.objects.filter(listing_status='pending').count()
            + VendorProfile.objects.filter(listing_status='pending').count()
        )
    except OPTIONAL_MODEL_ERRORS:
        return 0


def _org_queryset():
    return User.objects.filter(role__in=ORG_ROLES).select_related('subscription__plan').annotate(
        events=Count('organized_events', distinct=True),
        registrations=Count('organized_events__tickets', distinct=True),
    )


class PlatformStatsView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        today = timezone.localdate()
        start = today - timedelta(days=29)
        days = [start + timedelta(days=i) for i in range(30)]

        signups = {d: {'organizers': 0, 'vendors': 0} for d in days}
        rows = (
            User.objects.filter(role__in=ORG_ROLES, date_joined__date__gte=start)
            .annotate(day=TruncDate('date_joined'))
            .values('day', 'role')
            .annotate(n=Count('id'))
        )
        for r in rows:
            if r['day'] in signups:
                signups[r['day']]['organizers' if r['role'] == 'organizer' else 'vendors'] += r['n']

        regs = {d: 0 for d in days}
        for r in (
            EventTicket.objects.filter(created_at__date__gte=start)
            .annotate(day=TruncDate('created_at'))
            .values('day')
            .annotate(n=Count('id'))
        ):
            if r['day'] in regs:
                regs[r['day']] += r['n']

        top = (
            _org_queryset()
            .filter(role='organizer')
            .order_by('-registrations', '-events', 'date_joined')[:5]
        )

        return Response({
            'organizations': User.objects.filter(role='organizer').count(),
            'vendors': User.objects.filter(role='vendor').count(),
            'events_total': Event.objects.count(),
            'events_published': Event.objects.exclude(status__in=[Event.Status.DRAFT, Event.Status.CANCELLED]).count(),
            'events_upcoming': Event.objects.filter(status__in=LIVE_EVENT_STATUSES, start_date__gte=today).count(),
            'registrations_total': EventTicket.objects.exclude(status=EventTicket.Status.CANCELLED).count(),
            'checkins_total': EventTicket.objects.filter(first_check_in__isnull=False).count(),
            'pending': {
                'white_label': WhiteLabelRequest.objects.filter(status=WhiteLabelRequest.Status.PENDING).count(),
                'marketplace_access': _pending_marketplace_access(),
                'listings': _pending_listings(),
                'sms_credits': SmsCreditRequest.objects.filter(status=SmsCreditRequest.Status.PENDING).count(),
                'contact_messages': ContactMessage.objects.filter(handled=False).count(),
            },
            'signups_by_day': [{'date': d.isoformat(), **signups[d]} for d in days],
            'registrations_by_day': [{'date': d.isoformat(), 'count': regs[d]} for d in days],
            'top_organizations': [
                {'id': str(u.id), 'name': display_name(u), 'events': u.events, 'registrations': u.registrations}
                for u in top
            ],
        })


# ---------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------

def _org_row(u):
    return {
        'id': str(u.id),
        'name': display_name(u),
        'email': u.email,
        'phone': u.phone,
        'role': u.role,
        'marketplace_access': getattr(u, 'marketplace_access', 'none'),
        'is_active': u.is_active,
        'is_verified': u.is_verified,
        'date_joined': u.date_joined,
        'last_login': u.last_login,
        'events': u.events,
        'registrations': u.registrations,
        'plan': _plan_name(u),
    }


def _plan_name(user):
    sub = getattr(user, 'subscription', None)  # RelatedObjectDoesNotExist is an AttributeError
    return sub.plan.name if sub else 'Free'


def _users_in_city(city):
    """Organizations active in a city: events located there, or venue/vendor listings there."""
    from .segments import city_of
    ids = {e.organizer_id for e in Event.objects.only('organizer_id', 'location') if city_of(e.location).lower() == city.lower()}
    try:
        from apps.marketplace.models import VendorProfile, VenueListing
        ids |= set(VenueListing.objects.filter(city__iexact=city).values_list('owner_id', flat=True))
        ids |= set(VendorProfile.objects.filter(city__iexact=city).values_list('user_id', flat=True))
    except OPTIONAL_MODEL_ERRORS:
        pass
    return ids


class OrganizationListView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        qs = _org_queryset()
        org_type = request.query_params.get('type', 'all')
        if org_type == 'organizer':
            qs = qs.filter(role='organizer')
        elif org_type == 'events_only':
            # Event companies without a business portal (segments page)
            qs = qs.filter(role='organizer').exclude(marketplace_access='approved')
        elif org_type == 'both':
            qs = qs.filter(role='organizer', marketplace_access='approved')
        elif org_type == 'vendor':
            qs = qs.filter(role='vendor')
        plan = request.query_params.get('plan', 'all')
        if plan and plan != 'all':
            from .billing import ensure_subscriptions
            ensure_subscriptions()
            qs = qs.filter(subscription__plan__code=plan)
        city = request.query_params.get('city', '').strip()
        if city:
            qs = qs.filter(pk__in=_users_in_city(city))
        st = request.query_params.get('status', 'all')
        if st == 'active':
            qs = qs.filter(is_active=True)
        elif st == 'suspended':
            qs = qs.filter(is_active=False)
        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(email__icontains=search)
                | Q(organization_name__icontains=search)
                | Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(phone__icontains=search)
            )
        return Response([_org_row(u) for u in qs.order_by('-date_joined')])

    def post(self, request):
        from .org_admin import create_organization
        return create_organization(request)


class OrganizationDetailView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request, pk):
        user = get_object_or_404(_org_queryset(), pk=pk)
        events = (
            Event.objects.filter(organizer=user)
            .annotate(
                registrations=Count('tickets', distinct=True),
                checkins=Count('tickets', filter=Q(tickets__first_check_in__isnull=False), distinct=True),
            )
            .order_by('-start_date')
        )
        branding = TenantBranding.objects.filter(organizer=user).first()
        latest_wl = WhiteLabelRequest.objects.filter(organizer=user).first()
        approved_wl = WhiteLabelRequest.approved_for(user)
        from .org_admin import actions_for
        return Response({
            **_org_row(user),
            'checkins': sum(e.checkins for e in events),
            'listings': _listings_of(user),
            'admin_actions': actions_for(user),
            'events_list': [
                {
                    'id': str(e.id), 'title': e.title, 'slug': e.slug, 'status': e.status,
                    'start_date': e.start_date, 'location': e.location,
                    'registrations': e.registrations, 'checkins': e.checkins,
                }
                for e in events
            ],
            'white_label': {
                'status': latest_wl.status if latest_wl else 'none',
                'active': bool(approved_wl),
                'custom_domain': branding.custom_domain if (branding and approved_wl) else None,
                'is_domain_verified': bool(branding and approved_wl and branding.is_domain_verified),
            },
        })


def _listings_of(user):
    """Vendor profiles and venues this account owns, for the verified switches on the organization page."""
    try:
        from apps.marketplace.models import VendorProfile, VenueListing
    except OPTIONAL_MODEL_ERRORS:
        return []
    return [
        {'kind': 'vendor', 'id': str(v.id), 'name': v.business_name, 'status': v.listing_status, 'is_verified': v.is_verified}
        for v in VendorProfile.objects.filter(user=user)
    ] + [
        {'kind': 'venue', 'id': str(v.id), 'name': v.name, 'status': v.listing_status, 'is_verified': v.is_verified}
        for v in VenueListing.objects.filter(owner=user)
    ]


class _OrganizationStatusView(APIView):
    permission_classes = [IsSuperadmin]
    activate = True

    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        if user.is_superadmin:
            return Response({'error': 'Platform admin accounts can’t be suspended here.'}, status=status.HTTP_400_BAD_REQUEST)
        if user.role not in ORG_ROLES:
            return Response({'error': 'Only organizer and vendor accounts can be changed here.'}, status=status.HTTP_400_BAD_REQUEST)
        user.is_active = self.activate
        user.save(update_fields=['is_active'])
        return Response(_org_row(_org_queryset().get(pk=user.pk)))


class OrganizationSuspendView(_OrganizationStatusView):
    activate = False


class OrganizationActivateView(_OrganizationStatusView):
    activate = True


# ---------------------------------------------------------------------------
# Activity feed
# ---------------------------------------------------------------------------

def _item(kind, at, title, description='', link=''):
    return {'kind': kind, 'at': at, 'title': title, 'description': description, 'link': link}


def _review_items(prefix, label, qs, name_of):
    items = []
    for r in qs:
        name = name_of(r)
        items.append(_item(f'{prefix}_requested', r.created_at, f'{name} requested {label}', '', '/admin/approvals'))
        if r.reviewed_at and r.status in ('approved', 'rejected'):
            items.append(_item(
                f'{prefix}_{r.status}', r.reviewed_at, f'{label.capitalize()} {r.status} for {name}',
                r.review_note or '', '/admin/approvals',
            ))
    return items


class ActivityView(APIView):
    permission_classes = [IsSuperadmin]
    LIMIT = 50

    def get(self, request):
        n = self.LIMIT
        items = []

        for u in User.objects.filter(role__in=ORG_ROLES).order_by('-date_joined')[:n]:
            kind = 'Vendor' if u.role == 'vendor' else 'Event organizer'
            items.append(_item('signup', u.date_joined, f'{display_name(u)} signed up', f'{kind} account, {u.email}', '/admin/organizations'))

        for e in (
            Event.objects.exclude(status__in=[Event.Status.DRAFT, Event.Status.CANCELLED])
            .select_related('organizer').order_by('-created_at')[:n]
        ):
            items.append(_item(
                'event_published', e.created_at, f'{display_name(e.organizer)} published {e.title}',
                f'{e.location}, starts {e.start_date:%d %b %Y}', f'/e/{e.slug}',
            ))

        wl = WhiteLabelRequest.objects.select_related('organizer').order_by('-created_at')[:n]
        items += _review_items('white_label', 'white-label', wl, lambda r: display_name(r.organizer))

        try:
            from apps.marketplace.models import MarketplaceAccessRequest
            mar = list(MarketplaceAccessRequest.objects.select_related('user').order_by('-created_at')[:n])
            items += _review_items('marketplace', 'marketplace access', mar, lambda r: r.business_name or display_name(r.user))
        except OPTIONAL_MODEL_ERRORS:
            pass

        try:
            from apps.marketplace.models import VenueListing
            for v in VenueListing.objects.order_by('-created_at')[:n]:
                items.append(_item('listing_created', v.created_at, f'New venue listing: {v.name}', v.city, f'/marketplace/venues/{v.slug}'))
        except OPTIONAL_MODEL_ERRORS:
            pass

        from .models import AdminAction
        for a in AdminAction.objects.select_related('actor', 'target').order_by('-created_at')[:n]:
            items.append(_item(
                f'admin_{a.kind}', a.created_at, f'{a.get_kind_display()}: {display_name(a.target)}',
                f'by {a.actor.email}' if a.actor else '', f'/admin/organizations/{a.target_id}',
            ))

        items.sort(key=lambda i: i['at'], reverse=True)
        return Response(items[:n])


# ---------------------------------------------------------------------------
# Follow-up actions after a decision: revoke, reopen, unpublish
# ---------------------------------------------------------------------------

def _required_note(request, message='Add a reason so they know what happened.'):
    note = (request.data.get('note') or '').strip()
    return note, (None if note else Response({'error': message}, status=status.HTTP_400_BAD_REQUEST))


class WhiteLabelRevokeView(APIView):
    """Turn off an organizer's white-label: domain disconnected, watermark back."""

    permission_classes = [IsSuperadmin]

    def post(self, request, pk):
        req = get_object_or_404(WhiteLabelRequest.objects.select_related('organizer'), pk=pk)
        if req.status != WhiteLabelRequest.Status.APPROVED:
            return Response({'error': 'Only approved white-label can be revoked.'}, status=status.HTTP_400_BAD_REQUEST)
        note, err = _required_note(request)
        if err:
            return err
        from apps.accounts import domains
        with transaction.atomic():
            WhiteLabelRequest.objects.filter(organizer=req.organizer, status=WhiteLabelRequest.Status.APPROVED).update(
                status=WhiteLabelRequest.Status.REVOKED, review_note=note, reviewed_by=request.user, reviewed_at=timezone.now(),
            )
            branding = TenantBranding.objects.filter(organizer=req.organizer).first()
            if branding is not None:
                # Certificate first (Cloudflare custom hostname), then forget the domain.
                domains.deprovision(branding, branding.custom_domain or '')
                branding.custom_domain = None
                branding.remove_watermark = False
                domains.reset_domain_state(branding)
                branding.save()
        req.refresh_from_db()
        return Response(WhiteLabelRequestSerializer(req).data)


class WhiteLabelCheckDomainView(APIView):
    """Superadmin "Check now": run DNS verification + certificate sync for an approved tenant."""

    permission_classes = [IsSuperadmin]

    def post(self, request, pk):
        from apps.accounts.domains import check_domain
        from apps.accounts.views import verify_response
        req = get_object_or_404(WhiteLabelRequest.objects.select_related('organizer'), pk=pk)
        if req.status != WhiteLabelRequest.Status.APPROVED:
            return Response({'error': 'Only approved white-label has a domain to check.'}, status=status.HTTP_400_BAD_REQUEST)
        branding = TenantBranding.objects.filter(organizer=req.organizer).select_related('organizer').first()
        if branding is None:
            return Response({'error': 'This organization has no branding yet.'}, status=status.HTTP_400_BAD_REQUEST)
        if branding.custom_domain:
            check_domain(branding)
        return Response(verify_response(branding))


class WhiteLabelReopenView(APIView):
    """Put a rejected request back in the queue (e.g. after the organizer fixed DNS ownership)."""

    permission_classes = [IsSuperadmin]

    def post(self, request, pk):
        req = get_object_or_404(WhiteLabelRequest.objects.select_related('organizer'), pk=pk)
        if req.status not in (WhiteLabelRequest.Status.REJECTED, WhiteLabelRequest.Status.REVOKED):
            return Response({'error': 'Only rejected or revoked requests can be reopened.'}, status=status.HTTP_400_BAD_REQUEST)
        if WhiteLabelRequest.objects.filter(organizer=req.organizer, status=WhiteLabelRequest.Status.PENDING).exists():
            return Response({'error': 'This organizer already has a request waiting for review.'}, status=status.HTTP_400_BAD_REQUEST)
        req.status = WhiteLabelRequest.Status.PENDING
        req.review_note = ''
        req.reviewed_by = None
        req.reviewed_at = None
        req.save()
        return Response(WhiteLabelRequestSerializer(req).data)


def _marketplace_models():
    from apps.marketplace.models import ListingStatus, MarketplaceAccessRequest, VendorProfile, VenueInquiry, VenueListing
    return ListingStatus, MarketplaceAccessRequest, VendorProfile, VenueInquiry, VenueListing


class MarketplaceBusinessListView(APIView):
    """Accounts that can use the business portal: vendors, and organizers with approved access."""

    permission_classes = [IsSuperadmin]

    def get(self, request):
        ListingStatus, MarketplaceAccessRequest, VendorProfile, VenueInquiry, VenueListing = _marketplace_models()
        qs = User.objects.filter(Q(role='vendor') | Q(role='organizer', marketplace_access='approved'))
        kind = request.query_params.get('type', 'all')
        if kind in ORG_ROLES:
            qs = qs.filter(role=kind)
        rows = []
        for u in qs.order_by('organization_name', 'email'):
            venues = VenueListing.objects.filter(owner=u)
            vendors = VendorProfile.objects.filter(user=u)
            approved_req = (
                MarketplaceAccessRequest.objects.filter(user=u, status='approved').select_related('reviewed_by').order_by('-reviewed_at').first()
            )
            rows.append({
                'id': str(u.id),
                'name': display_name(u),
                'email': u.email,
                'role': u.role,
                'is_active': u.is_active,
                'listings': {
                    'total': venues.count() + vendors.count(),
                    'live': venues.filter(listing_status=ListingStatus.APPROVED).count() + vendors.filter(listing_status=ListingStatus.APPROVED).count(),
                    'pending': venues.filter(listing_status=ListingStatus.PENDING).count() + vendors.filter(listing_status=ListingStatus.PENDING).count(),
                },
                'inquiries': VenueInquiry.objects.filter(venue__owner=u).count(),
                'business_name': approved_req.business_name if approved_req else '',
                'approved_at': approved_req.reviewed_at if approved_req else None,
                'approved_by': approved_req.reviewed_by.email if approved_req and approved_req.reviewed_by else None,
            })
        return Response(rows)


class MarketplaceRevokeView(APIView):
    """Remove an organizer's marketplace access and take their listings off the public marketplace."""

    permission_classes = [IsSuperadmin]

    def post(self, request, pk):
        ListingStatus, MarketplaceAccessRequest, VendorProfile, VenueInquiry, VenueListing = _marketplace_models()
        user = get_object_or_404(User, pk=pk)
        if user.role != 'organizer' or user.marketplace_access != 'approved':
            return Response(
                {'error': 'Only event companies with marketplace access can be revoked. Suspend vendor accounts instead.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        note, err = _required_note(request)
        if err:
            return err
        with transaction.atomic():
            user.marketplace_access = 'rejected'
            user.save(update_fields=['marketplace_access'])
            MarketplaceAccessRequest.objects.filter(user=user, status='approved').update(
                status='rejected', review_note=f'Access revoked: {note}', reviewed_by=request.user, reviewed_at=timezone.now(),
            )
            hidden = (
                VenueListing.objects.filter(owner=user, listing_status=ListingStatus.APPROVED).update(
                    listing_status=ListingStatus.REJECTED, review_note=f'Marketplace access revoked: {note}')
                + VendorProfile.objects.filter(user=user, listing_status=ListingStatus.APPROVED).update(
                    listing_status=ListingStatus.REJECTED, review_note=f'Marketplace access revoked: {note}')
            )
        return Response({'id': str(user.id), 'marketplace_access': 'rejected', 'listings_hidden': hidden})


class ListingUnpublishView(APIView):
    """Take a live listing off the marketplace: back to review (pending) or rejected with a reason."""

    permission_classes = [IsSuperadmin]

    def post(self, request, kind, pk):
        ListingStatus, _, VendorProfile, _, VenueListing = _marketplace_models()
        model = {'venue': VenueListing, 'vendor': VendorProfile}.get(kind)
        if model is None:
            return Response({'error': 'Unknown listing type. Use "venue" or "vendor".'}, status=status.HTTP_404_NOT_FOUND)
        listing = get_object_or_404(model, pk=pk)
        if listing.listing_status != ListingStatus.APPROVED:
            return Response({'error': 'Only live listings can be unpublished.'}, status=status.HTTP_400_BAD_REQUEST)
        note, err = _required_note(request, 'Add a reason so the owner knows what to fix.')
        if err:
            return err
        target = request.data.get('to', 'pending')
        if target not in (ListingStatus.PENDING, ListingStatus.REJECTED):
            return Response({'error': 'Unpublish to "pending" or "rejected".'}, status=status.HTTP_400_BAD_REQUEST)
        listing.listing_status = target
        listing.review_note = note
        listing.save(update_fields=['listing_status', 'review_note'])
        return Response({'kind': kind, 'id': str(listing.id), 'listing_status': target, 'review_note': note})
