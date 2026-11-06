from django.apps import AppConfig

class EventsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.events'

    def ready(self):
        from . import online_payments  # noqa: F401  registers the 'ticket_order' payment purpose
