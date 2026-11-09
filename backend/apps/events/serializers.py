from django.conf import settings
from django.utils import timezone
from rest_framework import serializers
from .models import Event, EventTicket, GateScanLog

class EventTicketSerializer(serializers.ModelSerializer):
    promo_code = serializers.SerializerMethodField()
    gate_note = serializers.SerializerMethodField()
    order_reference = serializers.CharField(source='order.reference', default=None, read_only=True)
    payment = serializers.SerializerMethodField()
    seat_number = serializers.SerializerMethodField()
    pass_layout = serializers.CharField(source='event.ticket_layout', read_only=True)

    class Meta:
        model = EventTicket
        fields = [
            'id', 'ticket_number', 'qr_token', 'attendee_name',
            'attendee_email', 'attendee_phone', 'status',
            'is_attended', 'first_check_in', 'last_activity', 'created_at',
            'ticket_type', 'ticket_type_name', 'price', 'promo_code', 'gate_note',
            'order_reference', 'guest_number', 'payment', 'seat_number', 'pass_layout',
        ]

    def get_seat_number(self, obj):
        """Attendee-facing by default; organizer and gate views pass context={'staff': True}."""
        from .seats import visible_seat
        return visible_seat(obj, staff=self.context.get('staff', False))

    def get_payment(self, obj):
        """How the order was / will be paid: {method, status, provider, reference, amount, paid_at, label}."""
        return obj.order.payment_info() if obj.order_id else None

    def get_promo_code(self, obj):
        return obj.promo_code.code if obj.promo_code_id else None

    def get_gate_note(self, obj):
        return obj.ticket_type.gate_note if obj.ticket_type_id else ''
        read_only_fields = ['id', 'ticket_number', 'qr_token', 'created_at']


class GateScanLogSerializer(serializers.ModelSerializer):
    ticket_number = serializers.CharField(source='ticket.ticket_number', read_only=True)
    attendee_name = serializers.CharField(source='ticket.attendee_name', read_only=True)

    class Meta:
        model = GateScanLog
        fields = [
            'id', 'ticket_number', 'attendee_name', 'scan_type',
            'result', 'gate_name', 'device_info', 'scanned_at'
        ]


from django.utils.text import slugify


def validate_event_category(value, instance=None):
    """An active event type from Admin → Cities & categories; an event may keep the type it already has."""
    from apps.platform.models import EventCategory
    value = (value or '').strip() or Event.Category.OTHER
    if value == Event.Category.OTHER or (instance is not None and value == instance.category):
        return value
    if not EventCategory.objects.filter(slug=value, is_active=True).exists():
        raise serializers.ValidationError('Pick an event type from the list.')
    return value


def category_labels(serializer):
    """{slug: name} of every event type, loaded once per response (lists serialize many events)."""
    from apps.platform.models import EventCategory
    root = serializer.root
    if not hasattr(root, '_category_labels'):
        root._category_labels = dict(EventCategory.objects.values_list('slug', 'name'))
    return root._category_labels


