from django.core.management.base import BaseCommand

from apps.events.guests import send_due_reminders


class Command(BaseCommand):
    help = 'Email guests the day before and ~2 hours before their event (run every 10 minutes).'

    def handle(self, *args, **options):
        self.stdout.write(f'{send_due_reminders()} reminder emails sent')
