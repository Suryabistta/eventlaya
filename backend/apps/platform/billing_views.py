import csv
import io
from datetime import datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncMonth
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from .billing import ORG_ROLES, add_months, apply_plan, days_left, ensure_subscriptions, extend, get_subscription, refresh_all_statuses
from .models import Payment, Plan, PlanChangeRequest, Subscription
from .views import IsSuperadmin, display_name

User = get_user_model()


class CSVRenderer(BaseRenderer):
    media_type = 'text/csv'
    format = 'csv'
    charset = 'utf-8'

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data if isinstance(data, (str, bytes)) else ''


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------

def plan_dict(p):
    return {
        'code': p.code, 'name': p.name, 'monthly_price': p.monthly_price, 'yearly_price': p.yearly_price,
        'attendee_limit': p.attendee_limit, 'features': p.features,
    }


def payment_dict(p):
    return {
        'id': str(p.id),
        'organization_id': str(p.organization_id),
        'organization_name': display_name(p.organization),
        'organization_email': p.organization.email,
        'plan': p.plan.code if p.plan else None,
        'plan_name': p.plan.name if p.plan else None,
        'billing_cycle': p.billing_cycle,
        'amount': p.amount,
        'method': p.method,
        'method_display': p.get_method_display(),
        'reference': p.reference,
        'months_covered': p.months_covered,
        'paid_at': p.paid_at,
        'recorded_by_email': p.recorded_by.email if p.recorded_by else None,
        'note': p.note,
        'status': p.status,
        'refunded_at': p.refunded_at,
        'refund_note': p.refund_note,
    }


def subscription_dict(s, last_payment=None):
    u = s.organization
    return {
        'organization_id': str(u.id),
        'organization_name': display_name(u),
        'organization_email': u.email,
        'role': u.role,
        'plan': s.plan.code,
        'plan_name': s.plan.name,
        'billing_cycle': s.billing_cycle,
        'status': s.status,
        'current_period_start': s.current_period_start,
        'current_period_end': s.current_period_end,
        'days_left': days_left(s),
        'auto_renew': s.auto_renew,
        'monthly_value': round(s.plan.monthly_value(s.billing_cycle)) if s.plan.is_paid else 0,
        'last_payment': (
            {'amount': last_payment.amount, 'paid_at': last_payment.paid_at, 'method': last_payment.get_method_display()}
            if last_payment else None
        ),
    }


def _current_plan_code(user):
    sub = Subscription.objects.filter(organization=user).select_related('plan').first()
    return sub.plan.code if sub else Plan.Code.FREE


def request_dict(r):
    return {
        'id': str(r.id),
        'organization_id': str(r.organization_id),
        'organization_name': display_name(r.organization),
        'organization_email': r.organization.email,
        'current_plan': _current_plan_code(r.organization),
        'requested_plan': r.requested_plan.code,
        'requested_plan_name': r.requested_plan.name,
        'billing_cycle': r.billing_cycle,
        'note': r.note,
        'status': r.status,
        'review_note': r.review_note,
        'created_at': r.created_at,
        'reviewed_at': r.reviewed_at,
    }


def _err(msg, code=status.HTTP_400_BAD_REQUEST):
    return Response({'error': msg}, status=code)


def _plan_or_none(code):
    return Plan.objects.filter(code=code, is_active=True).first()


def _cycle(value):
    return value if value in Subscription.Cycle.values else None


def _active_paid():
    return Subscription.objects.filter(status=Subscription.Status.ACTIVE).exclude(plan__code=Plan.Code.FREE).select_related('plan')


def mrr_of(qs):
    return sum(s.plan.monthly_value(s.billing_cycle) for s in qs)


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------

class PlanListView(APIView):
    """Active plans with prices: public, so the marketing site always shows current pricing."""

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response([plan_dict(p) for p in Plan.objects.filter(is_active=True)])


