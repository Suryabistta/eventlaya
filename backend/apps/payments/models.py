"""Online payments (Khalti, eSewa): one PaymentIntent per thing someone pays for.

The platform collects with its own merchant accounts; organizers are paid out manually (Payout).
Apps plug in through apps.payments.registry (see docs/payments.md). Not to be confused with
apps.platform.models.Payment, which records subscription payments an admin entered by hand.
"""
import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models


class Provider(models.TextChoices):
    KHALTI = 'khalti', 'Khalti'
    ESEWA = 'esewa', 'eSewa'
    TEST = 'test', 'Test (local only)'


class PaymentIntent(models.Model):
    class Status(models.TextChoices):
        CREATED = 'created', 'Created'            # made, no checkout started yet
        PENDING = 'pending', 'Pending'            # sent to the provider, waiting for the payer / provider
        PAID = 'paid', 'Paid'
        FAILED = 'failed', 'Failed'
        CANCELLED = 'cancelled', 'Cancelled'      # payer cancelled (or replaced by a new attempt)
        EXPIRED = 'expired', 'Expired'            # not paid in time
        REFUNDED = 'refunded', 'Refunded'         # recorded as refunded (money returned by hand / provider)

    OPEN = (Status.CREATED, Status.PENDING)
    CLOSED_UNPAID = (Status.FAILED, Status.CANCELLED, Status.EXPIRED)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    purpose = models.CharField(max_length=40, db_index=True, help_text="Registered purpose, e.g. 'ticket_order', 'vote_pack'")
    reference = models.CharField(max_length=64, blank=True, db_index=True,
                                 help_text="The purpose's own object id (e.g. the TicketOrder id)")
    description = models.CharField(max_length=200, help_text='Shown to the payer and in reports')
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.CREATED, db_index=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2, help_text='NPR, paisa precision')
    currency = models.CharField(max_length=3, default='NPR')

    provider = models.CharField(max_length=12, choices=Provider.choices, blank=True)
    provider_ref = models.CharField(max_length=100, blank=True, db_index=True,
                                    help_text='Khalti pidx / eSewa transaction_uuid')
    provider_txn_id = models.CharField(max_length=100, blank=True,
                                       help_text='Khalti transaction_id / eSewa ref_id (transaction code)')
    provider_fee = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    checkout = models.JSONField(default=dict, blank=True, help_text='Last checkout (redirect URL or form fields), re-used on reload')

    payer_name = models.CharField(max_length=255, blank=True)
    payer_email = models.EmailField(blank=True)
    payer_phone = models.CharField(max_length=30, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                             related_name='payment_intents')
    organizer = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name='received_payments', help_text='Who the money is for (payouts, reports)')
    event = models.ForeignKey('events.Event', null=True, blank=True, on_delete=models.SET_NULL,
                              related_name='payment_intents', help_text='Event the payment belongs to, for reports')
    metadata = models.JSONField(default=dict, blank=True)
    return_url = models.CharField(max_length=500, blank=True, help_text='Frontend page the payer comes back to')

    # Snapshot of the platform fee when the payment succeeded (reporting only; nothing is deducted automatically)
    platform_fee_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0'))
    platform_fee = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))

    failure_reason = models.CharField(max_length=255, blank=True)
    refund_note = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    refunded_at = models.DateTimeField(null=True, blank=True)
    last_checked_at = models.DateTimeField(null=True, blank=True)
    # Set when the purpose's on_paid handler ran (exactly once, under a row lock)
    fulfilled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['purpose', 'reference']), models.Index(fields=['organizer', 'status'])]

    def __str__(self):
        return f'{self.description} · Rs {self.amount} · {self.provider or "-"} · {self.status}'

    @property
    def net_amount(self):
        return self.amount - self.platform_fee

    @property
    def is_open(self):
        return self.status in self.OPEN


class PaymentLog(models.Model):
    """Audit trail: every state change and every provider response (never secrets)."""

    id = models.BigAutoField(primary_key=True)
    intent = models.ForeignKey(PaymentIntent, on_delete=models.CASCADE, related_name='logs')
    kind = models.CharField(max_length=30)
    message = models.CharField(max_length=255, blank=True)
    data = models.JSONField(default=dict, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']

    def __str__(self):
        return f'{self.created_at:%Y-%m-%d %H:%M} {self.kind} {self.message}'


class PaymentSettings(models.Model):
    """Platform-wide settings the superadmin edits (one row)."""

    platform_fee_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('0'),
        help_text='Recorded on each online payment for reporting (what Eventlaya keeps before paying out)')
    reservation_minutes = models.PositiveSmallIntegerField(
        default=15, help_text='How long tickets are held while the buyer pays online')
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        verbose_name_plural = 'Payment settings'

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Payout(models.Model):
    """Money the platform sent to an organizer by hand (bank transfer, eSewa, ...)."""

    class Method(models.TextChoices):
        BANK = 'bank', 'Bank transfer'
        ESEWA = 'esewa', 'eSewa'
        KHALTI = 'khalti', 'Khalti'
        CASH = 'cash', 'Cash'
        OTHER = 'other', 'Other'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organizer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='payouts')
    event = models.ForeignKey('events.Event', null=True, blank=True, on_delete=models.SET_NULL, related_name='payouts')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=10, choices=Method.choices, default=Method.BANK)
    reference = models.CharField(max_length=120, blank=True)
    note = models.TextField(blank=True)
    paid_on = models.DateField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-paid_on', '-created_at']

    def __str__(self):
        return f'Rs {self.amount} to {self.organizer} on {self.paid_on}'