class EventSerializer(serializers.ModelSerializer):
    registered_count = serializers.IntegerField(read_only=True)
    checked_in_count = serializers.IntegerField(read_only=True)
    organizer_name = serializers.CharField(source='organizer.organization_name', read_only=True)
    organizer_verified = serializers.BooleanField(source='organizer.is_verified', read_only=True)
    parent_title = serializers.CharField(source='parent.title', read_only=True, default=None)
    registration_form_title = serializers.CharField(source='registration_form.title', read_only=True, default=None)
    slug = serializers.CharField(required=False, allow_blank=True)
    # Path of an image uploaded via /api/uploads/ (e.g. "/media/uploads/banner/…"); empty string clears the banner
    banner_url = serializers.CharField(write_only=True, required=False, allow_blank=True, allow_null=True)
    phase = serializers.SerializerMethodField()
    registration_open = serializers.SerializerMethodField()
    registration_closed_reason = serializers.SerializerMethodField()
    category_name = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            'id', 'organizer', 'organizer_name', 'organizer_verified', 'title', 'slug', 'description',
            'banner', 'banner_url', 'location', 'start_date', 'start_time', 'end_date', 'end_time',
            'capacity', 'status', 'allow_registration', 'registration_deadline',
            'is_paid', 'ticket_price', 'registration_form', 'registration_form_title',
            'registered_count', 'checked_in_count', 'created_at', 'updated_at',
            'tagline', 'category', 'category_name', 'is_featured', 'phase', 'registration_open', 'registration_closed_reason',
            'max_tickets_per_order', 'show_spots_left',
            'managed_by', 'managed_by_logo', 'show_managed_by', 'managed_by_label', 'ticket_layout', 'show_seat_number', 'registration_mode',
            'parent', 'parent_title',
        ]
        read_only_fields = ['id', 'organizer', 'is_featured', 'created_at', 'updated_at']

    def validate_parent(self, parent):
        """A sub-event hangs under one of the organizer's own main events, one level deep."""
        if parent is None:
            return None
        from .sub_events import sub_events_on
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user is None or not sub_events_on(user):
            raise serializers.ValidationError('Sub-events are turned off for your account.')
        if parent.organizer_id != (self.instance.organizer_id if self.instance else user.id) and not user.is_superadmin:
            raise serializers.ValidationError('Pick one of your own events.')
        if parent.parent_id:
            raise serializers.ValidationError('A sub-event can’t have sub-events of its own. Pick a main event.')
        if self.instance is not None:
            if parent.pk == self.instance.pk:
                raise serializers.ValidationError('An event can’t be its own main event.')
            if self.instance.sub_events.exists():
                raise serializers.ValidationError('This event has sub-events, so it can’t become a sub-event itself.')
        return parent

    def validate_managed_by_logo(self, value):
        from apps.platform.catalog import safe_url
        return safe_url(value, 'Logo')


    def validate_category(self, value):
        return validate_event_category(value, self.instance)

    def get_category_name(self, obj):
        if not obj.category or obj.category == Event.Category.OTHER:
            return ''
        return category_labels(self).get(obj.category, obj.category.replace('-', ' ').title())

    def get_phase(self, obj):
        return obj.phase()

    def get_registration_open(self, obj):
        return obj.registration_closed_reason() is None

    def get_registration_closed_reason(self, obj):
        return obj.registration_closed_reason()
    def validate_banner_url(self, value):
        if not value:
            return ''
        prefix = f"{settings.MEDIA_URL}uploads/"
        if not value.startswith(prefix) or '..' in value:
            raise serializers.ValidationError('Upload the banner with the image uploader.')
        return value[len(settings.MEDIA_URL):]

    def _apply_banner(self, instance, path):
        if path is None:
            return instance
        instance.banner.name = path or None
        instance.save(update_fields=['banner'])
        return instance

    def create(self, validated_data):
        path = validated_data.pop('banner_url', None)
        return self._apply_banner(super().create(validated_data), path)

    def update(self, instance, validated_data):
        path = validated_data.pop('banner_url', None)
        return self._apply_banner(super().update(instance, validated_data), path)

    def validate(self, attrs):
        title = attrs.get('title') or (self.instance.title if self.instance else '')
        slug = attrs.get('slug')

        # Auto-generate and deduplicate slug if not provided or empty. On update, keep the
        # existing slug unless the client explicitly sends one (renaming must not break shared links).
        if not slug and title and (self.instance is None or 'slug' in attrs):
            base_slug = slugify(title) or 'event'
            slug = base_slug
            counter = 1
            qs = Event.objects.all()
            if self.instance:
                qs = qs.exclude(id=self.instance.id)
            while qs.filter(slug=slug).exists():
                slug = f"{base_slug}-{counter}"
                counter += 1
            attrs['slug'] = slug
        elif slug:
            # Check unique slug if provided
            qs = Event.objects.filter(slug=slug)
            if self.instance:
                qs = qs.exclude(id=self.instance.id)
            if qs.exists():
                base_slug = slug
                counter = 1
                while Event.objects.filter(slug=slug).exclude(id=getattr(self.instance, 'id', None)).exists():
                    slug = f"{base_slug}-{counter}"
                    counter += 1
                attrs['slug'] = slug

        # Date validations
        start_date = attrs.get('start_date') or (self.instance.start_date if self.instance else None)
        end_date = attrs.get('end_date') or (self.instance.end_date if self.instance else None)
        start_time = attrs.get('start_time') or (self.instance.start_time if self.instance else None)
        end_time = attrs.get('end_time') or (self.instance.end_time if self.instance else None)
        reg_deadline = attrs.get('registration_deadline') or (self.instance.registration_deadline if self.instance else None)

        if start_date and end_date and end_date < start_date:
            raise serializers.ValidationError({'end_date': 'End date cannot be earlier than start date.'})

        if not self.instance and start_date and start_date < timezone.localdate():
            raise serializers.ValidationError({'start_date': "New events can't start in the past."})

        if start_date and end_date and start_date == end_date:
            if start_time and end_time and end_time <= start_time:
                raise serializers.ValidationError({'end_time': 'End time must be after start time on the same date.'})

        if reg_deadline:
            last_date = end_date or start_date
            if last_date and reg_deadline.date() > last_date:
                raise serializers.ValidationError({'registration_deadline': 'Registration deadline cannot be after the event end date.'})

        max_per_order = attrs.get('max_tickets_per_order')
        if max_per_order is not None and not (1 <= max_per_order <= 50):
            raise serializers.ValidationError({'max_tickets_per_order': 'Allow between 1 and 50 tickets per order.'})

        # Capacity validation
        capacity = attrs.get('capacity', getattr(self.instance, 'capacity', 0))
        if capacity < 0:
            raise serializers.ValidationError({'capacity': 'Capacity cannot be a negative number.'})

        # Paid vs Free validation
        is_paid = attrs.get('is_paid', getattr(self.instance, 'is_paid', False))
        ticket_price = attrs.get('ticket_price', getattr(self.instance, 'ticket_price', 0))
        if is_paid and float(ticket_price) <= 0:
            raise serializers.ValidationError({'ticket_price': 'Paid events must specify a ticket price greater than 0.'})
        elif not is_paid:
            attrs['ticket_price'] = 0.00

        return attrs