class BillingSummaryView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        ensure_subscriptions()
        refresh_all_statuses()
        now = timezone.now()
        mrr = mrr_of(_active_paid())
        live = Subscription.objects.filter(status__in=[Subscription.Status.ACTIVE, Subscription.Status.TRIAL]).exclude(
            plan__code=Plan.Code.FREE
        )

        month_start = timezone.localtime(now).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        last_month_start = add_months(month_start, -1)
        paid = Payment.objects.filter(status=Payment.Status.RECORDED)

        def total(qs):
            return qs.aggregate(t=Sum('amount'))['t'] or 0

        first = add_months(month_start, -11)
        by_month = {
            r['m'].strftime('%Y-%m'): r['t']
            for r in paid.filter(paid_at__gte=first).annotate(m=TruncMonth('paid_at')).values('m').annotate(t=Sum('amount'))
        }
        months = [add_months(first, i).strftime('%Y-%m') for i in range(12)]

        mix = {r['plan__code']: r['n'] for r in Subscription.objects.filter(organization__role__in=ORG_ROLES).values('plan__code').annotate(n=Count('id'))}

        return Response({
            'mrr': round(mrr),
            'arr': round(mrr * 12),
            'active_paid': _active_paid().count(),
            'trials': Subscription.objects.filter(status=Subscription.Status.TRIAL).count(),
            'past_due': Subscription.objects.filter(status=Subscription.Status.PAST_DUE).count(),
            'expiring_7d': live.filter(current_period_end__gte=now, current_period_end__lte=now + timedelta(days=7)).count(),
            'expiring_30d': live.filter(current_period_end__gte=now, current_period_end__lte=now + timedelta(days=30)).count(),
            'revenue_this_month': total(paid.filter(paid_at__gte=month_start)),
            'revenue_last_month': total(paid.filter(paid_at__gte=last_month_start, paid_at__lt=month_start)),
            'revenue_by_month': [{'month': m, 'amount': by_month.get(m, 0)} for m in months],
            'plan_mix': [{'plan': p.code, 'name': p.name, 'count': mix.get(p.code, 0)} for p in Plan.objects.all()],
            'pending_upgrades': PlanChangeRequest.objects.filter(status=PlanChangeRequest.Status.PENDING).count(),
        })


class SubscriptionListView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        ensure_subscriptions()
        refresh_all_statuses()
        qs = Subscription.objects.filter(organization__role__in=ORG_ROLES).select_related('plan', 'organization')
        p = request.query_params
        if p.get('status') and p['status'] != 'all':
            qs = qs.filter(status=p['status'])
        if p.get('plan') and p['plan'] != 'all':
            qs = qs.filter(plan__code=p['plan'])
        if p.get('expiring') in ('7', '30'):
            now = timezone.now()
            qs = qs.filter(
                status__in=[Subscription.Status.ACTIVE, Subscription.Status.TRIAL],
                current_period_end__gte=now, current_period_end__lte=now + timedelta(days=int(p['expiring'])),
            )
        search = (p.get('search') or '').strip()
        if search:
            qs = qs.filter(Q(organization__email__icontains=search) | Q(organization__organization_name__icontains=search))
        subs = list(qs.order_by('current_period_end', 'organization__organization_name'))
        last = {}
        for pay in Payment.objects.filter(organization_id__in=[s.organization_id for s in subs], status=Payment.Status.RECORDED).order_by('paid_at'):
            last[pay.organization_id] = pay
        # Paid plans first (soonest renewal first), then Free
        subs.sort(key=lambda s: (not s.plan.is_paid, s.current_period_end is None, s.current_period_end or timezone.now()))
        return Response([subscription_dict(s, last.get(s.organization_id)) for s in subs])


def _org(pk):
    return get_object_or_404(User, pk=pk, role__in=ORG_ROLES)


