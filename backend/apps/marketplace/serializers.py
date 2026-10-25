from rest_framework import serializers
from .models import VendorCategory, VendorProfile, VenueListing, VenueInquiry

class VendorCategorySerializer(serializers.ModelSerializer):
    vendors_count = serializers.IntegerField(source='vendors.count', read_only=True)

    class Meta:
        model = VendorCategory
        fields = ['id', 'name', 'slug', 'icon', 'vendors_count']


class VendorProfileSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    category_slug = serializers.CharField(source='category.slug', read_only=True)

    class Meta:
        model = VendorProfile
        fields = [
            'id', 'user', 'business_name', 'category', 'category_name',
            'category_slug', 'city', 'address', 'phone', 'email',
            'description', 'starting_price', 'portfolio_images',
            'is_verified', 'is_featured', 'rating', 'created_at'
        ]
        read_only_fields = ['id', 'user', 'created_at']


class VenueInquirySerializer(serializers.ModelSerializer):
    venue_name = serializers.CharField(source='venue.name', read_only=True)

    class Meta:
        model = VenueInquiry
        fields = [
            'id', 'venue', 'venue_name', 'sender_name', 'sender_email',
            'sender_phone', 'event_type', 'event_date', 'guest_count',
            'budget_range', 'message', 'status', 'created_at'
        ]
        read_only_fields = ['id', 'status', 'created_at']


class VenueListingSerializer(serializers.ModelSerializer):
    owner_name = serializers.CharField(source='owner.organization_name', read_only=True)
    inquiries_count = serializers.IntegerField(source='inquiries.count', read_only=True)
    venue_type_display = serializers.CharField(source='get_venue_type_display', read_only=True)

    class Meta:
        model = VenueListing
        fields = [
            'id', 'owner', 'owner_name', 'name', 'slug', 'venue_type',
            'venue_type_display', 'city', 'address', 'capacity_min',
            'capacity_max', 'price_per_day', 'amenities', 'images',
            'contact_person', 'contact_phone', 'contact_email',
            'description', 'rules_policy', 'is_verified', 'is_featured',
            'rating', 'review_count', 'inquiries_count', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'owner', 'created_at', 'updated_at']
