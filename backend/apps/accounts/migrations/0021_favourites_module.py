from django.db import migrations

# Kept here (not imported from apps.accounts.modules) so the migration never changes after it ships.
MODULE = ('favourites', 'Saved events', 'Signed-in people save events they like and find them again on any device.', 'Heart', 23)
ROLES = ['superadmin', 'organizer', 'staff', 'attendee', 'vendor']


def seed(apps, schema_editor):
    PlatformModule = apps.get_model('accounts', 'PlatformModule')
    RoleModulePermission = apps.get_model('accounts', 'RoleModulePermission')
    slug, name, description, icon, order = MODULE
    module, _ = PlatformModule.objects.get_or_create(
        slug=slug, defaults={'name': name, 'description': description, 'icon': icon, 'order': order, 'is_globally_enabled': True},
    )
    for role in ROLES:
        RoleModulePermission.objects.get_or_create(
            role=role, module=module,
            defaults={'can_view': True, 'can_create': True, 'can_edit': True, 'can_delete': True, 'is_enabled': True},
        )


class Migration(migrations.Migration):
    dependencies = [('accounts', '0020_sms_module')]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
