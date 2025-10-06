from django.contrib import admin
from django.urls import path, include, re_path # <-- добавь re_path
from core.views import ReactAppView # <-- добавь этот импорт

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('accounts.urls')),
    path('api/', include('cms.urls')),
    path('api/', include('core.urls')),  # utils: /api/utils/key-rate/
    re_path(r'^.*$', ReactAppView.as_view(), name='react_app'),
]