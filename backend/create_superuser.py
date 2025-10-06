import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
django.setup()

from django.contrib.auth import get_user_model
User = get_user_model()

# Проверяем, существует ли уже суперпользователь
if not User.objects.filter(email='admin@gmail.com').exists():
    User.objects.create_superuser(
        email='admin@gmail.com',
        password='dmin123',
        name = 'admin'
    )
    print('Superuser created successfully!')
else:
    print('Superuser already exists.')