class EventFundingSerializer(serializers.ModelSerializer):
    total_funding = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    total_expenses = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    net_balance = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        from .models import EventFunding
        model = EventFunding
        fields = [
            'id', 'event', 'target_budget', 'sponsorship_raised',
            'ticket_sales_revenue', 'grants_donations', 'total_funding',
            'expense_venue', 'expense_catering', 'expense_production',
            'expense_marketing', 'expense_prizes_gifts', 'expense_logistics',
            'total_expenses', 'net_balance', 'updated_at'
        ]
        read_only_fields = ['id', 'updated_at']


class EventTaskSerializer(serializers.ModelSerializer):
    event_title = serializers.CharField(source='event.title', read_only=True, default=None)
    assigned_email = serializers.CharField(source='assigned_to.email', read_only=True, default='')

    class Meta:
        from .models import EventTask
        model = EventTask
        fields = [
            'id', 'organizer', 'event', 'event_title', 'title', 'description',
            'assigned_to', 'assigned_email', 'assigned_name', 'assignee_email', 'status',
            'priority', 'category', 'due_date', 'due_time', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'organizer', 'created_at', 'updated_at']
        extra_kwargs = {'event': {'required': False, 'allow_null': True}}

    def validate_event(self, event):
        """Organizers can only link tasks to their own events."""
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if event and user and not getattr(user, 'is_superadmin', False) and event.organizer_id != user.id:
            raise serializers.ValidationError('You can only link tasks to your own events.')
        return event


from .models import EventGate, StaffGateAssignment


class EventGateSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventGate
        fields = ['id', 'event', 'name', 'kind', 'is_vip', 'is_active', 'order', 'created_at']
        read_only_fields = ['id', 'event', 'created_at']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Give the gate a name.')
        event = self.context.get('event') or (self.instance.event if self.instance else None)
        qs = EventGate.objects.filter(event=event, name__iexact=value)
        if self.instance:
            qs = qs.exclude(id=self.instance.id)
        if event is not None and qs.exists():
            raise serializers.ValidationError(f'A gate called "{value}" already exists for this event.')
        return value


