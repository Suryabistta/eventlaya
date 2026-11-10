import uuid
import secrets
from datetime import datetime, time, timedelta
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
    show_spots_left = models.BooleanField(
        default=True, help_text='Show attendees how many spots / tickets are left. "Fully booked" and "Sold out" always show.')
    max_tickets_per_order = models.PositiveSmallIntegerField(
        default=10, help_text='How many tickets one person can get in a single registration (1-50)')
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    
    allow_registration = models.BooleanField(default=True)
    registration_deadline = models.DateTimeField(null=True, blank=True)
    is_paid = models.BooleanField(default=False)
    ticket_price = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)

    # How attendees pay for paid tickets (apps.payments; free orders never pay)
    class PaymentMode(models.TextChoices):
        VENUE = 'venue', 'Pay at the venue'
        ONLINE = 'online', 'Online only (Khalti / eSewa)'
        BOTH = 'both', 'Online or at the venue'

    payment_mode = models.CharField(max_length=10, choices=PaymentMode.choices, default=PaymentMode.VENUE)
    online_providers = models.JSONField(default=list, blank=True,
                                        help_text='Online providers this event accepts, e.g. ["khalti", "esewa"]; empty = all available')

    # Public event page content
    class Category(models.TextChoices):
        CONFERENCE = 'conference', 'Conference'
        HACKATHON = 'hackathon', 'Hackathon'
        CONCERT = 'concert', 'Concert'
        FESTIVAL = 'festival', 'Festival'
        WORKSHOP = 'workshop', 'Workshop'
        SPORTS = 'sports', 'Sports'
        WEDDING = 'wedding', 'Wedding'
        MEETUP = 'meetup', 'Meetup'
        OTHER = 'other', 'Other'

    tagline = models.CharField(max_length=160, blank=True)
    # Slug of a platform EventCategory (superadmin-managed); Category holds the original slugs
    category = models.CharField(max_length=40, default=Category.OTHER, db_index=True)
    highlights = models.JSONField(default=list, blank=True, help_text='Short bullet points shown on the event page')
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=30, blank=True)
    map_query = models.CharField(max_length=255, blank=True, help_text='Overrides the location for the map embed')
    # Heading of the people section on the event page: Speakers, Performers, Line-up... (blank = Speakers)
    speakers_label = models.CharField(max_length=40, blank=True)
    terms = models.TextField(blank=True, max_length=10000, help_text='Terms & conditions shown on the event page and agreed to at registration')
    # "Managed by" line next to the organizer's name (e.g. the event agency running it); shown only when switched on
    managed_by = models.CharField(max_length=120, blank=True)
    managed_by_logo = models.CharField(max_length=500, blank=True, help_text='Image URL from /api/uploads/')
    show_managed_by = models.BooleanField(default=False)
    # Wording before the name: Managed by, Co-organized by, In partnership with... (blank = Managed by)
    managed_by_label = models.CharField(max_length=40, blank=True)
    # Set by the superadmin (Admin → Featured events): listed first on the events page, with a badge
    is_featured = models.BooleanField(default=False, db_index=True)

    class PassLayout(models.TextChoices):
        VERTICAL = 'vertical', 'Vertical (phone)'
        LANDSCAPE = 'landscape', 'Landscape'

    # Shape of the pass image, the printed pass and the pass in the app
    ticket_layout = models.CharField(max_length=10, choices=PassLayout.choices, default=PassLayout.VERTICAL)
    # Seat numbers (module `seat_numbers`): attendees see theirs only when this is on; gate staff always do
    show_seat_number = models.BooleanField(default=False)

    class RegistrationMode(models.TextChoices):
        PASS = 'pass', 'With pass (QR ticket)'
        FORM = 'form', 'Registration only (no pass)'

    # FORM: people just fill in the registration form (runs, sign-ups, data collection). Free, one per person,
    # a confirmation email instead of a QR pass, no gate check-in. Registrations still count toward capacity.
    registration_mode = models.CharField(max_length=10, choices=RegistrationMode.choices, default=RegistrationMode.PASS)
    # Text of the main button (Get tickets, Register, Book a spot...); blank = chosen from the registration type
    cta_label = models.CharField(max_length=30, blank=True)

    # Stages (docs/plan-2026-11-event-journeys.md). Each one is switched on or off per event.
    # Tickets / registration stage: off while only applications are open (tickets go on sale later).
    tickets_enabled = models.BooleanField(default=True)
    # Date and venue not decided yet (only while tickets are off); start_date then holds the applications deadline
    date_tba = models.BooleanField(default=False)
    # Applications stage (module `applications`): participants (filmmakers, contestants) apply with their own form;
    # the organizer accepts or declines each one. Applying never creates a ticket or uses capacity.
    applications_enabled = models.BooleanField(default=False)
    application_form = models.ForeignKey(
        'dynamic_forms.Form', null=True, blank=True, on_delete=models.SET_NULL, related_name='application_events',
    )
    applications_close = models.DateTimeField(null=True, blank=True)
    application_cta = models.CharField(max_length=30, blank=True, help_text='Apply button text; blank = "Apply"')

    # Guests (docs/plan-2026-11-guest-management.md)
    # On for every event created in the app (EventSerializer default) and for events that existed before
    phone_required = models.BooleanField(default=False, help_text='Registrations and applications must give a phone number')

    class ArrivalAlerts(models.TextChoices):
        TAGGED = 'tagged', 'Tagged guests only'
        ALL = 'all', 'Every guest'
        OFF = 'off', 'Off'

    # Push to the organizer and staff when a guest is scanned in for the first time (module guest_management)
    arrival_alerts = models.CharField(max_length=10, choices=ArrivalAlerts.choices, default=ArrivalAlerts.TAGGED)
    # Reminder emails the day before and ~2 hours before the start (send_event_reminders, every 10 minutes)
    reminders_enabled = models.BooleanField(default=True)
    reminder_day_sent_at = models.DateTimeField(null=True, blank=True)
    reminder_soon_sent_at = models.DateTimeField(null=True, blank=True)

    @property
    def registration_only(self):
        """No pass or check-in for the audience."""
        return self.registration_mode == self.RegistrationMode.FORM

    def applications_closed_reason(self, now=None):
        """Why participants can't apply right now, or None when applications are open."""
        from django.utils import timezone
        from apps.accounts.modules import module_enabled
        now = now or timezone.now()
        if not self.applications_enabled or not module_enabled('applications'):
            return 'This event is not taking applications.'
        if self.status not in (self.Status.PUBLISHED, self.Status.ONGOING):
            return 'Applications are not open.'
        if self.applications_close and now > self.applications_close:
            return 'Applications have closed.'
        if not (self.application_form and self.application_form.status == 'published'):
            return 'Applications are not open yet.'
        return None

    # Sub-events (module `sub_events`): a child of a main event, one level deep. It has its own form, capacity,
    # tickets and registration switch; organizer and white-label site come from the main event.
    parent = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.CASCADE, related_name='sub_events',
    )

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
        # Tickets held while their buyer pays online count too: they keep the spot until paid or released
        return self.tickets.filter(status__in=[EventTicket.Status.VALID, EventTicket.Status.CHECKED_IN, EventTicket.Status.CHECKED_OUT,
                                               EventTicket.Status.RESERVED]).count()

    @property
    def is_full(self):
        return self.capacity > 0 and self.registered_count >= self.capacity

    @property
    def checked_in_count(self):
        return self.tickets.filter(status=EventTicket.Status.CHECKED_IN).count()

    # ---- Lifecycle (all in the site's local time, Asia/Kathmandu) ----

    @property
    def starts_at(self):
        from django.utils import timezone
        return timezone.make_aware(datetime.combine(self.start_date, self.start_time or time.min))

    @property
    def ends_at(self):
        """End of the event; without an end time, the end of its last day."""
        from django.utils import timezone
        last = self.end_date or self.start_date
        if self.end_time:
            return timezone.make_aware(datetime.combine(last, self.end_time))
        return timezone.make_aware(datetime.combine(last + timedelta(days=1), time.min))

    def phase(self, now=None):
        """'draft', 'cancelled', 'upcoming', 'live' or 'ended' — derived from status and dates.

        Organizers can still force a state with status (ongoing / completed); otherwise the dates decide,
        so events finish on their own without anyone changing them.
        """
        from django.utils import timezone
        now = now or timezone.now()
        if self.status == self.Status.DRAFT:
            return 'draft'
        if self.status == self.Status.CANCELLED:
            return 'cancelled'
        if self.status == self.Status.COMPLETED or now >= self.ends_at:
            return 'ended'
        if self.status == self.Status.ONGOING or now >= self.starts_at:
            return 'live'
        return 'upcoming'

    def registration_closed_reason(self, now=None):
        """Why attendees can't register right now, or None when registration is open."""
        from django.utils import timezone
        now = now or timezone.now()
        phase = self.phase(now)
        if phase == 'draft':
            return 'This event is not accepting registrations.'
        if phase == 'cancelled':
            return 'This event was cancelled by the organizer.'
        if phase == 'ended':
            return 'This event has ended.'
        if not self.tickets_enabled:
            return 'Tickets are not on sale yet.' if self.registration_mode == self.RegistrationMode.PASS else 'Registration is not open yet.'
        if not self.allow_registration:
            return 'Registration is currently closed for this event.'
        if self.registration_deadline and now > self.registration_deadline:
            return 'Registration deadline has passed.'
        return None


class EventAgendaItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='agenda')
    day = models.DateField(null=True, blank=True)
    start_time = models.TimeField()
    end_time = models.TimeField(null=True, blank=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    location = models.CharField(max_length=120, blank=True, help_text='Stage, hall or room')
    speaker_names = models.CharField(max_length=255, blank=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'day', 'start_time']

    def __str__(self):
        return f"{self.title} ({self.event.title})"


class EventSpeaker(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='speakers')
    name = models.CharField(max_length=120)
    role = models.CharField(max_length=120, blank=True)
    organization = models.CharField(max_length=120, blank=True)
    photo_url = models.CharField(max_length=500, blank=True)
    bio = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'name']

    def __str__(self):
        return self.name


class EventFAQ(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='faqs')
    question = models.CharField(max_length=255)
    answer = models.TextField()
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order']

    def __str__(self):
        return self.question


class EventTicket(models.Model):
    class Status(models.TextChoices):
        VALID = 'valid', 'Valid / Registered'
        CHECKED_IN = 'checked_in', 'Checked In'
        CHECKED_OUT = 'checked_out', 'Checked Out'
        CANCELLED = 'cancelled', 'Cancelled'
        # Held while the buyer pays online: not valid at the gate; cancelled if the payment fails or expires
        RESERVED = 'reserved', 'Reserved (awaiting online payment)'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='tickets')
    ticket_number = models.CharField(max_length=64, unique=True, db_index=True)
    qr_token = models.CharField(max_length=64, unique=True, db_index=True)
    
    attendee_name = models.CharField(max_length=255)
    attendee_email = models.EmailField(db_index=True)
    attendee_phone = models.CharField(max_length=30, blank=True)
    # The account that owns this ticket: set when registering while signed in (same email), or when the
    # account's email is verified. Null for guest registrations; kept (nulled) when the account is deleted.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='tickets',
    )

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.VALID)
    # Ticket type chosen at registration; the name and price are kept even if the type is later edited.
    ticket_type = models.ForeignKey('TicketType', null=True, blank=True, on_delete=models.SET_NULL, related_name='tickets')
    ticket_type_name = models.CharField(max_length=80, blank=True)
    promo_code = models.ForeignKey('PromoCode', null=True, blank=True, on_delete=models.SET_NULL, related_name='tickets')
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0, help_text='Amount due at the venue')
    # Several tickets bought together share an order; guest_number 0 is the buyer, 1.. are their guests.
    order = models.ForeignKey('TicketOrder', null=True, blank=True, on_delete=models.SET_NULL, related_name='tickets')
    guest_number = models.PositiveSmallIntegerField(default=0)
    seat_number = models.CharField(max_length=20, blank=True)
    # Guest management (module guest_management): tags like VIP / Press and a note only organizers and staff see
    guest_tags = models.JSONField(default=list, blank=True)
    host_note = models.TextField(blank=True)
    # Printed tickets for physical sales (TicketBatch); null for online registrations
    batch = models.ForeignKey('TicketBatch', null=True, blank=True, on_delete=models.SET_NULL, related_name='tickets')
    is_attended = models.BooleanField(default=False)
    first_check_in = models.DateTimeField(null=True, blank=True)
    last_activity = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['event', 'attendee_email'])]

    def __str__(self):
        return f"{self.ticket_number} - {self.attendee_name}"

    @classmethod
    def generate_ticket(cls, event, name, email, phone='', **extra):
        """Helper to create a ticket with unique serial code and secure token"""
        count = event.tickets.count() + 1
        code_prefix = str(event.id)[:6].upper()
        ticket_number = f"TKT-{code_prefix}-{str(count).zfill(4)}"
        while cls.objects.filter(ticket_number=ticket_number).exists():
            count += 1
            ticket_number = f"TKT-{code_prefix}-{str(count).zfill(4)}"
        qr_token = secrets.token_hex(20)
        while cls.objects.filter(qr_token=qr_token).exists():
            qr_token = secrets.token_hex(20)
        return cls.objects.create(
            event=event,
            ticket_number=ticket_number,
            qr_token=qr_token,
            attendee_name=name,
            attendee_email=email,
            attendee_phone=phone,
            **extra,
        )


