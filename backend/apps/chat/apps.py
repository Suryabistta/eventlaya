from django.apps import AppConfig


class ChatConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.chat'
    verbose_name = 'Team chat'

    def ready(self):
        from . import signals  # noqa: F401  (event crew groups follow gate assignments)
