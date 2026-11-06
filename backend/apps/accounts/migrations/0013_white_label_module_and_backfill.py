import secrets

from django.db import migrations

# Kept here (not imported from apps.accounts.modules) so the migration never changes after it ships.
MODULE = ('white_label', 'White-label sites', 'Organizer sites on their own domain or <name>.eventlaya.com, with their brand.',
          'Globe', 9)
ROLES = ['superadmin', 'organizer', 'staff', 'attendee', 'vendor']
# Only organizers run white-label sites (and superadmins manage them).
ON_FOR = {'superadmin', 'organizer'}


def forwards(apps, schema_editor):
    PlatformModule = apps.get_model('accounts', 'PlatformModule')
    RoleModulePermission = apps.get_model('accounts', 'RoleModulePermission')
    TenantBranding = apps.get_model('accounts', 'TenantBranding')

    slug, name, description, icon, order = MODULE
    module, _ = PlatformModule.objects.get_or_create(
        slug=slug, defaults={'name': name, 'description': description, 'icon': icon, 'order': order, 'is_globally_enabled': True},
    )
    for role in ROLES:
        on = role in ON_FOR
        RoleModulePermission.objects.get_or_create(
            role=role, module=module,
            defaults={'can_view': on, 'can_create': on, 'can_edit': on, 'can_delete': role == 'superadmin', 'is_enabled': on},
        )

    # The old "verify" button marked any string with a dot as verified + SSL active without looking at DNS.
    # Everyone with a custom domain goes back to "waiting for DNS" and is re-checked for real.
    for b in TenantBranding.objects.all():
        b.verification_token = b.verification_token or secrets.token_hex(16)
        b.cname_target = 'tenants.eventlaya.com'
        if b.custom_domain:
            b.is_domain_verified = False
            b.ssl_active = False
            b.dns_status = 'pending'
        else:
            b.dns_status = 'none'
        b.save(update_fields=['verification_token', 'cname_target', 'is_domain_verified', 'ssl_active', 'dns_status'])


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0012_tenant_domain_status'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
