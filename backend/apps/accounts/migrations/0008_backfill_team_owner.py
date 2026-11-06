from django.db import migrations


def backfill(apps, schema_editor):
    """Put existing staff on the team of the organizer whose event they were assigned to."""
    User = apps.get_model('accounts', 'User')
    Assignment = apps.get_model('events', 'StaffGateAssignment')
    for staff in User.objects.filter(role='staff', team_owner__isnull=True):
        a = Assignment.objects.filter(staff=staff).select_related('event').order_by('-created_at').first()
        if a and a.event.organizer_id:
            staff.team_owner_id = a.event.organizer_id
            staff.save(update_fields=['team_owner'])


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0007_user_team_owner'),
        ('events', '0007_event_page_content'),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
