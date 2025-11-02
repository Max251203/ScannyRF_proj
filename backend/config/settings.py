import os
from pathlib import Path

import dj_database_url
from decouple import Config, RepositoryEnv
from django.core.exceptions import ImproperlyConfigured

# BASE_DIR указывает на папку 'backend'
BASE_DIR = Path(__file__).resolve().parent.parent

# decouple ищет .env в папке `backend`
config = Config(RepositoryEnv(str(BASE_DIR / '.env')))

# --- Основные настройки ---
SECRET_KEY = config('SECRET_KEY')
DEBUG = config('DEBUG', default=False, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='127.0.0.1,localhost').split(',')

# --- Приложения ---
INSTALLED_APPS = [
    # Django
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',

    # WhiteNoise для статики в DEBUG=False
    'whitenoise.runserver_nostatic',
    'django.contrib.staticfiles',

    # Сторонние
    'rest_framework',
    'corsheaders',
    'channels',  # WebSockets

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
ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'  # channels entrypoint

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        # Django будет искать index.html в папке, куда Vite собирает билд
        'DIRS': [
            BASE_DIR / 'static',
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

# --- База данных: ТОЛЬКО PostgreSQL ---
def _pg_from_env():
    """
    Возвращает конфиг БД из DATABASE_URL или PG_* переменных.
    Если ничего не задано — бросаем ImproperlyConfigured.
    """
    url = os.environ.get('DATABASE_URL') or config('DATABASE_URL', default='')
    if url:
        return dj_database_url.parse(url, conn_max_age=600, conn_health_checks=True)

    name = config('PG_NAME', default='')
    user = config('PG_USER', default='')
    password = config('PG_PASS', default='')
    host = config('PG_HOST', default='')
    port = config('PG_PORT', default='')

    if name and user and host:
        return {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': name,
            'USER': user,
            'PASSWORD': password,
            'HOST': host,
            'PORT': port,
            'CONN_MAX_AGE': 600,
        }

    raise ImproperlyConfigured(
        'PostgreSQL is required. Please set DATABASE_URL or PG_* environment variables.'
    )

DATABASES = {
    'default': _pg_from_env()
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
STATIC_ROOT = BASE_DIR / 'staticfiles'
# Папка, где лежит React-билд
STATICFILES_DIRS = [
    BASE_DIR / 'static',
]
# Хранилище для WhiteNoise
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# --- Прочие настройки ---
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ('rest_framework_simplejwt.authentication.JWTAuthentication',),
}

CORS_ALLOW_ALL_ORIGINS = True  # В проде можно переопределить
# Если хотите ограничить:
# CORS_ALLOWED_ORIGINS = [ 'https://example.com' ]

# --- Настройки E-mail и OAuth ---
EMAIL_BACKEND = config('EMAIL_BACKEND', default='django.core.mail.backends.console.EmailBackend')
DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default='no-reply@scannyrf.com')

# SMTP-параметры (используются, если выбран SMTP-бэкенд)
EMAIL_HOST = config('EMAIL_HOST', default='')
EMAIL_PORT = config('EMAIL_PORT', default=587, cast=int)
EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')
EMAIL_USE_TLS = config('EMAIL_USE_TLS', default=True, cast=bool)
EMAIL_USE_SSL = config('EMAIL_USE_SSL', default=False, cast=bool)

# Параметры SendGrid (используются, если выбран sendgrid_backend)
SENDGRID_API_KEY = config('SENDGRID_API_KEY', default='')

# Если мы на Render и задан ключ SendGrid — принудительно используем SendGrid
if 'RENDER' in os.environ and SENDGRID_API_KEY:
    EMAIL_BACKEND = 'sendgrid_backend.SendgridBackend'

GOOGLE_CLIENT_ID = config('GOOGLE_CLIENT_ID', default='')
FACEBOOK_APP_ID = config('FACEBOOK_APP_ID', default='')
FACEBOOK_APP_SECRET = config('FACEBOOK_APP_SECRET', default='')
VK_SERVICE_KEY = config('VK_SERVICE_KEY', default='')

# --- Channels (WebSockets) ---
# По умолчанию InMemoryChannelLayer (для одного инстанса).
# Для продакшена рекомендуем Redis:
#   CHANNEL_LAYERS = {
#       "default": {
#           "BACKEND": "channels_redis.core.RedisChannelLayer",
#           "CONFIG": { "hosts": [config('REDIS_URL', default='redis://localhost:6379')] },
#       },
#   }
if os.environ.get('REDIS_URL') or config('REDIS_URL', default=''):
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [os.environ.get('REDIS_URL') or config('REDIS_URL')],
            },
        }
    }
else:
    CHANNEL_LAYERS = {
        "default": { "BACKEND": "channels.layers.InMemoryChannelLayer" }
    }

# ==============================================================================
# НАСТРОЙКИ СПЕЦИАЛЬНО ДЛЯ ПРОДАКШЕНА (OnRender)
# ==============================================================================
if 'RENDER' in os.environ:
    DEBUG = False

    RENDER_EXTERNAL_HOSTNAME = os.environ.get('RENDER_EXTERNAL_HOSTNAME')
    if RENDER_EXTERNAL_HOSTNAME:
        if RENDER_EXTERNAL_HOSTNAME not in ALLOWED_HOSTS:
            ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)
        CORS_ALLOWED_ORIGINS = [f"https://{RENDER_EXTERNAL_HOSTNAME}"]
        CSRF_TRUSTED_ORIGINS = [f"https://{RENDER_EXTERNAL_HOSTNAME}"]

    # Django доверяет заголовкам от прокси-сервера Render
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True