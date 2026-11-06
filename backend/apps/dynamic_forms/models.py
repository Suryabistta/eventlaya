import uuid
from django.db import models
from django.conf import settings

class Form(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'
        ARCHIVED = 'archived', 'Archived'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='forms'
    )
    event = models.ForeignKey(
        'events.Event',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='dynamic_forms'
    )
    title = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    
    allow_multiple_submissions = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title


class FormField(models.Model):
    class FieldType(models.TextChoices):
        TEXT = 'text', 'Short Text'
        PARAGRAPH = 'paragraph', 'Paragraph / Long Text'
        NUMBER = 'number', 'Number'
        EMAIL = 'email', 'Email'
        PHONE = 'phone', 'Phone Number'
        SELECT = 'select', 'Dropdown / Select'
        RADIO = 'radio', 'Radio Buttons'
        CHECKBOX = 'checkbox', 'Checkboxes'
        DATE = 'date', 'Date'
        FILE_UPLOAD = 'file_upload', 'File Upload'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    form = models.ForeignKey(Form, on_delete=models.CASCADE, related_name='fields')
    field_type = models.CharField(max_length=20, choices=FieldType.choices, default=FieldType.TEXT)
    label = models.CharField(max_length=255)
    placeholder = models.CharField(max_length=255, blank=True)
    help_text = models.CharField(max_length=255, blank=True)
    required = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)
    options = models.JSONField(default=list, blank=True) # for select/radio/checkbox
    validation_rules = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self):
        return f"{self.label} ({self.field_type})"


class FormResponse(models.Model):
    class ReviewStatus(models.TextChoices):
        PENDING = 'pending', 'Pending'
        ACCEPTED = 'accepted', 'Accepted'
        REJECTED = 'rejected', 'Rejected'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    form = models.ForeignKey(Form, on_delete=models.CASCADE, related_name='responses')
    event = models.ForeignKey(
        'events.Event',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='form_responses'
    )
    ticket = models.OneToOneField(
        'events.EventTicket',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='form_response'
    )
    submitter_name = models.CharField(max_length=255)
    submitter_email = models.EmailField()
    submitter_phone = models.CharField(max_length=30, blank=True)
    
    review_status = models.CharField(max_length=20, choices=ReviewStatus.choices, default=ReviewStatus.ACCEPTED)
    rejection_note = models.TextField(blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-submitted_at']

    def __str__(self):
        return f"{self.submitter_name} ({self.submitter_email})"


class FormAnswer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    response = models.ForeignKey(FormResponse, on_delete=models.CASCADE, related_name='answers')
    field = models.ForeignKey(FormField, on_delete=models.CASCADE, related_name='answers')
    value = models.JSONField(default=dict)

    class Meta:
        unique_together = [['response', 'field']]
