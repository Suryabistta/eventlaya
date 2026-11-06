from django.apps import AppConfig


class VotingConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.voting'

    def ready(self):
        from . import seo_pages, vote_payments  # noqa: F401 — seo_pages registers contest link previews
        vote_payments.register()  # payment purpose 'vote_pack' (paid votes in contests)