class EventGate(models.Model):
    """A physical gate at an event venue, managed by the organizer."""

    class Kind(models.TextChoices):
        ENTRY = 'entry', 'Entry only'
        EXIT = 'exit', 'Exit only'
        BOTH = 'both', 'Entry and exit'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='gates')
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.BOTH)
    is_vip = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'created_at']
        unique_together = [['event', 'name']]

    def __str__(self):
        return f"{self.name} ({self.event.title})"

    def allows(self, scan_type):
        if self.kind == self.Kind.ENTRY:
            return scan_type == 'gate_in'
        if self.kind == self.Kind.EXIT:
            return scan_type == 'gate_out'
        return True


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
    gate = models.ForeignKey(EventGate, null=True, blank=True, on_delete=models.SET_NULL, related_name='scan_logs')
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
    gate = models.ForeignKey(EventGate, null=True, blank=True, on_delete=models.SET_NULL, related_name='assignments')
    # Kept in sync with gate.name for older clients (the Flutter app reads it)
    gate_name = models.CharField(max_length=100, default='Main Gate')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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
    created_at = models.DateTimeField(auto_now_add=True)

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
    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='owned_tasks',
        help_text='Owner of the task (the organizer workspace it belongs to).'
    )
    # Optional: a task can be general (not tied to any event)
    event = models.ForeignKey(Event, null=True, blank=True, on_delete=models.CASCADE, related_name='tasks')
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
    assignee_email = models.EmailField(blank=True)
    due_date = models.DateField(null=True, blank=True)
    due_time = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-priority', 'status', 'due_time', '-created_at']

    def __str__(self):
        where = self.event.title if self.event_id else 'General'
        return f"[{self.get_status_display()}] {self.title} ({where})"



