from django.db import migrations

# The list the frontend used to hard-code, in the same order
DEFAULT_CITIES = ['Dharan', 'Itahari', 'Biratnagar', 'Damak', 'Kathmandu']


def seed(apps, schema_editor):
    City = apps.get_model('platform', 'City')
    names = list(DEFAULT_CITIES)
    # Keep every city already typed on a profile or listing so nothing falls out of the filters
    for model, field in (('marketplace', 'VendorProfile'), ('marketplace', 'VenueListing'), ('accounts', 'User')):
        for value in apps.get_model(model, field).objects.values_list('city', flat=True).distinct():
            value = (value or '').strip()
            if value and value.lower() not in {n.lower() for n in names}:
                names.append(value)
    for i, name in enumerate(names):
        City.objects.get_or_create(name=name, defaults={'order': i})


class Migration(migrations.Migration):
    dependencies = [
        ('platform', '0006_city'),
        ('marketplace', '0008_listing_is_paused'),
        ('accounts', '0014_user_terms_consent'),
    ]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
