import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.conf import settings

class User(AbstractUser):
    class Role(models.TextChoices):
        SUPERADMIN = 'superadmin', 'Superadmin / Platform Admin'
        ORGANIZER = 'organizer', 'Organizer'
        STAFF = 'staff', 'Staff / Gate Scanner'
        ATTENDEE = 'attendee', 'Attendee'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=20, blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.ORGANIZER)
    organization_name = models.CharField(max_length=255, blank=True)
    avatar = models.ImageField(upload_to='avatars/', null=True, blank=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    def __str__(self):
        return self.email or self.username

    @property
    def is_superadmin(self):
        return self.role == self.Role.SUPERADMIN or self.is_superuser


class PlatformModule(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=64, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=64, default='Layers')
    is_globally_enabled = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'name']

    def __str__(self):
        return f"{self.name} [{'ENABLED' if self.is_globally_enabled else 'DISABLED'}]"


class RoleModulePermission(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.CharField(max_length=20, choices=User.Role.choices)
    module = models.ForeignKey(PlatformModule, on_delete=models.CASCADE, related_name='role_permissions')
    can_view = models.BooleanField(default=True)
    can_create = models.BooleanField(default=False)
    can_edit = models.BooleanField(default=False)
    can_delete = models.BooleanField(default=False)
    is_enabled = models.BooleanField(default=True)

    class Meta:
        unique_together = [['role', 'module']]
        ordering = ['role', 'module__order']

    def __str__(self):
        return f"{self.role} → {self.module.name} ({'ON' if self.is_enabled else 'OFF'})"



class FCMToken(models.Model):
    PLATFORM_CHOICES = [('android', 'Android'), ('ios', 'iOS'), ('web', 'Web')]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='fcm_tokens')
    token = models.TextField(unique=True)
    platform = models.CharField(max_length=10, choices=PLATFORM_CHOICES, default='android')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.user.email} [{self.platform}]"
