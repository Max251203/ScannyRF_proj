import os
import sys
import django
from django.db.models import Q # <-- Импортируйте Q

# --- Добавляем корень проекта в PYTHONPATH ---
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
django.setup()

from django.contrib.auth import get_user_model
User = get_user_model()

# Данные для создания суперпользователя
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@gmail.com')
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'dmin123')

# --- ИСПРАВЛЕНИЕ: Проверяем и по email, и по username ---
if not User.objects.filter(Q(email=ADMIN_EMAIL) | Q(username=ADMIN_USERNAME)).exists():
    User.objects.create_superuser(
        email=ADMIN_EMAIL,
        username=ADMIN_USERNAME,
        password=ADMIN_PASSWORD
    )
    print('Superuser created successfully!')
else:
    print('Superuser with this email or username already exists.') # <-- Обновили сообщение