class RecordPaymentView(APIView):
    permission_classes = [IsSuperadmin]

    def post(self, request, org_id):
        org = _org(org_id)
        d = request.data
        sub = get_subscription(org)
        plan = _plan_or_none(d.get('plan') or sub.plan.code)
        if not plan or not plan.is_paid:
            return _err('Choose a paid plan for this payment.')
        cycle = _cycle(d.get('billing_cycle') or sub.billing_cycle)
        if not cycle:
            return _err('Billing cycle must be monthly or yearly.')
        try:
            months = int(d.get('months') or (12 if cycle == 'yearly' else 1))
            amount = int(d.get('amount'))
        except (TypeError, ValueError):
            return _err('Enter the amount in NPR and the number of months as whole numbers.')
        if not 1 <= months <= 36:
            return _err('A payment can cover between 1 and 36 months.')
        if amount <= 0:
            return _err('The amount must be more than zero.')
        method = d.get('method')
        if method not in Payment.Method.values:
            return _err('Choose how they paid.')
        sub = extend(sub, plan, cycle, months)
        pay = Payment.objects.create(
            organization=org, subscription=sub, plan=plan, billing_cycle=cycle, amount=amount, method=method,
            reference=(d.get('reference') or '').strip()[:120], months_covered=months, paid_at=timezone.now(),
            recorded_by=request.user, note=(d.get('note') or '').strip(),
        )
        return Response({'subscription': subscription_dict(sub, pay), 'payment': payment_dict(pay)}, status=status.HTTP_201_CREATED)


class ChangePlanView(APIView):
    permission_classes = [IsSuperadmin]

    def post(self, request, org_id):
        org = _org(org_id)
        plan = _plan_or_none(request.data.get('plan'))
        cycle = _cycle(request.data.get('billing_cycle') or 'monthly')
        if not plan:
            return _err('Choose a plan.')
        if not cycle:
            return _err('Billing cycle must be monthly or yearly.')
        sub = apply_plan(get_subscription(org), plan, cycle)
        return Response(subscription_dict(sub))


class CancelSubscriptionView(APIView):
    permission_classes = [IsSuperadmin]

    def post(self, request, org_id):
        sub = get_subscription(_org(org_id))
        if not sub.plan.is_paid:
            return _err('Free plans can’t be cancelled.')
        sub.status = Subscription.Status.CANCELLED
        sub.auto_renew = False
        sub.save()
        return Response(subscription_dict(sub))


def _parse_date(value, end=False):
    try:
        d = datetime.strptime(value, '%Y-%m-%d').date()
    except (TypeError, ValueError):
        return None
    return timezone.make_aware(datetime.combine(d, time.max if end else time.min))


class PaymentListView(APIView):
    permission_classes = [IsSuperadmin]
    renderer_classes = [JSONRenderer, CSVRenderer]

    def get(self, request):
        qs = Payment.objects.select_related('organization', 'plan', 'recorded_by')
        p = request.query_params
        start, end = _parse_date(p.get('from')), _parse_date(p.get('to'), end=True)
        if start:
            qs = qs.filter(paid_at__gte=start)
        if end:
            qs = qs.filter(paid_at__lte=end)
        if p.get('method') and p['method'] != 'all':
            qs = qs.filter(method=p['method'])
        if p.get('status') and p['status'] != 'all':
            qs = qs.filter(status=p['status'])
        if p.get('organization'):
            qs = qs.filter(organization_id=p['organization'])
        rows = [payment_dict(x) for x in qs]
        if request.accepted_renderer.format == 'csv':
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(['Paid at', 'Organization', 'Email', 'Plan', 'Cycle', 'Months', 'Amount (NPR)', 'Method', 'Reference', 'Status', 'Recorded by', 'Note'])
            for r in rows:
                w.writerow([
                    timezone.localtime(r['paid_at']).strftime('%Y-%m-%d %H:%M'), r['organization_name'], r['organization_email'],
                    r['plan_name'] or '', r['billing_cycle'], r['months_covered'], r['amount'], r['method_display'],
                    r['reference'], r['status'], r['recorded_by_email'] or '', r['note'],
                ])
            resp = Response(buf.getvalue(), content_type='text/csv')
            resp['Content-Disposition'] = f'attachment; filename="eventlaya-payments-{timezone.localdate()}.csv"'
            return resp
        return Response(rows)


