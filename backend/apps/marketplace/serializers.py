from rest_framework import serializers
from .models import (
    AvailabilitySlot, ListingStatus, MarketplaceAccessRequest, VendorCategory, VendorProfile,
    VenueListing, VenueSpace, VenueInquiry, VendorInquiry,
)


def slot_summary(slot):
    """What a booking request shows about its slot (owner portal and the customer's "My inquiries")."""
    if slot is None:
        return None
    return {
        'id': str(slot.id),
        'date': slot.date.isoformat(),
        'start_time': slot.start_time.strftime('%H:%M') if slot.start_time else None,
        'end_time': slot.end_time.strftime('%H:%M') if slot.end_time else None,
        'is_full_day': slot.is_full_day,
        'space_id': str(slot.space_id) if slot.space_id else None,
        'space_name': slot.space.name if slot.space_id else None,
        'price': str(slot.effective_price),
        'status': slot.status,
    }


class BookingRequestFieldsMixin(serializers.Serializer):
    """`slot_id` (write) picks an availability slot; the view reserves it. `slot` (read) describes it."""
    slot_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    slot = serializers.SerializerMethodField()

    def get_slot(self, obj):
        return slot_summary(obj.slot) if obj.slot_id else None

    def create(self, validated_data):
        validated_data.pop('slot_id', None)  # only the view may attach a (reserved) slot, via save(slot=...)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop('slot_id', None)
        return super().update(instance, validated_data)


def apply_review_stats(data, obj, field, count_key):
    """Real reviews override the admin-set `rating` (and venue `review_count`); listings without reviews keep
    them. `review_average` / `review_total` always carry the real numbers (null / 0 when none)."""
    from apps.reviews.rules import review_stats
    avg, count = review_stats(obj, field)
    data['review_average'] = avg
    data['review_total'] = count
    if count:
        data['rating'] = f'{avg:.2f}'
        if count_key:
            data[count_key] = count
    return data


class AdminOnlyFieldsMixin:
    """Trust signals (verified, featured, rating) can only be set by platform admins."""
    ADMIN_ONLY_FIELDS = ()

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not (user and user.is_authenticated and user.is_superadmin):
            for name in self.ADMIN_ONLY_FIELDS:
                fields[name].read_only = True
        return fields


class VendorCategorySerializer(serializers.ModelSerializer):
    vendors_count = serializers.SerializerMethodField()

    def get_vendors_count(self, obj):
        return sum(1 for v in obj.vendors.all() if v.listing_status == ListingStatus.APPROVED and not v.is_paused)

    class Meta:
        model = VendorCategory
        fields = ['id', 'name', 'slug', 'icon', 'vendors_count']


class VendorProfileSerializer(AdminOnlyFieldsMixin, serializers.ModelSerializer):
    ADMIN_ONLY_FIELDS = ('is_verified', 'is_featured', 'rating')
    category_name = serializers.CharField(source='category.name', read_only=True)
    category_slug = serializers.CharField(source='category.slug', read_only=True)

    class Meta:
        model = VendorProfile
        fields = [
            'id', 'user', 'business_name', 'category', 'category_name',
            'category_slug', 'city', 'address', 'phone', 'email',
            'description', 'starting_price', 'portfolio_images',
            'is_verified', 'is_featured', 'rating', 'listing_status', 'review_note', 'is_paused', 'created_at'
        ]
        # listing_status/review_note change only through the platform approval endpoints
        read_only_fields = ['id', 'user', 'listing_status', 'review_note', 'created_at']

    def to_representation(self, obj):
        return apply_review_stats(super().to_representation(obj), obj, 'vendor', None)


