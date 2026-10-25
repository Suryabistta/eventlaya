from django.contrib import admin
from .models import VendorCategory, VendorProfile, VenueListing, VenueInquiry

@admin.register(VendorCategory)
class VendorCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'icon')
    prepopulated_fields = {'slug': ('name',)}

@admin.register(VendorProfile)
class VendorProfileAdmin(admin.ModelAdmin):
    list_display = ('business_name', 'category', 'city', 'phone', 'is_verified', 'is_featured', 'rating')
    list_filter = ('category', 'city', 'is_verified', 'is_featured')
    search_fields = ('business_name', 'city', 'description')

@admin.register(VenueListing)
class VenueListingAdmin(admin.ModelAdmin):
    list_display = ('name', 'venue_type', 'city', 'capacity_min', 'capacity_max', 'price_per_day', 'is_verified', 'is_featured')
    list_filter = ('venue_type', 'city', 'is_verified', 'is_featured')
    search_fields = ('name', 'city', 'address', 'contact_person')

@admin.register(VenueInquiry)
class VenueInquiryAdmin(admin.ModelAdmin):
    list_display = ('venue', 'sender_name', 'sender_phone', 'event_type', 'event_date', 'guest_count', 'status', 'created_at')
    list_filter = ('status', 'event_date')
    search_fields = ('sender_name', 'sender_email', 'sender_phone', 'venue__name')
