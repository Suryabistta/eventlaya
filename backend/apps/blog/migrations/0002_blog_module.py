from django.db import migrations

# Kept here (not imported from apps.accounts.modules) so the migration never changes after it ships.
MODULE = ('blog', 'Blog', 'Public blog and guides on eventlaya.com, written by the platform team in the superadmin editor.',
          'Newspaper', 11)
ROLES = ['superadmin', 'organizer', 'staff', 'attendee', 'vendor']


def forwards(apps, schema_editor):
    PlatformModule = apps.get_model('accounts', 'PlatformModule')
    RoleModulePermission = apps.get_model('accounts', 'RoleModulePermission')
    slug, name, description, icon, order = MODULE
    module, _ = PlatformModule.objects.get_or_create(
        slug=slug, defaults={'name': name, 'description': description, 'icon': icon, 'order': order, 'is_globally_enabled': True},
    )
    # Reading is public: on for every role (visitors only need the global switch). Writing is superadmin-only anyway.
    for role in ROLES:
        RoleModulePermission.objects.get_or_create(
            role=role, module=module,
            defaults={'can_view': True, 'can_create': role == 'superadmin', 'can_edit': role == 'superadmin',
                      'can_delete': role == 'superadmin', 'is_enabled': True},
        )


def backwards(apps, schema_editor):
    apps.get_model('accounts', 'PlatformModule').objects.filter(slug='blog').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('blog', '0001_initial'),
        ('accounts', '0014_user_terms_consent'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