class VenueSpaceSerializer(serializers.ModelSerializer):
    space_type_display = serializers.CharField(source='get_space_type_display', read_only=True)

    class Meta:
        model = VenueSpace
        fields = [
            'id', 'venue', 'name', 'space_type', 'space_type_display',
            'capacity_seated', 'capacity_standing', 'price_per_day', 'area_sqft',
            'amenities', 'images', 'description', 'is_active', 'order',
        ]
        read_only_fields = ['id', 'venue']

    def validate(self, attrs):
        seated = attrs.get('capacity_seated', getattr(self.instance, 'capacity_seated', 0)) or 0
        standing = attrs.get('capacity_standing', getattr(self.instance, 'capacity_standing', None))
        if not seated and not standing:
            raise serializers.ValidationError({'capacity_seated': 'Enter a seated or standing capacity.'})
        return attrs


class VenueInquirySerializer(BookingRequestFieldsMixin, serializers.ModelSerializer):
    venue_name = serializers.CharField(source='venue.name', read_only=True)
    space_name = serializers.CharField(source='space.name', read_only=True, default=None)

    class Meta:
        model = VenueInquiry
        fields = [
            'id', 'venue', 'venue_name', 'space', 'space_name', 'sender_name', 'sender_email',
            'sender_phone', 'event_type', 'event_date', 'guest_count',
            'budget_range', 'message', 'status', 'slot_id', 'slot', 'owner_note', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'status', 'owner_note', 'created_at', 'updated_at']
        # A booking request takes its date from the slot; plain inquiries still need one (see validate).
        extra_kwargs = {'event_date': {'required': False}}

    def validate(self, attrs):
        if self.instance is None and not attrs.get('slot_id') and not attrs.get('event_date'):
            raise serializers.ValidationError({'event_date': ['This field is required.']})
        space = attrs.get('space')
        venue = attrs.get('venue') or getattr(self.instance, 'venue', None)
        if space is not None:
            if venue is None or space.venue_id != venue.id:
                raise serializers.ValidationError({'space': 'This space does not belong to the selected venue.'})
            if not space.is_active:
                raise serializers.ValidationError({'space': 'This space is not available for booking.'})
        return attrs


class VenueListingSerializer(AdminOnlyFieldsMixin, serializers.ModelSerializer):
    owner_name = serializers.CharField(source='owner.organization_name', read_only=True)
    inquiries_count = serializers.IntegerField(source='inquiries.count', read_only=True)
    venue_type_display = serializers.CharField(source='get_venue_type_display', read_only=True)
    spaces = serializers.SerializerMethodField()
    price_from = serializers.SerializerMethodField()

    # Trust signals only platform admins may set.
    ADMIN_ONLY_FIELDS = ('is_verified', 'is_featured', 'rating', 'review_count')

    class Meta:
        model = VenueListing
        fields = [
            'id', 'owner', 'owner_name', 'name', 'slug', 'venue_type',
            'venue_type_display', 'city', 'address', 'capacity_min',
            'capacity_max', 'price_per_day', 'price_from', 'amenities', 'images',
            'contact_person', 'contact_phone', 'contact_email',
            'description', 'rules_policy', 'is_verified', 'is_featured',
            'rating', 'review_count', 'inquiries_count', 'spaces',
            'listing_status', 'review_note', 'is_paused', 'created_at', 'updated_at'
        ]
        # slug is generated on create (see VenueListingViewSet.perform_create);
        # listing_status/review_note change only through the platform approval endpoints
        read_only_fields = ['id', 'owner', 'slug', 'listing_status', 'review_note', 'created_at', 'updated_at']

    @staticmethod
    def _active_spaces(obj):
        return [s for s in obj.spaces.all() if s.is_active]

    def get_spaces(self, obj):
        return VenueSpaceSerializer(self._active_spaces(obj), many=True).data

    def get_price_from(self, obj):
        spaces = self._active_spaces(obj)
        if spaces:
            return str(min(s.price_per_day for s in spaces))
        return str(obj.price_per_day)

    def to_representation(self, obj):
        data = super().to_representation(obj)
        spaces = self._active_spaces(obj)
        if spaces:
            # Capacity range across the venue's spaces: smallest space to largest crowd.
            sizes = [max(s.capacity_seated or 0, s.capacity_standing or 0) for s in spaces]
            mins = [s.capacity_seated or s.capacity_standing or 0 for s in spaces]
            data['capacity_min'] = min(mins)
            data['capacity_max'] = max(sizes)
        return apply_review_stats(data, obj, 'venue', 'review_count')


