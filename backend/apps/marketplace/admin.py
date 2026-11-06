from django.contrib import admin
from .models import AvailabilitySlot, MarketplaceAccessRequest, VendorCategory, VendorProfile, VenueListing, VenueSpace, VenueInquiry, VendorInquiry

@admin.register(VendorCategory)
class VendorCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'icon')
    prepopulated_fields = {'slug': ('name',)}

@admin.register(VendorProfile)
class VendorProfileAdmin(admin.ModelAdmin):
    list_display = ('business_name', 'category', 'city', 'phone', 'listing_status', 'is_verified', 'is_featured', 'rating')
    list_filter = ('listing_status', 'category', 'city', 'is_verified', 'is_featured')
    search_fields = ('business_name', 'city', 'description')

class VenueSpaceInline(admin.TabularInline):
    model = VenueSpace
    extra = 0
    fields = ('order', 'name', 'space_type', 'capacity_seated', 'capacity_standing', 'price_per_day', 'is_active')


@admin.register(VenueSpace)
class VenueSpaceAdmin(admin.ModelAdmin):
    list_display = ('name', 'venue', 'space_type', 'capacity_seated', 'capacity_standing', 'price_per_day', 'is_active', 'order')
    list_filter = ('space_type', 'is_active')
    search_fields = ('name', 'venue__name')

@admin.register(VenueListing)
class VenueListingAdmin(admin.ModelAdmin):
    inlines = [VenueSpaceInline]
    list_display = ('name', 'venue_type', 'city', 'capacity_min', 'capacity_max', 'price_per_day', 'listing_status', 'is_verified', 'is_featured')
    list_filter = ('listing_status', 'venue_type', 'city', 'is_verified', 'is_featured')
    search_fields = ('name', 'city', 'address', 'contact_person')

@admin.register(VenueInquiry)
class VenueInquiryAdmin(admin.ModelAdmin):
    list_display = ('venue', 'space', 'sender_name', 'sender_phone', 'event_type', 'event_date', 'guest_count', 'status', 'slot', 'user', 'created_at')
    list_filter = ('status', 'event_date')
    search_fields = ('sender_name', 'sender_email', 'sender_phone', 'venue__name')
    raw_id_fields = ('user', 'slot')


@admin.register(AvailabilitySlot)
class AvailabilitySlotAdmin(admin.ModelAdmin):
    list_display = ('date', 'start_time', 'end_time', 'venue', 'space', 'vendor', 'status', 'price', 'note', 'updated_at')
    list_filter = ('status', 'date')
    search_fields = ('venue__name', 'vendor__business_name', 'space__name', 'note')
    raw_id_fields = ('venue', 'vendor', 'space')
    date_hierarchy = 'date'


@admin.register(VendorInquiry)
class VendorInquiryAdmin(admin.ModelAdmin):
    list_display = ('vendor', 'sender_name', 'sender_phone', 'event_type', 'event_date', 'status', 'slot', 'user', 'created_at')
    list_filter = ('status',)
    search_fields = ('sender_name', 'sender_email', 'sender_phone', 'vendor__business_name')
    raw_id_fields = ('user', 'slot')


@admin.register(MarketplaceAccessRequest)
class MarketplaceAccessRequestAdmin(admin.ModelAdmin):
    list_display = ('business_name', 'user', 'business_type', 'city', 'status', 'created_at', 'reviewed_at')
    list_filter = ('status', 'business_type')
    search_fields = ('business_name', 'user__email', 'city')
