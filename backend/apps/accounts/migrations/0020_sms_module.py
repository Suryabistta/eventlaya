from django.db import migrations

# Kept here (not imported from apps.accounts.modules) so the migration never changes after it ships.
MODULE = ('sms', 'SMS messages', 'Text messages to contestants and guests, paid from SMS credits: included with the plan '
          'and topped up on request.', 'MessageSquareText', 22)
ROLES = ['superadmin', 'organizer', 'staff', 'attendee', 'vendor']
ON_FOR = {'superadmin', 'organizer'}


def seed(apps, schema_editor):
    PlatformModule = apps.get_model('accounts', 'PlatformModule')
    RoleModulePermission = apps.get_model('accounts', 'RoleModulePermission')
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


class Migration(migrations.Migration):
    dependencies = [('accounts', '0019_guest_management_module')]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
