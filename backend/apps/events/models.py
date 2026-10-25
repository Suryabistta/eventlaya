import uuid
import secrets
from django.db import models
from django.conf import settings

class Event(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'
        ONGOING = 'ongoing', 'Ongoing'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='organized_events'
    )
    title = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255, unique=True)
    description = models.TextField(blank=True)
    banner = models.ImageField(upload_to='events/banners/', null=True, blank=True)
    location = models.CharField(max_length=255, help_text="Venue name, street or city")
    
    start_date = models.DateField()
    start_time = models.TimeField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)

    capacity = models.PositiveIntegerField(default=0, help_text="0 means unlimited capacity")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    
    allow_registration = models.BooleanField(default=True)
    registration_deadline = models.DateTimeField(null=True, blank=True)
    is_paid = models.BooleanField(default=False)
    ticket_price = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)

    registration_form = models.ForeignKey(
        'dynamic_forms.Form',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='assigned_events'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-start_date', '-created_at']

    def __str__(self):
        return self.title

    @property
    def registered_count(self):
        return self.tickets.filter(status__in=[EventTicket.Status.VALID, EventTicket.Status.CHECKED_IN, EventTicket.Status.CHECKED_OUT]).count()

    @property
    def checked_in_count(self):
        return self.tickets.filter(status=EventTicket.Status.CHECKED_IN).count()


class EventTicket(models.Model):
    class Status(models.TextChoices):
        VALID = 'valid', 'Valid / Registered'
        CHECKED_IN = 'checked_in', 'Checked In'
        CHECKED_OUT = 'checked_out', 'Checked Out'
        CANCELLED = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='tickets')
    ticket_number = models.CharField(max_length=64, unique=True, db_index=True)
    qr_token = models.CharField(max_length=64, unique=True, db_index=True)
    
    attendee_name = models.CharField(max_length=255)
    attendee_email = models.EmailField(db_index=True)
    attendee_phone = models.CharField(max_length=30, blank=True)
    
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.VALID)
    is_attended = models.BooleanField(default=False)
    first_check_in = models.DateTimeField(null=True, blank=True)
    last_activity = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        unique_together = [['event', 'attendee_email']]

    def __str__(self):
        return f"{self.ticket_number} - {self.attendee_name}"

    @classmethod
    def generate_ticket(cls, event, name, email, phone=''):
        """Helper to create a ticket with unique serial code and secure token"""
        count = event.tickets.count() + 1
        code_prefix = str(event.id)[:6].upper()
        ticket_number = f"TKT-{code_prefix}-{str(count).zfill(4)}"
        qr_token = secrets.token_hex(20)
        return cls.objects.create(
            event=event,
            ticket_number=ticket_number,
            qr_token=qr_token,
            attendee_name=name,
            attendee_email=email,
            attendee_phone=phone,
        )


class GateScanLog(models.Model):
    class ScanType(models.TextChoices):
        GATE_IN = 'gate_in', 'Gate In'
        GATE_OUT = 'gate_out', 'Gate Out'

    class ScanResult(models.TextChoices):
        SUCCESS = 'success', 'Success'
        DUPLICATE = 'duplicate', 'Already In / Duplicate'
        NOT_IN = 'not_in', 'Cannot Out / Not Checked In'
        INVALID = 'invalid', 'Invalid Ticket Token'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='scan_logs')
    ticket = models.ForeignKey(EventTicket, on_delete=models.CASCADE, related_name='scan_logs')
    scan_type = models.CharField(max_length=20, choices=ScanType.choices)
    result = models.CharField(max_length=20, choices=ScanResult.choices, default=ScanResult.SUCCESS)
    gate_name = models.CharField(max_length=100, default='Main Gate')
    scanned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='scans_performed'
    )
    device_info = models.CharField(max_length=255, blank=True)
    scanned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-scanned_at']


class StaffGateAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    staff = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gate_assignments')
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='staff_assignments')
    gate_name = models.CharField(max_length=100, default='Main Gate')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['staff', 'event']

    def __str__(self):
        return f"{self.staff.email} → {self.event.title} [{self.gate_name}]"


class EventFunding(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.OneToOneField(Event, on_delete=models.CASCADE, related_name='funding')
    target_budget = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)

    # Incomes / Funding sources
    sponsorship_raised = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    ticket_sales_revenue = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    grants_donations = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)

    # Expenses breakdown
    expense_venue = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    expense_catering = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    expense_production = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    expense_marketing = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    expense_prizes_gifts = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    expense_logistics = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)

    updated_at = models.DateTimeField(auto_now=True)

    @property
    def total_funding(self):
        return self.sponsorship_raised + self.ticket_sales_revenue + self.grants_donations

    @property
    def total_expenses(self):
        return (
            self.expense_venue + self.expense_catering + self.expense_production +
            self.expense_marketing + self.expense_prizes_gifts + self.expense_logistics
        )

    @property
    def net_balance(self):
        return self.total_funding - self.total_expenses

    def __str__(self):
        return f"Funding for {self.event.title} (Raised: {self.total_funding})"


class EventTask(models.Model):
    class Status(models.TextChoices):
        TODO = 'todo', 'To Do'
        IN_PROGRESS = 'in_progress', 'In Progress'
        COMPLETED = 'completed', 'Completed'

    class Priority(models.TextChoices):
        LOW = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH = 'high', 'High'
        URGENT = 'urgent', 'Urgent'

    class Category(models.TextChoices):
        STAGE = 'stage', 'Stage & Sound'
        GATE = 'gate', 'Gate & Security'
        HOSPITALITY = 'hospitality', 'VIP & Guest Hospitality'
        MARKETING = 'marketing', 'Media & Coverage'
        CATERING = 'catering', 'Food & Refreshments'
        TECH = 'tech', 'Technical & Registration'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='tasks')
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='assigned_event_tasks'
    )
    assigned_name = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TODO)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.MEDIUM)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.TECH)
    due_time = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-priority', 'status', 'due_time', '-created_at']

    def __str__(self):
        return f"[{self.get_status_display()}] {self.title} ({self.event.title})"

