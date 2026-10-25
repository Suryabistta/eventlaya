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


class EventSerializer(serializers.ModelSerializer):
    registered_count = serializers.IntegerField(read_only=True)
    checked_in_count = serializers.IntegerField(read_only=True)
    organizer_name = serializers.CharField(source='organizer.organization_name', read_only=True)
    registration_form_title = serializers.CharField(source='registration_form.title', read_only=True, default=None)

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
