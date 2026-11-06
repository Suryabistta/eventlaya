"""Platform-by-segment dashboard: account type, city and plan."""
import math
from collections import defaultdict
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.events.models import Event, EventTicket
from .billing import ORG_ROLES, ensure_subscriptions
from .models import Plan, Subscription
from .views import OPTIONAL_MODEL_ERRORS, IsSuperadmin

User = get_user_model()
RANGES = (30, 90, 365)
TOP_CITIES = 8


def city_of(location):
    """'Purwanchal Campus Auditorium, Dharan' → 'Dharan'."""
    part = (location or '').split(',')[-1].strip()
    return part.title() if part else 'Other'


def account_types():
    """(key, label, queryset) per account type. `key` matches the organizations page `type` filter."""
    org = User.objects.filter(role='organizer')
    return [
        ('events_only', 'Event companies', org.exclude(marketplace_access='approved')),
        ('both', 'Events and marketplace', org.filter(marketplace_access='approved')),
        ('vendor', 'Vendors', User.objects.filter(role='vendor')),
        ('staff', 'Gate staff', User.objects.filter(role='staff')),
    ]


def type_key(user):
    if user.role == 'vendor':
        return 'vendor'
    return 'both' if getattr(user, 'marketplace_access', 'none') == 'approved' else 'organizer'


def _listing_models():
    from apps.marketplace.models import VendorProfile, VenueInquiry, VenueListing
    return VenueListing, VendorProfile, VenueInquiry


