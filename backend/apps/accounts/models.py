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
        VENDOR = 'vendor', 'Vendor / Marketplace business'

    class MarketplaceAccess(models.TextChoices):
        NONE = 'none', 'No access'
        PENDING = 'pending', 'Requested'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=20, blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.ORGANIZER)
    organization_name = models.CharField(max_length=255, blank=True)
    avatar = models.ImageField(upload_to='avatars/', null=True, blank=True)
    # Set at sign-up; vendors pick what they offer (venue, sound_stage, ...). See marketplace BusinessType.
    business_type = models.CharField(max_length=30, blank=True)
    city = models.CharField(max_length=100, blank=True)
    marketplace_access = models.CharField(
        max_length=20, choices=MarketplaceAccess.choices, default=MarketplaceAccess.NONE,
        help_text='Whether this account may run a marketplace business portal (listings & inquiries).',
    )
    # Gate staff belong to the organizer who onboarded them (their team roster).
    team_owner = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.SET_NULL, related_name='team_members',
        help_text='For staff accounts: the organizer whose team this person is on.',
    )
    # Proven by a 6-digit email code (apps.accounts.verification) or a social login with a provider-verified email.
    # Tickets registered under this email are attached to the account once it is verified.
    email_verified = models.BooleanField(default=False)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    # Consent to the Terms of Service + Privacy Policy (eventlaya.com/terms, /privacy): when, and which version
    # (settings.TERMS_VERSION). Set on email sign-up (the "I agree" box) and on the first Google/Facebook sign-in
    # ("By continuing you agree…"). Null for accounts created before consent was recorded or by an admin.
    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    terms_version = models.CharField(max_length=20, blank=True)
    # Blue tick on the organization's name; set only by a platform admin
    is_verified = models.BooleanField(default=False)
    # Set when a platform admin gives out a temporary password; cleared when the user picks their own
    must_change_password = models.BooleanField(default=False)
    # Tokens issued before this moment are rejected (admin password reset signs the user out everywhere)
    sessions_valid_after = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    def __str__(self):
        return self.email or self.username

    def accept_terms(self, save=True):
        """Record consent to the current Terms of Service and Privacy Policy."""
        from django.utils import timezone
        self.terms_accepted_at = timezone.now()
        self.terms_version = settings.TERMS_VERSION
        if save and self.pk:
            self.save(update_fields=['terms_accepted_at', 'terms_version', 'updated_at'])

    def revoke_sessions(self, save=True):
        """Sign this user out on every device (see apps.accounts.authentication)."""
        from django.utils import timezone
        self.sessions_valid_after = timezone.now()
        if save:
            self.save(update_fields=['sessions_valid_after', 'updated_at'])

    @property
    def is_superadmin(self):
        return self.role == self.Role.SUPERADMIN or self.is_superuser

    @property
    def has_marketplace_access(self):
        """Vendors, approved organizers and platform admins can manage marketplace listings."""
        return (
            self.role == self.Role.VENDOR
            or self.marketplace_access == self.MarketplaceAccess.APPROVED
            or self.is_superadmin
        )


class EmailVerificationCode(models.Model):
    """A 6-digit code emailed to prove the user owns their address. Only a hash of the code is stored."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='email_codes')
    email = models.EmailField(help_text='Address the code was sent to')
    code_hash = models.CharField(max_length=128)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.email} ({'used' if self.used_at else 'open'})"


class SocialAccount(models.Model):
    """A Google / Facebook identity linked to a user (one user can link several)."""

    class Provider(models.TextChoices):
        GOOGLE = 'google', 'Google'
        FACEBOOK = 'facebook', 'Facebook'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='social_accounts')
    provider = models.CharField(max_length=20, choices=Provider.choices)
    provider_uid = models.CharField(max_length=255, help_text="The provider's stable user id (Google 'sub', Facebook user id)")
    email = models.EmailField(blank=True)
    last_login_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['provider', 'created_at']
        constraints = [
            models.UniqueConstraint(fields=['provider', 'provider_uid'], name='unique_social_identity'),
        ]

    def __str__(self):
        return f"{self.provider}:{self.provider_uid} → {self.user}"


class PlatformModule(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=64, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=64, default='Layers')
    is_globally_enabled = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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


class TenantBranding(models.Model):
    class DnsStatus(models.TextChoices):
        NONE = 'none', 'No custom domain'
        PENDING = 'pending', 'Waiting for DNS'
        VERIFIED = 'verified', 'Verified'
        FAILED = 'failed', 'Check failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organizer = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='tenant_branding')
    subdomain = models.CharField(max_length=64, unique=True, db_index=True)
    custom_domain = models.CharField(max_length=255, unique=True, null=True, blank=True, db_index=True)
    cname_target = models.CharField(max_length=255, default='tenants.eventlaya.com',
                                    help_text='Legacy; the live target is settings.WHITELABEL_CNAME_TARGET')
    is_domain_verified = models.BooleanField(default=False, help_text='DNS proves the domain is theirs and points at us')
    ssl_active = models.BooleanField(default=False, help_text='HTTPS certificate is live for the custom domain')

    # Domain verification (apps.accounts.domains): CNAME → WHITELABEL_CNAME_TARGET and TXT _eventlaya.<domain> = token
    verification_token = models.CharField(max_length=64, blank=True)
    dns_status = models.CharField(max_length=20, choices=DnsStatus.choices, default=DnsStatus.NONE)
    dns_message = models.TextField(blank=True)
    dns_checked_at = models.DateTimeField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)

    # Certificate provisioning (apps.accounts.cloudflare): 'cloudflare' = Cloudflare for SaaS API, 'manual' = dashboard
    ssl_provider = models.CharField(max_length=20, blank=True)
    provider_hostname_id = models.CharField(max_length=64, blank=True)
    provider_status = models.CharField(max_length=40, blank=True)
    provider_ssl_status = models.CharField(max_length=40, blank=True)
    provider_message = models.TextField(blank=True)
    provider_synced_at = models.DateTimeField(null=True, blank=True)

    brand_name = models.CharField(max_length=255, blank=True)
    brand_logo = models.CharField(max_length=500, blank=True)
    primary_color = models.CharField(max_length=20, default='#4F46E5')
    accent_color = models.CharField(max_length=20, default='#06B6D4')
    custom_css = models.TextField(blank=True)
    support_email = models.EmailField(blank=True)
    footer_text = models.CharField(max_length=255, blank=True)
    remove_watermark = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.brand_name or self.subdomain} ({self.custom_domain or self.subdomain + '.eventlaya.com'})"

    def save(self, *args, **kwargs):
        if not self.verification_token:
            import secrets
            self.verification_token = secrets.token_hex(16)
            if kwargs.get('update_fields') is not None:
                kwargs['update_fields'] = list(kwargs['update_fields']) + ['verification_token']
        super().save(*args, **kwargs)

