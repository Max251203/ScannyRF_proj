import os
import sys
import django

# --- НАЧАЛО ИСПРАВЛЕНИЯ ---
# Добавляем корневую папку проекта (на уровень выше 'backend') в PYTHONPATH
# Это позволит Django найти модуль 'backend.config.settings'
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)
# --- КОНЕЦ ИСПРАВЛЕНИЯ ---

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
django.setup()

from django.contrib.auth import get_user_model
User = get_user_model()

# Проверяем, существует ли уже суперпользователь
if not User.objects.filter(email='admin@gmail.com').exists():
    User.objects.create_superuser(
        email='admin@gmail.com',
        username='admin', # Добавил username, т.к. он обязателен
        password='admin123'
    )
    print('Superuser created successfully!')
else:
    print('Superuser already exists.')