class SegmentsView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        try:
            days = int(request.query_params.get('range', 30))
        except ValueError:
            days = 30
        days = days if days in RANGES else 30
        now = timezone.now()
        since = now - timedelta(days=days)
        today = timezone.localdate()

        try:
            VenueListing, VendorProfile, VenueInquiry = _listing_models()
        except OPTIONAL_MODEL_ERRORS:  # pragma: no cover
            VenueListing = VendorProfile = VenueInquiry = None

        # --- Account type -------------------------------------------------
        by_type = []
        for key, label, qs in account_types():
            ids = list(qs.values_list('id', flat=True))
            listings = 0
            if VenueListing is not None:
                listings = VenueListing.objects.filter(owner_id__in=ids).count() + VendorProfile.objects.filter(user_id__in=ids).count()
            by_type.append({
                'key': key,
                'label': label,
                'accounts': len(ids),
                'active_accounts': qs.filter(is_active=True).count(),
                'new_in_range': qs.filter(date_joined__gte=since).count(),
                'events': Event.objects.filter(organizer_id__in=ids, created_at__gte=since).count(),
                'registrations': EventTicket.objects.filter(event__organizer_id__in=ids, created_at__gte=since).count(),
                'listings': listings,
                'linkable': key != 'staff',
            })

        # --- City -----------------------------------------------------------
        cities = defaultdict(lambda: {'orgs': set(), 'events': 0, 'registrations': 0, 'listings': 0})
        regs_by_event = dict(
            EventTicket.objects.filter(created_at__gte=since).values('event_id').annotate(n=Count('id')).values_list('event_id', 'n')
        )
        for e in Event.objects.only('id', 'location', 'organizer_id', 'created_at'):
            c = cities[city_of(e.location)]
            c['orgs'].add(e.organizer_id)
            if e.created_at >= since:
                c['events'] += 1
            c['registrations'] += regs_by_event.get(e.id, 0)
        if VenueListing is not None:
            for city, owner in VenueListing.objects.values_list('city', 'owner_id'):
                c = cities[(city or 'Other').strip().title()]
                c['orgs'].add(owner)
                c['listings'] += 1
            for city, owner in VendorProfile.objects.values_list('city', 'user_id'):
                c = cities[(city or 'Other').strip().title()]
                c['orgs'].add(owner)
                c['listings'] += 1
        city_rows = sorted(
            ({'city': k, 'orgs': len(v['orgs']), 'events': v['events'], 'registrations': v['registrations'], 'listings': v['listings']}
             for k, v in cities.items()),
            key=lambda r: (r['orgs'] + r['events'] + r['listings'], r['registrations']), reverse=True,
        )
        if len(city_rows) > TOP_CITIES:
            rest = city_rows[TOP_CITIES - 1:]
            city_rows = city_rows[:TOP_CITIES - 1] + [{
                'city': 'Other', 'other': True,
                **{k: sum(r[k] for r in rest) for k in ('orgs', 'events', 'registrations', 'listings')},
            }]

        # --- Plan -----------------------------------------------------------
        ensure_subscriptions()
        subs = list(Subscription.objects.filter(organization__role__in=ORG_ROLES).select_related('plan'))
        org_events = dict(
            Event.objects.filter(created_at__gte=since).values('organizer_id').annotate(n=Count('id')).values_list('organizer_id', 'n')
        )
        org_regs = dict(
            EventTicket.objects.filter(created_at__gte=since).values('event__organizer_id').annotate(n=Count('id'))
            .values_list('event__organizer_id', 'n')
        )
        total_mrr = 0.0
        per_plan = {p.code: {'plan': p.code, 'name': p.name, 'orgs': 0, 'mrr': 0.0, 'events': 0, 'registrations': 0} for p in Plan.objects.all()}
        for s in subs:
            row = per_plan[s.plan.code]
            row['orgs'] += 1
            row['events'] += org_events.get(s.organization_id, 0)
            row['registrations'] += org_regs.get(s.organization_id, 0)
            if s.status == Subscription.Status.ACTIVE and s.plan.is_paid:
                v = s.plan.monthly_value(s.billing_cycle)
                row['mrr'] += v
                total_mrr += v
        by_plan = []
        for row in per_plan.values():
            n = row['orgs']
            by_plan.append({
                **row,
                'mrr': round(row['mrr']),
                'mrr_share': round(row['mrr'] / total_mrr * 100, 1) if total_mrr else 0,
                'avg_events': round(row['events'] / n, 1) if n else 0,
                'avg_registrations': round(row['registrations'] / n, 1) if n else 0,
            })

        # --- Growth: sign-ups per week per type -------------------------------
        weeks = math.ceil(days / 7)
        first = today - timedelta(days=7 * (weeks - 1))
        growth = [{'week_start': (first + timedelta(days=7 * i)).isoformat(), 'organizer': 0, 'both': 0, 'vendor': 0} for i in range(weeks)]
        for u in User.objects.filter(role__in=ORG_ROLES, date_joined__date__gte=first - timedelta(days=6)):
            idx = (timezone.localdate(u.date_joined) - first).days // 7
            idx = max(0, min(weeks - 1, idx))
            growth[idx][type_key(u)] += 1

        # --- Engagement ---------------------------------------------------------
        organizers = User.objects.filter(role='organizer', is_active=True)
        active_ids = set(
            Event.objects.filter(Q(created_at__gte=since) | Q(start_date__gte=since.date()), organizer__in=organizers)
            .values_list('organizer_id', flat=True)
        )
        total_orgs = organizers.count()
        engagement = {
            'total': total_orgs,
            'active': len(active_ids),
            'dormant': total_orgs - len(active_ids),
            'active_pct': round(len(active_ids) / total_orgs * 100) if total_orgs else 0,
        }

        # --- Marketplace ----------------------------------------------------------
        marketplace = {'listings_by_category': [], 'inquiries_by_city': []}
        if VenueListing is not None:
            cats = defaultdict(lambda: {'approved': 0, 'pending': 0, 'rejected': 0})
            labels = dict(VenueListing.VenueType.choices)
            for vt, st, n in VenueListing.objects.values_list('venue_type', 'listing_status').annotate(n=Count('id')):
                cats[('venue', labels.get(vt, vt))][st] += n
            for name, st, n in VendorProfile.objects.values_list('category__name', 'listing_status').annotate(n=Count('id')):
                cats[('vendor', name or 'Other')][st] += n
            marketplace['listings_by_category'] = sorted(
                ({'kind': k, 'label': label, **v} for (k, label), v in cats.items()),
                key=lambda r: r['approved'] + r['pending'] + r['rejected'], reverse=True,
            )
            marketplace['inquiries_by_city'] = [
                {'city': (r['venue__city'] or 'Other').title(), 'count': r['n']}
                for r in VenueInquiry.objects.filter(created_at__gte=since).values('venue__city').annotate(n=Count('id')).order_by('-n')
            ]

        return Response({
            'range': days,
            'by_type': by_type,
            'by_city': city_rows,
            'by_plan': by_plan,
            'growth': growth,
            'engagement': engagement,
            'marketplace': marketplace,
        })
