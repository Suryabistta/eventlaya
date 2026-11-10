"""Subscription helpers shared by the billing views, segments and sample data."""
import calendar
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone

from .models import Plan, Subscription

User = get_user_model()
ORG_ROLES = ('organizer', 'vendor')
TRIAL_DAYS = 14


def add_months(dt, months):
    month = dt.month - 1 + months
    year = dt.year + month // 12
    month = month % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def free_plan():
    return Plan.objects.get(code=Plan.Code.FREE)


def ensure_subscriptions():
    """Every organizer/vendor without a subscription is on Free; create those rows lazily."""
    missing = User.objects.filter(role__in=ORG_ROLES, subscription__isnull=True)
    if missing.exists():
        plan = free_plan()
        Subscription.objects.bulk_create(
            [Subscription(organization=u, plan=plan, status=Subscription.Status.ACTIVE) for u in missing],
            ignore_conflicts=True,
        )


def get_subscription(user):
    sub = Subscription.objects.select_related('plan').filter(organization=user).first()
    if sub is None:
        # Two first requests at once (plan card and SMS card) must not both create it
        sub, _ = Subscription.objects.select_related('plan').get_or_create(
            organization=user, defaults={'plan': free_plan(), 'status': Subscription.Status.ACTIVE})
    return refresh_status(sub)


def refresh_status(sub):
    """Lapsed periods: paid active → past due, trial → expired."""
    now = timezone.now()
    if sub.current_period_end and sub.current_period_end < now and sub.plan.code != Plan.Code.FREE:
        new = None
        if sub.status == Subscription.Status.ACTIVE:
            new = Subscription.Status.PAST_DUE
        elif sub.status == Subscription.Status.TRIAL:
            new = Subscription.Status.EXPIRED
        if new:
            sub.status = new
            sub.save(update_fields=['status', 'updated_at'])
    return sub


def refresh_all_statuses():
    now = timezone.now()
    lapsed = Subscription.objects.filter(current_period_end__lt=now).exclude(plan__code=Plan.Code.FREE)
    lapsed.filter(status=Subscription.Status.ACTIVE).update(status=Subscription.Status.PAST_DUE)
    lapsed.filter(status=Subscription.Status.TRIAL).update(status=Subscription.Status.EXPIRED)


def apply_plan(sub, plan, cycle):
    """Switch plan without a payment. A new paid plan starts a 14-day trial; the same plan keeps its paid period."""
    now = timezone.now()
    same_plan = sub.plan_id == plan.id
    sub.plan = plan
    sub.billing_cycle = cycle
    if plan.code == Plan.Code.FREE:
        sub.status = Subscription.Status.ACTIVE
        sub.current_period_start = None
        sub.current_period_end = None
    elif not (same_plan and sub.current_period_end and sub.current_period_end > now and sub.status == Subscription.Status.ACTIVE):
        # A different paid plan isn't paid for yet: trial until a payment is recorded
        sub.status = Subscription.Status.TRIAL
        sub.current_period_start = now
        sub.current_period_end = now + timedelta(days=TRIAL_DAYS)
    sub.auto_renew = True
    sub.save()
    return sub


def extend(sub, plan, cycle, months):
    """A recorded payment extends the period from max(now, current end)."""
    now = timezone.now()
    switching = sub.plan_id != plan.id
    base = now
    if not switching and sub.status == Subscription.Status.ACTIVE and sub.current_period_end and sub.current_period_end > now:
        base = sub.current_period_end
    if switching or not sub.current_period_start or base == now:
        sub.current_period_start = now
    sub.plan = plan
    sub.billing_cycle = cycle
    sub.current_period_end = add_months(base, months)
    sub.status = Subscription.Status.ACTIVE
    sub.auto_renew = True
    sub.save()
    return sub


def days_left(sub):
    if not sub.current_period_end:
        return None
    return (sub.current_period_end - timezone.now()).days
