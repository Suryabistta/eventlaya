"""Keep event crew groups in sync with gate assignments and event titles."""
import threading

from django.db.models.signals import post_delete, post_save, pre_delete
from django.dispatch import receiver

from apps.events.models import Event, StaffGateAssignment

from .crew import detach_event_crew, rename_event_crew, sync_event_crew

# Events being deleted in this thread: their assignments cascade away, and we must not re-create a crew.
_deleting = threading.local()


def _deleting_ids():
    if not hasattr(_deleting, 'ids'):
        _deleting.ids = set()
    return _deleting.ids


@receiver(post_save, sender=StaffGateAssignment, dispatch_uid='chat_crew_assignment_saved')
def assignment_saved(sender, instance, raw=False, **kwargs):
    if raw:
        return
    event = Event.objects.select_related('organizer').filter(pk=instance.event_id).first()
    if event:
        sync_event_crew(event)


@receiver(post_delete, sender=StaffGateAssignment, dispatch_uid='chat_crew_assignment_deleted')
def assignment_deleted(sender, instance, **kwargs):
    if instance.event_id in _deleting_ids():
        return
    event = Event.objects.select_related('organizer').filter(pk=instance.event_id).first()
    if event:
        sync_event_crew(event)


@receiver(post_save, sender=Event, dispatch_uid='chat_crew_event_saved')
def event_saved(sender, instance, created=False, raw=False, **kwargs):
    if not created and not raw:
        rename_event_crew(instance)


@receiver(pre_delete, sender=Event, dispatch_uid='chat_crew_event_deleting')
def event_deleting(sender, instance, **kwargs):
    _deleting_ids().add(instance.pk)
    detach_event_crew(instance)


@receiver(post_delete, sender=Event, dispatch_uid='chat_crew_event_deleted')
def event_deleted(sender, instance, **kwargs):
    _deleting_ids().discard(instance.pk)
