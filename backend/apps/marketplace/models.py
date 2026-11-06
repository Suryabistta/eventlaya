import uuid
from django.db import models
from django.conf import settings

class ListingStatus(models.TextChoices):
    PENDING = 'pending', 'Waiting for review'
    APPROVED = 'approved', 'Live'
    REJECTED = 'rejected', 'Changes needed'


class VendorCategory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    icon = models.CharField(max_length=50, blank=True, help_text="Lucide icon name")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Vendor Categories"
        ordering = ['name']

    def __str__(self):
        return self.name


class VendorProfile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='vendor_profiles'
    )
    business_name = models.CharField(max_length=255)
    category = models.ForeignKey(VendorCategory, on_delete=models.CASCADE, related_name='vendors')
    city = models.CharField(max_length=100, default='Itahari')
    address = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=30)
    email = models.EmailField(blank=True)
    description = models.TextField()
    starting_price = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    portfolio_images = models.JSONField(default=list, blank=True)
    is_verified = models.BooleanField(default=False)
    is_featured = models.BooleanField(default=False)
    rating = models.DecimalField(max_digits=3, decimal_places=2, default=5.00)
    listing_status = models.CharField(max_length=20, choices=ListingStatus.choices, default=ListingStatus.PENDING, db_index=True)
    review_note = models.TextField(blank=True)
    # Owner switch: hidden from the directory and not taking new requests (existing ones keep working).
    is_paused = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_featured', '-rating']

    def __str__(self):
        return f"{self.business_name} ({self.category.name})"


class VenueListing(models.Model):
    class VenueType(models.TextChoices):
        BANQUET = 'banquet', 'Banquet & Party Palace'
        RESORT = 'resort', 'Resort & Lawn'
        AUDITORIUM = 'auditorium', 'Auditorium / Conference Hall'
        HOTEL = 'hotel', 'Hotel Ballroom'
        OPEN_GROUND = 'open_ground', 'Open Air Ground & Stadium'
        COMMUNITY = 'community', 'Community Center'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='venues'
    )
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255, unique=True)
    venue_type = models.CharField(max_length=30, choices=VenueType.choices, default=VenueType.BANQUET)
    city = models.CharField(max_length=100, default='Itahari')
    address = models.CharField(max_length=255)
    
    capacity_min = models.PositiveIntegerField(default=50)
    capacity_max = models.PositiveIntegerField(default=500)
    price_per_day = models.DecimalField(max_digits=12, decimal_places=2, default=25000.00)
    
    amenities = models.JSONField(default=list, blank=True)
    images = models.JSONField(default=list, blank=True)
    
    contact_person = models.CharField(max_length=100)
    contact_phone = models.CharField(max_length=30)
    contact_email = models.EmailField(blank=True)
    
    description = models.TextField()
    rules_policy = models.TextField(blank=True)
    
    is_verified = models.BooleanField(default=False)
    is_featured = models.BooleanField(default=False)
    rating = models.DecimalField(max_digits=3, decimal_places=2, default=4.8)
    review_count = models.PositiveIntegerField(default=0)

    listing_status = models.CharField(max_length=20, choices=ListingStatus.choices, default=ListingStatus.PENDING, db_index=True)
    review_note = models.TextField(blank=True)
    # Owner switch: hidden from the directory and not taking new requests (existing ones keep working).
    is_paused = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_featured', '-rating', '-created_at']

    def __str__(self):
        return f"{self.name} - {self.city} (Cap: {self.capacity_max})"


class VenueSpace(models.Model):
    """A bookable hall, auditorium or lawn inside a venue."""

    class SpaceType(models.TextChoices):
        HALL = 'hall', 'Hall'
        AUDITORIUM = 'auditorium', 'Auditorium'
        LAWN = 'lawn', 'Lawn'
        ROOFTOP = 'rooftop', 'Rooftop'
        CONFERENCE_ROOM = 'conference_room', 'Conference room'
        OTHER = 'other', 'Other'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.ForeignKey(VenueListing, on_delete=models.CASCADE, related_name='spaces')
    name = models.CharField(max_length=120)
    space_type = models.CharField(max_length=30, choices=SpaceType.choices, default=SpaceType.HALL)
    capacity_seated = models.PositiveIntegerField(default=0)
    capacity_standing = models.PositiveIntegerField(null=True, blank=True)
    price_per_day = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    area_sqft = models.PositiveIntegerField(null=True, blank=True)
    amenities = models.JSONField(default=list, blank=True)
    images = models.JSONField(default=list, blank=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'name']

    def __str__(self):
        return f"{self.name} ({self.venue.name})"


class VenueInquiry(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending Review'
        CONTACTED = 'contacted', 'Contacted'
        BOOKED = 'booked', 'Booked'
        REJECTED = 'rejected', 'Declined'
        CANCELLED = 'cancelled', 'Cancelled by customer'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.ForeignKey(VenueListing, on_delete=models.CASCADE, related_name='inquiries')
    space = models.ForeignKey(VenueSpace, on_delete=models.SET_NULL, null=True, blank=True, related_name='inquiries')
    # Signed-in sender (lets them see their inquiries and review the venue); null for guests.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='venue_inquiries',
    )
    sender_name = models.CharField(max_length=100)
    sender_email = models.EmailField()
    sender_phone = models.CharField(max_length=30)
    
    event_type = models.CharField(max_length=100, default='Wedding / Reception')
    event_date = models.DateField()
    guest_count = models.PositiveIntegerField(default=200)
    budget_range = models.CharField(max_length=100, blank=True)
    message = models.TextField()
    
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    # Booking request: the availability slot the customer picked (null = plain inquiry). The slot can be
    # reopened and picked again after a decline/cancel, so this is a FK; at most one *active* request per slot.
    slot = models.ForeignKey(
        'AvailabilitySlot', on_delete=models.SET_NULL, null=True, blank=True, related_name='venue_requests',
    )
    owner_note = models.TextField(blank=True, help_text='Message from the owner when confirming/declining')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Inquiry for {self.venue.name} from {self.sender_name}"


