from rest_framework import serializers
from .models import Event, EventTicket, GateScanLog

class EventTicketSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventTicket
        fields = [
            'id', 'ticket_number', 'qr_token', 'attendee_name',
            'attendee_email', 'attendee_phone', 'status',
            'is_attended', 'first_check_in', 'last_activity', 'created_at'
        ]
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


class EventSerializer(serializers.ModelSerializer):
    registered_count = serializers.IntegerField(read_only=True)
    checked_in_count = serializers.IntegerField(read_only=True)
    organizer_name = serializers.CharField(source='organizer.organization_name', read_only=True)
    registration_form_title = serializers.CharField(source='registration_form.title', read_only=True, default=None)
    slug = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = Event
        fields = [
            'id', 'organizer', 'organizer_name', 'title', 'slug', 'description',
            'banner', 'location', 'start_date', 'start_time', 'end_date', 'end_time',
            'capacity', 'status', 'allow_registration', 'registration_deadline',
            'is_paid', 'ticket_price', 'registration_form', 'registration_form_title',
            'registered_count', 'checked_in_count', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'organizer', 'created_at', 'updated_at']

    def validate(self, attrs):
        title = attrs.get('title') or (self.instance.title if self.instance else '')
        slug = attrs.get('slug')

        # Auto-generate and deduplicate slug if not provided or empty
        if not slug and title:
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

        if start_date and end_date and start_date == end_date:
            if start_time and end_time and end_time <= start_time:
                raise serializers.ValidationError({'end_time': 'End time must be after start time on the same date.'})

        if reg_deadline:
            last_date = end_date or start_date
            if last_date and reg_deadline.date() > last_date:
                raise serializers.ValidationError({'registration_deadline': 'Registration deadline cannot be after the event end date.'})

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
    event_title = serializers.CharField(source='event.title', read_only=True)
    assigned_email = serializers.CharField(source='assigned_to.email', read_only=True, default='')

    class Meta:
        from .models import EventTask
        model = EventTask
        fields = [
            'id', 'event', 'event_title', 'title', 'description',
            'assigned_to', 'assigned_email', 'assigned_name', 'status',
            'priority', 'category', 'due_time', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
