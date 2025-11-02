import os
import sys
from pathlib import Path

# Добавим пути, чтобы 'core', 'accounts', 'cms' резолвились из корня
CUR = Path(__file__).resolve()             # .../backend/config/asgi.py
BACKEND_DIR = CUR.parents[1]               # .../backend
ROOT_DIR = BACKEND_DIR.parent              # .../
for p in (str(ROOT_DIR), str(BACKEND_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

# Настраиваем Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')

import django
django.setup()

from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter

# ВАЖНО: импортируем БЕЗ префикса backend., чтобы совпадало с INSTALLED_APPS
from core.ws_auth import JWTAuthMiddlewareStack
import config.routing as routing_module


application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": JWTAuthMiddlewareStack(
        URLRouter(routing_module.websocket_urlpatterns)
    ),
})