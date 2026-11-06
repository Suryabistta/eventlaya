from django.db import migrations

# Kept here (not imported from apps.accounts.modules) so the migration never changes after it ships.
MODULE = ('payments', 'Online payments', 'Khalti and eSewa checkout (tickets first); payments reports and payouts.',
          'CreditCard', 10)
ROLES = ['superadmin', 'organizer', 'staff', 'attendee', 'vendor']
# Organizers take payments, attendees pay; superadmins see everything.
ON_FOR = {'superadmin', 'organizer', 'attendee'}


def forwards(apps, schema_editor):
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


def backwards(apps, schema_editor):
    apps.get_model('accounts', 'PlatformModule').objects.filter(slug='payments').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0001_initial'),
        ('accounts', '0010_seed_platform_modules'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