class TicketType(models.Model):
    """A kind of ticket for an event: General, Early Bird, Student, VIP, Free entry..."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='ticket_types')
    name = models.CharField(max_length=80)
    description = models.CharField(max_length=255, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    quantity = models.PositiveIntegerField(null=True, blank=True, help_text='Blank means no limit (event capacity still applies)')
    sales_start = models.DateTimeField(null=True, blank=True)
    sales_end = models.DateTimeField(null=True, blank=True)
    gate_note = models.CharField(max_length=120, blank=True, help_text='Shown to gate staff on scan, e.g. "Check student ID"')
    is_hidden = models.BooleanField(default=False, help_text='Only available with a promo code that unlocks it')
    online_only = models.BooleanField(default=False, help_text='Must be paid online (no pay at the venue)')
    is_active = models.BooleanField(default=True)
    allowed_gates = models.ManyToManyField(EventGate, blank=True, related_name='ticket_types',
                                           help_text='Empty means every gate')
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'created_at']

    def __str__(self):
        return f"{self.name} ({self.event.title})"

    @property
    def sold_count(self):
        return self.tickets.exclude(status=EventTicket.Status.CANCELLED).count()

    def availability(self, now=None, sold=None):
        """'on_sale', 'not_started', 'ended', 'sold_out' or 'inactive'."""
        from django.utils import timezone
        now = now or timezone.now()
        if not self.is_active:
            return 'inactive'
        if self.sales_start and now < self.sales_start:
            return 'not_started'
        if self.sales_end and now > self.sales_end:
            return 'ended'
        sold = self.sold_count if sold is None else sold
        if self.quantity is not None and sold >= self.quantity:
            return 'sold_out'
        return 'on_sale'


class PromoCode(models.Model):
    """Discount and/or unlock code for an event's ticket types."""

    class DiscountType(models.TextChoices):
        PERCENT = 'percent', 'Percent off'
        AMOUNT = 'amount', 'Amount off'
        NONE = 'none', 'No discount (unlock only)'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='promo_codes')
    code = models.CharField(max_length=40)
    discount_type = models.CharField(max_length=10, choices=DiscountType.choices, default=DiscountType.PERCENT)
    discount_value = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    ticket_types = models.ManyToManyField(TicketType, blank=True, related_name='promo_codes',
                                          help_text='Empty means every ticket type. Hidden types listed here are unlocked by the code.')
    max_uses = models.PositiveIntegerField(null=True, blank=True)
    valid_from = models.DateTimeField(null=True, blank=True)
    valid_until = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        unique_together = [['event', 'code']]

    def __str__(self):
        return f"{self.code} ({self.event.title})"

    def save(self, *args, **kwargs):
        self.code = (self.code or '').strip().upper()
        super().save(*args, **kwargs)

    @property
    def used_count(self):
        """Each order counts once, however many tickets it holds (older tickets without an order count singly)."""
        live = self.tickets.exclude(status=EventTicket.Status.CANCELLED)
        return live.filter(order__isnull=False).values('order').distinct().count() + live.filter(order__isnull=True).count()


