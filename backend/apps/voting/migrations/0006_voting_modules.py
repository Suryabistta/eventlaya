from django.db import migrations

# Kept here (not imported from apps.accounts.modules) so the migration never changes after it ships.
VOTING = ('voting', 'Voting', 'Master switch for all voting: quick audience polls, and contests when those are on.')
OLD_VOTING = ('Live Audience Voting & Polls', 'One-person-one-vote live polling with instant tallies.')
MODULES = [
    # slug, name, description, icon, order, roles it is on for
    ('contests', 'Pageant & contests', 'Contests with numbered contestants, categories, rounds, public contest pages and '
     'the presenter. Requires Voting.', 'Crown', 12, {'superadmin', 'organizer', 'attendee'}),
    ('judging', "Judges' scoring", "Judges score contestants; judges' scores count in contest results. Requires Pageant & "
     'contests.', 'Gavel', 13, {'superadmin', 'organizer', 'attendee', 'staff'}),
    ('paid_votes', 'Paid votes', 'Voters buy vote packs in contests. Requires Pageant & contests and Online payments.',
     'Coins', 14, {'superadmin', 'organizer', 'attendee'}),
]
ROLES = ['superadmin', 'organizer', 'staff', 'attendee', 'vendor']


def forwards(apps, schema_editor):
    PlatformModule = apps.get_model('accounts', 'PlatformModule')
    RoleModulePermission = apps.get_model('accounts', 'RoleModulePermission')
    slug, name, description = VOTING
    PlatformModule.objects.filter(slug=slug).update(name=name, description=description)
    for slug, name, description, icon, order, on_for in MODULES:
        module, _ = PlatformModule.objects.get_or_create(
            slug=slug, defaults={'name': name, 'description': description, 'icon': icon, 'order': order, 'is_globally_enabled': True},
        )
        for role in ROLES:
            on = role in on_for
            RoleModulePermission.objects.get_or_create(
                role=role, module=module,
                defaults={'can_view': on, 'can_create': on, 'can_edit': on, 'can_delete': role == 'superadmin', 'is_enabled': on},
            )


def backwards(apps, schema_editor):
    PlatformModule = apps.get_model('accounts', 'PlatformModule')
    PlatformModule.objects.filter(slug__in=[m[0] for m in MODULES]).delete()
    PlatformModule.objects.filter(slug='voting').update(name=OLD_VOTING[0], description=OLD_VOTING[1])


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0010_seed_platform_modules'),
        ('voting', '0005_vote_purchases'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
