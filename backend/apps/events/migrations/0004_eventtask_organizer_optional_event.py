import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def backfill_organizer(apps, schema_editor):
    EventTask = apps.get_model('events', 'EventTask')
    for task in EventTask.objects.filter(organizer__isnull=True).select_related('event'):
        if task.event_id:
            task.organizer_id = task.event.organizer_id
            task.save(update_fields=['organizer'])
    # Tasks with no event and no owner can't be attributed to anyone
    EventTask.objects.filter(organizer__isnull=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0003_eventfunding_eventtask'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='eventtask',
            name='organizer',
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='owned_tasks',
                to=settings.AUTH_USER_MODEL,
                help_text='Owner of the task (the organizer workspace it belongs to).',
            ),
        ),
        migrations.RunPython(backfill_organizer, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='eventtask',
            name='organizer',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='owned_tasks',
                to=settings.AUTH_USER_MODEL,
                help_text='Owner of the task (the organizer workspace it belongs to).',
            ),
        ),
        migrations.AlterField(
            model_name='eventtask',
            name='event',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='tasks', to='events.event'
            ),
        ),
        migrations.AddField(
            model_name='eventtask',
            name='assignee_email',
            field=models.EmailField(blank=True, max_length=254),
        ),
        migrations.AddField(
            model_name='eventtask',
            name='due_date',
            field=models.DateField(blank=True, null=True),
        ),
    ]
