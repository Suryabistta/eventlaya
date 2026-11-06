from django.db import migrations

# Kept here (not imported from apps.accounts.modules) so the migration never changes after it ships.
MODULES = [
    ('events', 'Events Management', 'Create, manage, and monitor live events and attendee capacity.', 'Calendar', 1),
    ('gate_scanner', 'Gate QR Scanner Terminal', 'Real-time entry/exit QR scanning, attendee roster, and fraud detection.', 'QrCode', 2),
    ('dynamic_forms', 'Dynamic Registration Forms', 'Custom form builder with 10 question types and live preview canvas.', 'FormInput', 3),
    ('voting', 'Live Audience Voting & Polls', 'One-person-one-vote live polling with instant tallies.', 'Vote', 4),
    ('marketplace', 'Vendor Services Marketplace', 'Vendor and venue directory, inquiries and listings.', 'Store', 5),
    ('staff_management', 'Gate Staff & Team', 'Onboard team members and assign them to gates.', 'Users', 6),
    ('chat', 'Team Chat', 'Personal and group chat between organizers and their team.', 'MessageCircle', 7),
    ('reviews', 'Reviews & Ratings', 'Attendees review events they attended and vendors or venues they contacted.', 'Star', 8),
]
ROLES = ['superadmin', 'organizer', 'staff', 'attendee', 'vendor']
# Chat is for organizers and their team only; every other module starts on for every role.
OFF_BY_DEFAULT = {('chat', 'attendee'), ('chat', 'vendor')}


def seed(apps, schema_editor):
    PlatformModule = apps.get_model('accounts', 'PlatformModule')
    RoleModulePermission = apps.get_model('accounts', 'RoleModulePermission')
    for slug, name, description, icon, order in MODULES:
        module, _ = PlatformModule.objects.get_or_create(
            slug=slug,
            defaults={'name': name, 'description': description, 'icon': icon, 'order': order, 'is_globally_enabled': True},
        )
        for role in ROLES:
            manager = role in ('superadmin', 'organizer')
            RoleModulePermission.objects.get_or_create(
                role=role, module=module,
                defaults={
                    'can_view': manager or (slug, role) not in OFF_BY_DEFAULT,
                    'can_create': manager,
                    'can_edit': manager,
                    'can_delete': role == 'superadmin',
                    'is_enabled': (slug, role) not in OFF_BY_DEFAULT,
                },
            )


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0009_timestamps'),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
