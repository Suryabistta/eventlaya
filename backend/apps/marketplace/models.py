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
