from rest_framework import serializers
from .models import Form, FormField, FormResponse, FormAnswer

class FormFieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = FormField
        fields = [
            'id', 'form', 'field_type', 'label', 'placeholder',
            'help_text', 'required', 'order', 'options', 'validation_rules'
        ]
        read_only_fields = ['id']


class FormAnswerSerializer(serializers.ModelSerializer):
    field_label = serializers.CharField(source='field.label', read_only=True)
    field_type = serializers.CharField(source='field.field_type', read_only=True)

    class Meta:
        model = FormAnswer
        fields = ['id', 'field', 'field_label', 'field_type', 'value']


class FormResponseSerializer(serializers.ModelSerializer):
    answers = FormAnswerSerializer(many=True, read_only=True)
    ticket_number = serializers.CharField(source='ticket.ticket_number', read_only=True)
    qr_token = serializers.CharField(source='ticket.qr_token', read_only=True)

    class Meta:
        model = FormResponse
        fields = [
            'id', 'form', 'event', 'ticket', 'ticket_number', 'qr_token',
            'submitter_name', 'submitter_email', 'submitter_phone',
            'review_status', 'rejection_note', 'submitted_at', 'answers'
        ]
        read_only_fields = ['id', 'submitted_at', 'ticket_number', 'qr_token']


class FormDetailSerializer(serializers.ModelSerializer):
    fields = FormFieldSerializer(many=True, read_only=True)
    responses_count = serializers.IntegerField(source='responses.count', read_only=True)

    class Meta:
        model = Form
        fields = [
            'id', 'organizer', 'event', 'title', 'slug', 'description',
            'status', 'allow_multiple_submissions', 'fields', 'responses_count',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'organizer', 'created_at', 'updated_at']
