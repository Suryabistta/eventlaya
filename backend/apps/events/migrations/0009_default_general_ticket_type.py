from django.db import migrations


def forwards(apps, schema_editor):
    """Every existing event gets one "General" ticket type at its current price; its tickets move onto it."""
    Event = apps.get_model('events', 'Event')
    TicketType = apps.get_model('events', 'TicketType')
    EventTicket = apps.get_model('events', 'EventTicket')
    for event in Event.objects.all():
        if TicketType.objects.filter(event=event).exists():
            continue
        price = event.ticket_price if event.is_paid else 0
        tt = TicketType.objects.create(event=event, name='General', price=price, order=0)
        EventTicket.objects.filter(event=event, ticket_type__isnull=True).update(
            ticket_type=tt, ticket_type_name='General', price=price,
        )


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0008_ticket_types_promo_codes'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
