"""ASGI entry point: HTTP goes to Django, /ws/chat/ to the team chat consumer (Django Channels).

Production: gunicorn -k uvicorn_worker.UvicornWorker config.asgi:application (see deploy/eventlaya.service).
Local with websockets: .venv/bin/uvicorn config.asgi:application --reload --port 8000
(`manage.py runserver` still serves the HTTP API, but not websockets.)

WebSocket auth is a JWT access token (not cookies), so no Origin check is applied: the mobile app
sends no Origin header and a cross-site page can't obtain the user's token.
"""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# Initialise Django before importing anything that touches models.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

from apps.chat.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': URLRouter(websocket_urlpatterns),
})
