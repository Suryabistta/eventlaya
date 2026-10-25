from rest_framework import serializers
from .models import VendorCategory, VendorProfile

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
