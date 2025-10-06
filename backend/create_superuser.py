import os
import sys
import django

# Добавляем корень проекта в PYTHONPATH
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
django.setup()

from django.contrib.auth import get_user_model
User = get_user_model()

ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@gmail.com')
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')

if not User.objects.filter(email=ADMIN_EMAIL).exists():
    User.objects.create_superuser(
        email=ADMIN_EMAIL,
        username=ADMIN_USERNAME,
        password=ADMIN_PASSWORD
    )
    print('Superuser created successfully!')
else:
    print('Superuser already exists.')