def assignment_data(a):
    return {
        'id': str(a.id),
        'staff_id': str(a.staff.id),
        'staff_name': a.staff.get_full_name() or a.staff.username,
        'staff_email': a.staff.email,
        'gate_id': str(a.gate_id) if a.gate_id else None,
        'gate_name': a.gate.name if a.gate_id else a.gate_name,
        'gate': {'id': str(a.gate.id), 'name': a.gate.name, 'kind': a.gate.kind, 'is_vip': a.gate.is_vip} if a.gate_id else None,
        'is_active': a.is_active,
        'created_at': a.created_at.isoformat(),
    }


# ---------- Public event page content ----------

from django.db import transaction
from .models import EventAgendaItem, EventSpeaker, EventFAQ


class EventAgendaItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventAgendaItem
        fields = ['id', 'day', 'start_time', 'end_time', 'title', 'description', 'location', 'speaker_names', 'order']
        read_only_fields = ['id']

    def validate(self, attrs):
        if attrs.get('end_time') and attrs.get('start_time') and attrs['end_time'] <= attrs['start_time']:
            raise serializers.ValidationError({'end_time': 'End time must be after the start time.'})
        return attrs


class EventSpeakerSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventSpeaker
        fields = ['id', 'name', 'role', 'organization', 'photo_url', 'bio', 'order']
        read_only_fields = ['id']

    def validate_photo_url(self, value):
        value = (value or '').strip()
        if value and not (value.startswith(f'{settings.MEDIA_URL}uploads/') or value.startswith('https://')):
            raise serializers.ValidationError('Upload the photo with the image uploader.')
        if '..' in value:
            raise serializers.ValidationError('That photo address is not allowed.')
        return value


class EventFAQSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventFAQ
        fields = ['id', 'question', 'answer', 'order']
        read_only_fields = ['id']


class EventPageSerializer(serializers.ModelSerializer):
    """Organizer editor for the public event page. Lists are replaced as a whole."""

    agenda = EventAgendaItemSerializer(many=True, required=False)
    speakers = EventSpeakerSerializer(many=True, required=False)
    faqs = EventFAQSerializer(many=True, required=False)

    class Meta:
        model = Event
        fields = ['tagline', 'category', 'highlights', 'contact_email', 'contact_phone', 'map_query', 'terms', 'speakers_label', 'agenda', 'speakers', 'faqs']

    def validate_category(self, value):
        return validate_event_category(value, self.instance)

    def validate_highlights(self, value):
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise serializers.ValidationError('Highlights must be a list of short texts.')
        cleaned = [v.strip() for v in value if v.strip()]
        if len(cleaned) > 12:
            raise serializers.ValidationError('Keep it to 12 highlights or fewer.')
        if any(len(v) > 120 for v in cleaned):
            raise serializers.ValidationError('Each highlight must be 120 characters or fewer.')
        return cleaned

    def validate_agenda(self, value):
        if len(value) > 100:
            raise serializers.ValidationError('A schedule can have up to 100 items.')
        return value

    def validate_speakers(self, value):
        if len(value) > 60:
            raise serializers.ValidationError('An event page can list up to 60 speakers.')
        return value

    def validate_faqs(self, value):
        if len(value) > 40:
            raise serializers.ValidationError('An event page can have up to 40 questions.')
        return value

    @transaction.atomic
    def update(self, instance, validated_data):
        lists = {
            'agenda': (EventAgendaItem, validated_data.pop('agenda', None)),
            'speakers': (EventSpeaker, validated_data.pop('speakers', None)),
            'faqs': (EventFAQ, validated_data.pop('faqs', None)),
        }
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        for related, (model, items) in lists.items():
            if items is None:
                continue
            getattr(instance, related).all().delete()
            model.objects.bulk_create([model(event=instance, **{**item, 'order': i}) for i, item in enumerate(items)])
        return instance
