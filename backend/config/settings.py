"""
Django settings for config project.
"""
import os
from pathlib import Path
import dj_database_url

# BASE_DIR указывает на папку 'backend'
BASE_DIR = Path(__file__).resolve().parent.parent

# --- Основные настройки ---
# Читаем напрямую из переменных окружения. SECRET_KEY обязателен.
SECRET_KEY = os.environ.get('SECRET_KEY')
# DEBUG по умолчанию False для безопасности
DEBUG = os.environ.get('DEBUG', 'False').lower() in ('true', '1', 't')
# ALLOWED_HOSTS читается из окружения, с фоллбэком для локальной разработки
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', '127.0.0.1,localhost').split(',')


# --- Приложения ---
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    # Для корректной работы whitenoise в режиме DEBUG=True
    'whitenoise.runserver_nostatic',
    'django.contrib.staticfiles',

    # Сторонние приложения
    'rest_framework',
    'corsheaders',

    # Ваши приложения
    'accounts',
    'cms',
    'core',
]

# --- Middleware ---
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    # WhiteNoise Middleware должен быть сразу после SecurityMiddleware
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

# --- Маршрутизация и шаблоны ---
# Пути теперь относительные, т.к. gunicorn запускается из папки backend
ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        # Путь к index.html собранного React-приложения
        'DIRS': [
            BASE_DIR.parent / 'frontend' / 'dist',
        ],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]


# --- База данных ---
DATABASES = {
    # dj_database_url автоматически читает переменную DATABASE_URL из окружения
    'default': dj_database_url.config(
        default=os.environ.get('DATABASE_URL', f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
        conn_max_age=600,
        conn_health_checks=True
    )
}

# --- Аутентификация и авторизация ---
AUTH_USER_MODEL = 'accounts.User'
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# --- Интернационализация ---
LANGUAGE_CODE = 'ru-ru'
TIME_ZONE = 'Europe/Moscow'
USE_I18N = True
USE_TZ = True

# --- Статические файлы ---
STATIC_URL = '/static/'
# Папка, куда `collectstatic` соберет ВСЕ статические файлы для продакшена
STATIC_ROOT = BASE_DIR.parent / 'staticfiles'
# Папки, где Django будет дополнительно искать статику (билд React)
STATICFILES_DIRS = [
    BASE_DIR.parent / 'frontend' / 'dist',
]
# Хранилище для WhiteNoise
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# --- Прочие настройки ---
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ('rest_framework_simplejwt.authentication.JWTAuthentication',),
}
# Настройка CORS будет переопределена для продакшена
CORS_ALLOW_ALL_ORIGINS = True

# --- Настройки E-mail и OAuth ---
EMAIL_BACKEND = os.environ.get('EMAIL_BACKEND', 'django.core.mail.backends.smtp.EmailBackend')
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'no-reply@example.com')
EMAIL_HOST = os.environ.get('EMAIL_HOST', '')
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', 587))
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', 'True').lower() in ('true', '1', 't')
EMAIL_USE_SSL = os.environ.get('EMAIL_USE_SSL', 'False').lower() in ('true', '1', 't')
if EMAIL_USE_SSL:
    EMAIL_USE_TLS = False

GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
FACEBOOK_APP_ID = os.environ.get('FACEBOOK_APP_ID', '')
FACEBOOK_APP_SECRET = os.environ.get('FACEBOOK_APP_SECRET', '')
VK_SERVICE_KEY = os.environ.get('VK_SERVICE_KEY', '')


# ==============================================================================
# НАСТРОЙКИ СПЕЦИАЛЬНО ДЛЯ ПРОДАКШЕНА (OnRender)
# ==============================================================================
if 'RENDER' in os.environ:
    DEBUG = False
    
    RENDER_EXTERNAL_HOSTNAME = os.environ.get('RENDER_EXTERNAL_HOSTNAME')
    if RENDER_EXTERNAL_HOSTNAME:
        ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)
        CORS_ALLOWED_ORIGINS = [f"https://{RENDER_EXTERNAL_HOSTNAME}"]
        CSRF_TRUSTED_ORIGINS = [f"https://{RENDER_EXTERNAL_HOSTNAME}"]
    else:
        # Если домен не определен, разрешаем все для отладки
        CORS_ALLOW_ALL_ORIGINS = True
    
    # Django доверяет заголовкам от прокси-сервера Render
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True