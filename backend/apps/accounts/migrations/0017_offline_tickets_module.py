from django.db import migrations

# Kept here (not imported from apps.accounts.modules) so the migration never changes after it ships.
MODULE = ('offline_tickets', 'Printed tickets', 'Bulk printed tickets with QR codes for shop, counter and door sales; '
          'scanned at the gate like online passes.', 'Printer', 19)
ROLES = ['superadmin', 'organizer', 'staff', 'attendee', 'vendor']
ON_FOR = {'superadmin', 'organizer', 'staff'}


def seed(apps, schema_editor):
    PlatformModule = apps.get_model('accounts', 'PlatformModule')
    RoleModulePermission = apps.get_model('accounts', 'RoleModulePermission')
    slug, name, description, icon, order = MODULE
    module, _ = PlatformModule.objects.get_or_create(
        slug=slug, defaults={'name': name, 'description': description, 'icon': icon, 'order': order, 'is_globally_enabled': True},
    )
    for role in ROLES:
        on = role in ON_FOR
        manager = role in ('superadmin', 'organizer')
        RoleModulePermission.objects.get_or_create(
            role=role, module=module,
            defaults={'can_view': on, 'can_create': manager, 'can_edit': manager, 'can_delete': role == 'superadmin', 'is_enabled': on},
        )


class Migration(migrations.Migration):
    dependencies = [('accounts', '0016_batch_2026_11_modules')]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
