"""Cron (every minute or two): close unpaid online payments past their hold and release what they held.

    */2 * * * * cd /srv/eventlaya/backend && .venv/bin/python manage.py expire_payments

Before expiring, each payment is looked up with Khalti / eSewa (it may have been paid); recently expired
ones are re-checked to catch late payments, and paid-but-undelivered ones are retried.
"""
from django.core.management.base import BaseCommand

from apps.payments.services import expire_stale


class Command(BaseCommand):
    help = 'Expire unpaid online payments past their hold, catch late payments, retry deliveries.'

    def add_arguments(self, parser):
        parser.add_argument('--no-provider-check', action='store_true', help="Don't ask Khalti/eSewa first")

    def handle(self, *args, **options):
        counts = expire_stale(check_provider=not options['no_provider_check'])
        self.stdout.write(', '.join(f'{k}: {v}' for k, v in counts.items()))
