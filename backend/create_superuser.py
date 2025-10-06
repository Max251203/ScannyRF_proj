import os
import sys
import django

# --- ИСПРАВЛЕНИЕ: Добавляем корень проекта в пути Python ---
# Это нужно, чтобы Django мог найти модуль 'backend.config.settings'
# __file__ -> backend/create_superuser.py
# os.path.dirname(__file__) -> backend/
# os.path.dirname(os.path.dirname...) -> корень проекта
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)
# --- КОНЕЦ ИСПРАВЛЕНИЯ ---

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
django.setup()

from django.contrib.auth import get_user_model
User = get_user_model()

# Данные для создания суперпользователя
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@gmail.com')
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'dmin123')

# Проверяем, существует ли уже суперпользователь
if not User.objects.filter(email=ADMIN_EMAIL).exists():
    User.objects.create_superuser(
        email=ADMIN_EMAIL,
        username=ADMIN_USERNAME,
        password=ADMIN_PASSWORD
    )
    print('Superuser created successfully!')
else:
    print('Superuser already exists.')