class VendorInquirySerializer(BookingRequestFieldsMixin, serializers.ModelSerializer):
    vendor_name = serializers.CharField(source='vendor.business_name', read_only=True)

    class Meta:
        model = VendorInquiry
        fields = [
            'id', 'vendor', 'vendor_name', 'sender_name', 'sender_email', 'sender_phone',
            'event_type', 'event_date', 'budget_range', 'message', 'status', 'slot_id', 'slot', 'owner_note',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'vendor', 'status', 'owner_note', 'created_at', 'updated_at']


class OwnerDecisionSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, max_length=2000)


# --- Availability slots ----------------------------------------------------------------------------

def _hhmm(value):
    return value.strftime('%H:%M') if value else None


class AvailabilitySlotSerializer(serializers.ModelSerializer):
    """Owner view of a slot, with the booking request holding it (customer details included)."""
    kind = serializers.CharField(read_only=True)
    listing_name = serializers.SerializerMethodField()
    space_name = serializers.CharField(source='space.name', read_only=True, default=None)
    start_time = serializers.SerializerMethodField()
    end_time = serializers.SerializerMethodField()
    is_full_day = serializers.BooleanField(read_only=True)
    effective_price = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    request = serializers.SerializerMethodField()

    class Meta:
        model = AvailabilitySlot
        fields = [
            'id', 'kind', 'venue', 'vendor', 'listing_name', 'space', 'space_name', 'date', 'start_time', 'end_time',
            'is_full_day', 'price', 'effective_price', 'note', 'status', 'request', 'created_at', 'updated_at',
        ]

    def get_listing_name(self, obj):
        return obj.venue.name if obj.venue_id else obj.vendor.business_name

    def get_start_time(self, obj):
        return _hhmm(obj.start_time)

    def get_end_time(self, obj):
        return _hhmm(obj.end_time)

    def get_request(self, obj):
        if obj.status not in (AvailabilitySlot.Status.HELD, AvailabilitySlot.Status.BOOKED):
            return None
        prefetched = getattr(obj, '_active_requests', None)
        req = prefetched[0] if prefetched else (None if prefetched is not None else obj.active_request())
        if req is None:
            return None
        return {
            'id': str(req.id), 'kind': obj.kind, 'status': req.status,
            'sender_name': req.sender_name, 'sender_email': req.sender_email, 'sender_phone': req.sender_phone,
            'event_type': req.event_type, 'guest_count': getattr(req, 'guest_count', None),
            'budget_range': req.budget_range, 'message': req.message, 'owner_note': req.owner_note,
            'created_at': req.created_at,
        }


class PublicSlotSerializer(serializers.ModelSerializer):
    """Public calendar entry: never any customer details; notes and prices only on open slots."""
    space_name = serializers.CharField(source='space.name', read_only=True, default=None)
    start_time = serializers.SerializerMethodField()
    end_time = serializers.SerializerMethodField()
    is_full_day = serializers.BooleanField(read_only=True)
    price = serializers.SerializerMethodField()
    note = serializers.SerializerMethodField()
    available = serializers.SerializerMethodField()

    class Meta:
        model = AvailabilitySlot
        fields = ['id', 'date', 'start_time', 'end_time', 'is_full_day', 'space', 'space_name', 'price', 'note',
                  'status', 'available']

    def get_start_time(self, obj):
        return _hhmm(obj.start_time)

    def get_end_time(self, obj):
        return _hhmm(obj.end_time)

    def get_available(self, obj):
        return obj.status == AvailabilitySlot.Status.OPEN

    def get_price(self, obj):
        return str(obj.effective_price) if self.get_available(obj) else None

    def get_note(self, obj):
        return obj.note if self.get_available(obj) else ''