class TicketOrder(models.Model):
    """One registration that may hold several tickets (the buyer's plus guests'). Paid online or at the venue."""

    class PaymentMethod(models.TextChoices):
        VENUE = 'venue', 'Pay at the venue'
        ONLINE = 'online', 'Online'
        FREE = 'free', 'Free'

    class PaymentStatus(models.TextChoices):
        FREE = 'free', 'Free'
        DUE = 'due', 'To pay at the venue'
        PENDING = 'pending', 'Awaiting online payment'
        PAID = 'paid', 'Paid'
        FAILED = 'failed', 'Not paid (released)'
        REFUNDED = 'refunded', 'Refunded'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='orders')
    reference = models.CharField(max_length=16, unique=True, db_index=True)
    buyer_name = models.CharField(max_length=255)
    buyer_email = models.EmailField(db_index=True)
    buyer_phone = models.CharField(max_length=30, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='ticket_orders')
    promo_code = models.ForeignKey(PromoCode, null=True, blank=True, on_delete=models.SET_NULL, related_name='orders')
    ticket_count = models.PositiveSmallIntegerField(default=1)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0, help_text='Amount for the whole order')
    payment_method = models.CharField(max_length=10, choices=PaymentMethod.choices, default=PaymentMethod.VENUE)
    payment_status = models.CharField(max_length=10, choices=PaymentStatus.choices, default=PaymentStatus.DUE, db_index=True)
    paid_via = models.CharField(max_length=12, blank=True, help_text='khalti / esewa / test / venue')
    paid_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    payment_reference = models.CharField(max_length=100, blank=True, help_text='Provider transaction id')
    payment_intent = models.ForeignKey('payments.PaymentIntent', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    reserved_until = models.DateTimeField(null=True, blank=True, help_text='Online orders: tickets are held until then')
    needs_attention = models.CharField(max_length=255, blank=True, help_text='Something the organizer must sort out, e.g. a refund')
    refunded_at = models.DateTimeField(null=True, blank=True)
    payment_notes = models.TextField(blank=True, help_text='Audit trail of manual payment changes')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.reference} ({self.ticket_count} × {self.event.title})"

    def add_note(self, text, user=None):
        from django.utils import timezone
        who = f' by {user.email}' if user is not None and getattr(user, 'email', '') else ''
        line = f"{timezone.localtime():%Y-%m-%d %H:%M} · {text}{who}"
        self.payment_notes = f'{self.payment_notes}\n{line}'.strip()

    @property
    def payment_label(self):
        """One line for passes, emails and lists, e.g. 'Paid online · Khalti · ref 4H7Ah…'."""
        S = self.PaymentStatus
        amount = f'Rs {self.total:,.0f}' if self.total == self.total.to_integral_value() else f'Rs {self.total:,.2f}'
        if self.payment_status == S.FREE:
            return 'Free'
        if self.payment_status == S.DUE:
            return f'Pay {amount} at the venue'
        if self.payment_status == S.PENDING:
            return f'Awaiting online payment of {amount}'
        if self.payment_status == S.FAILED:
            return 'Online payment not completed'
        if self.payment_status == S.REFUNDED:
            return f'Refunded ({amount})'
        if self.paid_via == 'venue':
            return f'Paid {amount} at the venue'
        provider = {'khalti': 'Khalti', 'esewa': 'eSewa', 'test': 'Test payment'}.get(self.paid_via, self.paid_via or 'online')
        ref = f' · ref {self.payment_reference}' if self.payment_reference else ''
        return f'Paid online · {provider}{ref}'

    def payment_info(self):
        return {
            'method': self.payment_method,
            'status': self.payment_status,
            'provider': self.paid_via or None,
            'reference': self.payment_reference or None,
            'amount': str(self.total),
            'paid_at': self.paid_at,
            'reserved_until': self.reserved_until if self.payment_status == self.PaymentStatus.PENDING else None,
            'label': self.payment_label,
        }

    @staticmethod
    def new_reference():
        alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
        while True:
            ref = 'ORD-' + ''.join(secrets.choice(alphabet) for _ in range(6))
            if not TicketOrder.objects.filter(reference=ref).exists():
                return ref


