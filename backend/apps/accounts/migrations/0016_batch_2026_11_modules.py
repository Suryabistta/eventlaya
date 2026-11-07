from django.db import migrations

# Kept here (not imported from apps.accounts.modules) so the migration never changes after it ships.
MODULES = [
    ('banners', 'Marketplace banners', 'Sliding banner images at the top of the marketplace, uploaded by the platform team.',
     'GalleryHorizontal', 15, {'organizer', 'staff', 'attendee', 'vendor'}),
    ('seat_numbers', 'Seat numbers', 'Organizers assign seat numbers to tickets and choose whether attendees see them.',
     'Armchair', 16, {'organizer', 'staff', 'attendee'}),
    ('packages', 'Vendor & venue packages', 'Vendors and venues publish priced packages that customers can ask about.',
     'Package', 17, {'organizer', 'vendor', 'attendee'}),
    ('sub_events', 'Sub-events', 'A main event with child events, each with its own registration form and tickets.',
     'ListTree', 18, {'organizer', 'staff', 'attendee'}),
]
ROLES = ['superadmin', 'organizer', 'staff', 'attendee', 'vendor']


def seed(apps, schema_editor):
    PlatformModule = apps.get_model('accounts', 'PlatformModule')
    RoleModulePermission = apps.get_model('accounts', 'RoleModulePermission')
    for slug, name, description, icon, order, on_for in MODULES:
        module, _ = PlatformModule.objects.get_or_create(
            slug=slug,
            defaults={'name': name, 'description': description, 'icon': icon, 'order': order, 'is_globally_enabled': True},
        )
        for role in ROLES:
            on = role == 'superadmin' or role in on_for
            manager = role in ('superadmin', 'organizer', 'vendor') and on
            RoleModulePermission.objects.get_or_create(
                role=role, module=module,
                defaults={'can_view': on, 'can_create': manager, 'can_edit': manager, 'can_delete': role == 'superadmin', 'is_enabled': on},
            )


class Migration(migrations.Migration):
    dependencies = [('accounts', '0015_verified_and_admin_password_reset')]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
