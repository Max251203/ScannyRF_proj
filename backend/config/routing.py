from django.urls import re_path
# ВАЖНО: без backend.
from core.ws_consumers import EditorConsumer

websocket_urlpatterns = [
    re_path(r'^ws/editor/(?P<client_id>[^/]+)/$', EditorConsumer.as_asgi()),
]