class TicketBatch(models.Model):
    """Printed tickets for physical sales (module `offline_tickets`): a bulk run of real tickets with QR codes,
    printed on the organizer's design and sold at shops, counters or the door. They scan like any pass."""

    class Template(models.TextChoices):
        CLASSIC = 'classic', 'Classic'
        BOLD = 'bold', 'Bold'
        MINIMAL = 'minimal', 'Minimal'
        CUSTOM = 'custom', 'Own artwork'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='ticket_batches')
    ticket_type = models.ForeignKey('TicketType', null=True, blank=True, on_delete=models.SET_NULL, related_name='batches')
    name = models.CharField(max_length=120, help_text='Where they are sold, e.g. "Bhatbhateni Dharan" or "Door"')
    quantity = models.PositiveIntegerField()
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0, help_text='Printed price, paid at the point of sale')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')

    # Design
    layout = models.CharField(max_length=10, choices=Event.PassLayout.choices, default=Event.PassLayout.LANDSCAPE)
    template = models.CharField(max_length=10, choices=Template.choices, default=Template.CLASSIC)
    color = models.CharField(max_length=7, default='#C2215A', help_text='Accent colour for the ready-made designs')
    background = models.CharField(max_length=500, blank=True, help_text='Own artwork (upload URL) for the custom design')
    # QR placement on own artwork, as % of the ticket: centre x / y and width
    qr_x = models.PositiveSmallIntegerField(default=80)
    qr_y = models.PositiveSmallIntegerField(default=50)
    qr_size = models.PositiveSmallIntegerField(default=28)

    voided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} × {self.quantity}'


class GuestMessage(models.Model):
    """A message the organizer sent to guests (email, plus app push to guests with the app). Module guest_management."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='guest_messages')
    subject = models.CharField(max_length=150)
    body = models.TextField(max_length=3000)
    # all | not_arrived | inside | tag:<tag> | type:<ticket type id>
    audience = models.CharField(max_length=80, default='all')
    recipients = models.PositiveIntegerField(default=0)
    sent_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
