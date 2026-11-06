from django.core.management.base import BaseCommand

from apps.chat.crew import sync_event_crew
from apps.chat.models import Conversation
from apps.events.models import Event, StaffGateAssignment


class Command(BaseCommand):
    help = 'Create/update the event crew group chat for every event with gate staff (idempotent).'

    def handle(self, *args, **options):
        event_ids = set(StaffGateAssignment.objects.values_list('event_id', flat=True))
        event_ids |= set(Conversation.objects.filter(is_event_crew=True).values_list('event_id', flat=True))
        synced = 0
        for event in Event.objects.filter(id__in=event_ids).select_related('organizer'):
            if sync_event_crew(event):
                synced += 1
        self.stdout.write(self.style.SUCCESS(f'Synced {synced} event crew chat(s).'))