class VendorInquiry(models.Model):
    """Someone asking a vendor (sound, photo, catering...) about their services."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vendor = models.ForeignKey(VendorProfile, on_delete=models.CASCADE, related_name='inquiries')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='vendor_inquiries',
    )
    sender_name = models.CharField(max_length=100)
    sender_email = models.EmailField()
    sender_phone = models.CharField(max_length=30)
    event_type = models.CharField(max_length=100, blank=True)
    event_date = models.DateField(null=True, blank=True)
    budget_range = models.CharField(max_length=100, blank=True)
    message = models.TextField()
    status = models.CharField(max_length=20, choices=VenueInquiry.Status.choices, default=VenueInquiry.Status.PENDING)
    slot = models.ForeignKey(
        'AvailabilitySlot', on_delete=models.SET_NULL, null=True, blank=True, related_name='vendor_requests',
    )
    owner_note = models.TextField(blank=True, help_text='Message from the owner when confirming/declining')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name_plural = 'Vendor inquiries'

    def __str__(self):
        return f"Inquiry for {self.vendor.business_name} from {self.sender_name}"


class AvailabilitySlot(models.Model):
    """A bookable time window published by a venue (optionally for one space) or a service vendor.

    Exactly one of venue/vendor is set. start_time/end_time both null = the whole day. One booking per slot:
    a pending booking request puts it on `held`, the owner confirming makes it `booked`, a decline or the
    customer cancelling puts it back to `open`. `blocked` = the owner closed it (holiday, offline booking...).
    """

    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        HELD = 'held', 'Requested'
        BOOKED = 'booked', 'Booked'
        BLOCKED = 'blocked', 'Blocked'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.ForeignKey(VenueListing, on_delete=models.CASCADE, null=True, blank=True, related_name='slots')
    vendor = models.ForeignKey(VendorProfile, on_delete=models.CASCADE, null=True, blank=True, related_name='slots')
    space = models.ForeignKey(VenueSpace, on_delete=models.CASCADE, null=True, blank=True, related_name='slots')
    date = models.DateField()
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True,
                                help_text='Empty = the listing / space price')
    note = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['date', 'start_time']
        indexes = [
            models.Index(fields=['venue', 'date'], name='slot_venue_date_idx'),
            models.Index(fields=['vendor', 'date'], name='slot_vendor_date_idx'),
        ]
        constraints = [
            models.CheckConstraint(
                condition=(models.Q(venue__isnull=False, vendor__isnull=True)
                           | models.Q(venue__isnull=True, vendor__isnull=False)),
                name='slot_exactly_one_listing',
            ),
            models.CheckConstraint(
                condition=models.Q(space__isnull=True) | models.Q(venue__isnull=False),
                name='slot_space_needs_venue',
            ),
            models.CheckConstraint(
                condition=(models.Q(start_time__isnull=True, end_time__isnull=True)
                           | models.Q(start_time__isnull=False, end_time__isnull=False,
                                      end_time__gt=models.F('start_time'))),
                name='slot_valid_times',
            ),
        ]

    def __str__(self):
        listing = self.venue.name if self.venue_id else self.vendor.business_name
        when = 'full day' if self.is_full_day else f'{self.start_time:%H:%M}-{self.end_time:%H:%M}'
        return f'{listing} {self.date} {when} [{self.status}]'

    @property
    def is_full_day(self):
        return self.start_time is None

    @property
    def kind(self):
        return 'venue' if self.venue_id else 'vendor'

    @property
    def listing(self):
        return self.venue if self.venue_id else self.vendor

    @property
    def listing_owner_id(self):
        return self.venue.owner_id if self.venue_id else self.vendor.user_id

    @property
    def effective_price(self):
        if self.price is not None:
            return self.price
        if self.space_id:
            return self.space.price_per_day
        return self.venue.price_per_day if self.venue_id else self.vendor.starting_price

    def active_request(self):
        """The pending/confirmed booking request holding this slot, if any."""
        active = [VenueInquiry.Status.PENDING, VenueInquiry.Status.CONTACTED, VenueInquiry.Status.BOOKED]
        related = self.venue_requests if self.venue_id else self.vendor_requests
        return related.filter(status__in=active).order_by('-created_at').first()


class MarketplaceAccessRequest(models.Model):
    """An organizer asking to also run a marketplace business portal (e.g. a party palace that rents halls)."""

    class BusinessType(models.TextChoices):
        VENUE = 'venue', 'Venue or party palace'
        SOUND_STAGE = 'sound_stage', 'Sound, lights & stage'
        PHOTO_VIDEO = 'photo_video', 'Photo & video'
        DECORATION = 'decoration', 'Decoration'
        CATERING = 'catering', 'Catering'
        OTHER = 'other', 'Other'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='marketplace_access_requests')
    business_name = models.CharField(max_length=255)
    business_type = models.CharField(max_length=30, choices=BusinessType.choices, default=BusinessType.VENUE)
    city = models.CharField(max_length=100)
    phone = models.CharField(max_length=30)
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
        return f"{self.business_name} ({self.user.email}) [{self.status}]"