class RefundPaymentView(APIView):
    permission_classes = [IsSuperadmin]

    def post(self, request, pk):
        pay = get_object_or_404(Payment.objects.select_related('organization', 'plan', 'recorded_by'), pk=pk)
        if pay.status == Payment.Status.REFUNDED:
            return _err('This payment was already refunded.')
        note = (request.data.get('note') or '').strip()
        if not note:
            return _err('Add a reason for the refund.')
        pay.status = Payment.Status.REFUNDED
        pay.refunded_at = timezone.now()
        pay.refund_note = note
        pay.save()
        return Response(payment_dict(pay))


class UpgradeRequestListCreateView(APIView):
    """GET (admin): upgrade requests. POST (organizer/vendor): ask for a plan change."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not request.user.is_superadmin:
            return _err(IsSuperadmin.message, status.HTTP_403_FORBIDDEN)
        qs = PlanChangeRequest.objects.select_related('organization', 'requested_plan')
        st = request.query_params.get('status', 'pending')
        if st != 'all':
            qs = qs.filter(status=st)
        return Response([request_dict(r) for r in qs])

    def post(self, request):
        if request.user.role not in ORG_ROLES:
            return _err('Only event company and vendor accounts have a plan.', status.HTTP_403_FORBIDDEN)
        plan = _plan_or_none(request.data.get('plan'))
        cycle = _cycle(request.data.get('billing_cycle') or 'monthly')
        if not plan or not cycle:
            return _err('Choose a plan and billing cycle.')
        sub = get_subscription(request.user)
        if sub.plan_id == plan.id and sub.billing_cycle == cycle and sub.status == Subscription.Status.ACTIVE:
            return _err(f'You’re already on {plan.name}.')
        if PlanChangeRequest.objects.filter(organization=request.user, status=PlanChangeRequest.Status.PENDING).exists():
            return _err('You already have a plan change waiting for review.')
        r = PlanChangeRequest.objects.create(
            organization=request.user, requested_plan=plan, billing_cycle=cycle, note=(request.data.get('note') or '').strip(),
        )
        return Response(request_dict(r), status=status.HTTP_201_CREATED)


class UpgradeRequestReviewView(APIView):
    permission_classes = [IsSuperadmin]
    decision = 'approve'

    def post(self, request, pk):
        r = get_object_or_404(PlanChangeRequest.objects.select_related('organization', 'requested_plan'), pk=pk)
        if r.status != PlanChangeRequest.Status.PENDING:
            return _err(f'This request was already {r.status}.')
        note = (request.data.get('note') or '').strip()
        if self.decision == 'decline' and not note:
            return _err('Add a reason so they know why.')
        if self.decision == 'approve':
            apply_plan(get_subscription(r.organization), r.requested_plan, r.billing_cycle)
            r.status = PlanChangeRequest.Status.APPROVED
        else:
            r.status = PlanChangeRequest.Status.DECLINED
        r.review_note = note
        r.reviewed_by = request.user
        r.reviewed_at = timezone.now()
        r.save()
        return Response(request_dict(r))


class MyBillingView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if request.user.role not in ORG_ROLES:
            return _err('Only event company and vendor accounts have a plan.', status.HTTP_403_FORBIDDEN)
        sub = get_subscription(request.user)
        payments = Payment.objects.filter(organization=request.user).select_related('organization', 'plan', 'recorded_by')
        requests_ = PlanChangeRequest.objects.filter(organization=request.user).select_related('organization', 'requested_plan')[:5]
        return Response({
            'subscription': subscription_dict(sub),
            'plan': plan_dict(sub.plan),
            'payments': [
                {k: v for k, v in payment_dict(p).items() if k not in ('recorded_by_email', 'note')} for p in payments
            ],
            'requests': [request_dict(r) for r in requests_],
            'plans': [plan_dict(p) for p in Plan.objects.filter(is_active=True)],
        })
