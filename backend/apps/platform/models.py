import uuid
from django.conf import settings
from django.db import models


class WhiteLabelRequest(models.Model):
    """An organizer's request for white-label features. Only a platform admin can approve it."""

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'
        REVOKED = 'revoked', 'Revoked'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='white_label_requests'
    )
    requested_domain = models.CharField(max_length=255, blank=True)
    brand_name = models.CharField(max_length=255)
    logo_url = models.CharField(max_length=500, blank=True)
    primary_color = models.CharField(max_length=20, default='#C2215A')
    accent_color = models.CharField(max_length=20, default='#E39400')
    remove_watermark = models.BooleanField(default=False)
    note = models.TextField(blank=True)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    review_note = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.brand_name} ({self.organizer.email}) [{self.status}]"

    @classmethod
    def approved_for(cls, user):
        """The organizer's effective white-label: their most recently approved request."""
        return (
            cls.objects.filter(organizer=user, status=cls.Status.APPROVED)
            .order_by('-reviewed_at', '-created_at')
            .first()
        )


# ---------------------------------------------------------------------------
# Subscription billing ("recharges"): plans, subscriptions, recorded payments
# ---------------------------------------------------------------------------

class Plan(models.Model):
    class Code(models.TextChoices):
        FREE = 'free', 'Free'
        EVENT_PRO = 'event_pro', 'Event Pro'
        BUSINESS = 'business', 'Business'
        ENTERPRISE = 'enterprise', 'Enterprise'

    code = models.CharField(max_length=20, choices=Code.choices, unique=True)
    name = models.CharField(max_length=60)
    monthly_price = models.PositiveIntegerField(null=True, blank=True, help_text='NPR per month. Empty = custom quote.')
    yearly_price = models.PositiveIntegerField(null=True, blank=True, help_text='NPR per year. Empty = custom quote.')
    attendee_limit = models.PositiveIntegerField(null=True, blank=True, help_text='Per event. Empty = unlimited.')
    features = models.JSONField(default=list, blank=True)
    is_active = models.BooleanField(default=True)
    order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order']

    def __str__(self):
        return self.name

    @property
    def is_paid(self):
        return self.code != self.Code.FREE

    def monthly_value(self, cycle):
        """Normalised monthly revenue for MRR."""
        if cycle == Subscription.Cycle.YEARLY and self.yearly_price is not None:
            return self.yearly_price / 12
        return self.monthly_price or 0

    def price_for(self, cycle, months=1):
        if cycle == Subscription.Cycle.YEARLY and self.yearly_price is not None:
            return round(self.yearly_price * months / 12)
        return (self.monthly_price or 0) * months


class Subscription(models.Model):
    class Status(models.TextChoices):
        TRIAL = 'trial', 'Trial'
        ACTIVE = 'active', 'Active'
        PAST_DUE = 'past_due', 'Past due'
        EXPIRED = 'expired', 'Expired'
        CANCELLED = 'cancelled', 'Cancelled'

    class Cycle(models.TextChoices):
        MONTHLY = 'monthly', 'Monthly'
        YEARLY = 'yearly', 'Yearly'

    organization = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='subscription')
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name='subscriptions')
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    billing_cycle = models.CharField(max_length=10, choices=Cycle.choices, default=Cycle.MONTHLY)
    current_period_start = models.DateTimeField(null=True, blank=True)
    current_period_end = models.DateTimeField(null=True, blank=True, db_index=True)
    auto_renew = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.organization.email}: {self.plan.name} [{self.status}]'


class Payment(models.Model):
    class Method(models.TextChoices):
        ESEWA = 'esewa', 'eSewa'
        KHALTI = 'khalti', 'Khalti'
        FONEPAY = 'fonepay', 'Fonepay'
        BANK = 'bank', 'Bank transfer'
        CASH = 'cash', 'Cash'
        OTHER = 'other', 'Other'

    class Status(models.TextChoices):
        RECORDED = 'recorded', 'Recorded'
        REFUNDED = 'refunded', 'Refunded'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='payments')
    subscription = models.ForeignKey(Subscription, on_delete=models.SET_NULL, null=True, blank=True, related_name='payments')
    plan = models.ForeignKey(Plan, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    billing_cycle = models.CharField(max_length=10, choices=Subscription.Cycle.choices, default=Subscription.Cycle.MONTHLY)
    amount = models.PositiveIntegerField(help_text='NPR')
    method = models.CharField(max_length=20, choices=Method.choices)
    reference = models.CharField(max_length=120, blank=True)
    months_covered = models.PositiveSmallIntegerField(default=1)
    paid_at = models.DateTimeField(db_index=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    note = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.RECORDED, db_index=True)
    refunded_at = models.DateTimeField(null=True, blank=True)
    refund_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-paid_at']

    def __str__(self):
        return f'NPR {self.amount} from {self.organization.email} ({self.method})'


class PlanChangeRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        DECLINED = 'declined', 'Declined'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='plan_change_requests')
    requested_plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name='+')
    billing_cycle = models.CharField(max_length=10, choices=Subscription.Cycle.choices, default=Subscription.Cycle.MONTHLY)
    note = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    review_note = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.organization.email} → {self.requested_plan.name} [{self.status}]'


class City(models.Model):
    """A city offered in pickers and filters (events, vendors, venues, sign-up). Managed by the superadmin."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    province = models.CharField(max_length=100, blank=True)
    order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'name']
        verbose_name_plural = 'Cities'

    def __str__(self):
        return self.name


class AdminAction(models.Model):
    """Audit trail of sensitive platform-admin actions on an account (create, password reset, verify)."""

    class Kind(models.TextChoices):
        CREATED = 'created', 'Created the account'
        PASSWORD_EMAIL = 'password_email', 'Sent a password reset email'
        PASSWORD_TEMPORARY = 'password_temporary', 'Set a temporary password'
        VERIFIED = 'verified', 'Verified'
        UNVERIFIED = 'unverified', 'Removed verification'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    target = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='admin_actions')
    kind = models.CharField(max_length=30, choices=Kind.choices)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.actor} {self.kind} {self.target}'


class Banner(models.Model):
    """A slide in the sliding banner at the top of a page (module `banners`). Managed by the superadmin."""

    class Placement(models.TextChoices):
        MARKETPLACE = 'marketplace', 'Marketplace'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    placement = models.CharField(max_length=20, choices=Placement.choices, default=Placement.MARKETPLACE, db_index=True)
    image = models.CharField(max_length=500, help_text='Image URL from /api/uploads/ (wide, about 4:1)')
    title = models.CharField(max_length=120, blank=True, help_text='Alt text, and a caption when set')
    link = models.CharField(max_length=500, blank=True, help_text='Optional: where a tap goes (/marketplace/... or https://...)')
    order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['placement', 'order', '-created_at']

    def __str__(self):
        return self.title or self.image


class SiteBranding(models.Model):
    """Eventlaya's own logo on the landing pages and the app (one row, superadmin edits it). Blank = the built-in logo."""

    logo = models.CharField(max_length=500, blank=True, help_text='Image URL from /api/uploads/ (wide, transparent PNG works best)')
    logo_white = models.CharField(max_length=500, blank=True, help_text='Optional light version for dark backgrounds')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'Site branding'

    @classmethod
    def load(cls):
        return cls.objects.get_or_create(pk=1)[0]
