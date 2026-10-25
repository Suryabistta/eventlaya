import uuid
from django.db import models
from django.conf import settings

class VendorCategory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    icon = models.CharField(max_length=50, blank=True, help_text="Lucide icon name")

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
    created_at = models.DateTimeField(auto_now_add=True)

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
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_featured', '-rating', '-created_at']

    def __str__(self):
        return f"{self.name} - {self.city} (Cap: {self.capacity_max})"


class VenueInquiry(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending Review'
        CONTACTED = 'contacted', 'Contacted'
        BOOKED = 'booked', 'Booked'
        REJECTED = 'rejected', 'Declined'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.ForeignKey(VenueListing, on_delete=models.CASCADE, related_name='inquiries')
    sender_name = models.CharField(max_length=100)
    sender_email = models.EmailField()
    sender_phone = models.CharField(max_length=30)
    
    event_type = models.CharField(max_length=100, default='Wedding / Reception')
    event_date = models.DateField()
    guest_count = models.PositiveIntegerField(default=200)
    budget_range = models.CharField(max_length=100, blank=True)
    message = models.TextField()
    
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Inquiry for {self.venue.name} from {self.sender_name}"