class SlotTimesMixin:
    def check_times(self, start, end):
        if (start is None) != (end is None):
            raise serializers.ValidationError(
                {'end_time' if start is not None else 'start_time': ['Give both start and end time, or neither for a full day.']})
        if start is not None and end <= start:
            raise serializers.ValidationError({'end_time': ['End time must be after the start time.']})


class SlotTargetSerializer(serializers.Serializer):
    venue = serializers.UUIDField(required=False, allow_null=True)
    vendor = serializers.UUIDField(required=False, allow_null=True)
    space = serializers.UUIDField(required=False, allow_null=True)

    def validate(self, attrs):
        if bool(attrs.get('venue')) == bool(attrs.get('vendor')):
            raise serializers.ValidationError({'venue': ['Give exactly one of venue or vendor.']})
        if attrs.get('space') and not attrs.get('venue'):
            raise serializers.ValidationError({'space': ['Spaces belong to venues.']})
        return attrs


SLOT_EDITABLE_STATUSES = [AvailabilitySlot.Status.OPEN, AvailabilitySlot.Status.BLOCKED]


class SlotCreateSerializer(SlotTimesMixin, SlotTargetSerializer):
    date = serializers.DateField()
    start_time = serializers.TimeField(required=False, allow_null=True)
    end_time = serializers.TimeField(required=False, allow_null=True)
    price = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=0)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255, default='')
    status = serializers.ChoiceField(choices=SLOT_EDITABLE_STATUSES, default=AvailabilitySlot.Status.OPEN)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        self.check_times(attrs.get('start_time'), attrs.get('end_time'))
        return attrs


class SlotUpdateSerializer(serializers.Serializer):
    date = serializers.DateField(required=False)
    start_time = serializers.TimeField(required=False, allow_null=True)
    end_time = serializers.TimeField(required=False, allow_null=True)
    price = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=0)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)
    status = serializers.ChoiceField(choices=SLOT_EDITABLE_STATUSES, required=False)


class BulkSlotSerializer(SlotTimesMixin, SlotTargetSerializer):
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    weekdays = serializers.ListField(child=serializers.IntegerField(min_value=0, max_value=6), required=False,
                                     allow_empty=False, help_text='0 = Monday … 6 = Sunday; omit for every day')
    start_time = serializers.TimeField(required=False, allow_null=True)
    end_time = serializers.TimeField(required=False, allow_null=True)
    price = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=0)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255, default='')

    def validate(self, attrs):
        attrs = super().validate(attrs)
        self.check_times(attrs.get('start_time'), attrs.get('end_time'))
        if attrs['end_date'] < attrs['start_date']:
            raise serializers.ValidationError({'end_date': ['End date must be on or after the start date.']})
        return attrs


class BlockDatesSerializer(SlotTargetSerializer):
    dates = serializers.ListField(child=serializers.DateField(), allow_empty=False, max_length=370)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255, default='')


class InquiryStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[
        VenueInquiry.Status.PENDING, VenueInquiry.Status.CONTACTED,
        VenueInquiry.Status.BOOKED, VenueInquiry.Status.REJECTED,
    ])


class MarketplaceAccessRequestSerializer(serializers.ModelSerializer):
    business_type_display = serializers.CharField(source='get_business_type_display', read_only=True)
    user_email = serializers.CharField(source='user.email', read_only=True)
    user_name = serializers.SerializerMethodField()
    organization_name = serializers.CharField(source='user.organization_name', read_only=True)
    reviewed_by_email = serializers.CharField(source='reviewed_by.email', read_only=True, default=None)

    class Meta:
        model = MarketplaceAccessRequest
        fields = [
            'id', 'user', 'user_email', 'user_name', 'organization_name',
            'business_name', 'business_type', 'business_type_display', 'city', 'phone', 'note',
            'status', 'review_note', 'reviewed_by', 'reviewed_by_email', 'created_at', 'reviewed_at',
        ]
        read_only_fields = ['id', 'user', 'status', 'review_note', 'reviewed_by', 'created_at', 'reviewed_at']

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.username


class ReviewSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, default='', max_length=2000)
