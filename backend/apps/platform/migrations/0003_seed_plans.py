from django.db import migrations

PLANS = [
    ('free', 'Free', 0, 0, 150, 1, [
        'Online registration form', 'QR code passes for every attendee', 'Web scanner on any phone camera',
        'Attendee list and CSV export', 'One admin account', 'Up to 150 attendees per event',
    ]),
    ('event_pro', 'Event Pro', 1499, 14390, None, 2, [
        'Everything in Free', 'Unlimited attendees', 'Registration form builder with 10 field types',
        'Gate in and gate out analytics', 'Gate staff assignments and scanner accounts',
        'Duplicate pass alerts at the gate', 'Your logo and colours on passes',
    ]),
    ('business', 'Business', 3999, 38390, None, 3, [
        'Everything in Event Pro', 'Several events running at once', 'Live audience voting and polls',
        'Budget and expense tracking', 'Crew task board', 'Push announcements to gate staff',
        'Priority phone and WhatsApp support in Eastern Nepal',
    ]),
    ('enterprise', 'Enterprise', None, None, None, 4, [
        'Everything in Business', 'Custom domain (events.yourdomain.com)', 'Remove “Powered by Eventlaya”',
        'Module permissions for your admins', 'Automatic CNAME setup and free SSL', 'Android scanner app',
        'SLA and on-site gate support in Koshi Province',
    ]),
]


def seed(apps, schema_editor):
    Plan = apps.get_model('platform', 'Plan')
    for code, name, monthly, yearly, limit, order, features in PLANS:
        Plan.objects.update_or_create(code=code, defaults={
            'name': name, 'monthly_price': monthly, 'yearly_price': yearly,
            'attendee_limit': limit, 'order': order, 'features': features, 'is_active': True,
        })


class Migration(migrations.Migration):
    dependencies = [('platform', '0002_plan_planchangerequest_subscription_payment')]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
