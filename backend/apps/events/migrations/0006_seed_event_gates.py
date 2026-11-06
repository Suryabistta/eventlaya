from django.db import migrations

# Free-text labels some clients send that are not physical gates
PSEUDO_GATES = {'manual terminal', 'admin override', ''}


def seed_gates(apps, schema_editor):
    Event = apps.get_model('events', 'Event')
    EventGate = apps.get_model('events', 'EventGate')
    GateScanLog = apps.get_model('events', 'GateScanLog')
    StaffGateAssignment = apps.get_model('events', 'StaffGateAssignment')

    for event in Event.objects.all():
        names = []
        for name in list(StaffGateAssignment.objects.filter(event=event).values_list('gate_name', flat=True)) + list(
            GateScanLog.objects.filter(event=event).values_list('gate_name', flat=True)
        ):
            name = (name or '').strip()
            if name.lower() in PSEUDO_GATES or name.lower() in [n.lower() for n in names]:
                continue
            names.append(name)
        if not names:
            names = ['Main gate']

        by_name = {}
        for i, name in enumerate(names):
            gate, _ = EventGate.objects.get_or_create(event=event, name=name, defaults={'order': i})
            by_name[name.lower()] = gate

        for a in StaffGateAssignment.objects.filter(event=event, gate__isnull=True):
            gate = by_name.get((a.gate_name or '').strip().lower())
            if gate:
                a.gate = gate
                a.save(update_fields=['gate'])
        for name, gate in by_name.items():
            GateScanLog.objects.filter(event=event, gate__isnull=True, gate_name__iexact=gate.name).update(gate=gate)


class Migration(migrations.Migration):
    dependencies = [('events', '0005_event_gates')]
    operations = [migrations.RunPython(seed_gates, migrations.RunPython.noop)]
