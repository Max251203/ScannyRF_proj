from django.contrib import admin
from django.urls import path, include, re_path
from core.views import ReactAppView
from django.conf import settings # <-- Импортируем настройки

api_patterns = [
    path('', include('accounts.urls')),
    path('', include('cms.urls')),
    path('', include('core.urls')),
]

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include(api_patterns)),
]

# --- ИСПРАВЛЕНИЕ ---
# Мы добавляем catch-all только если DEBUG=False.
# В режиме DEBUG Django сам умеет раздавать статику.
if not settings.DEBUG:
    urlpatterns += [
        re_path(r'^.*$', ReactAppView.as_view(), name='react_app'),
    ]