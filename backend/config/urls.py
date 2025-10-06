from django.contrib import admin
from django.urls import path, include, re_path
from core.views import ReactAppView

# Сначала определяем маршруты API
api_patterns = [
    path('', include('accounts.urls')),
    path('', include('cms.urls')),
    path('', include('core.urls')),
]

urlpatterns = [
    path('admin/', admin.site.urls),

    # Все API-запросы идут через /api/
    path('api/', include(api_patterns)),

    # Catch-all маршрут для React-приложения.
    # Он должен быть последним и не должен перехватывать API или админку.
    re_path(r'^.*$', ReactAppView.as_view(), name='react_app'),
]