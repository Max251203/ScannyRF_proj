"""
Django settings for config project.
"""
from pathlib import Path
import os
from decouple import Config, RepositoryEnv, Csv
import dj_database_url

# BASE_DIR указывает на папку 'backend'
BASE_DIR = Path(__file__).resolve().parent.parent

# Читаем переменные из .env файла (только для локальной разработки)
# На OnRender переменные будут браться из окружения
config = Config(RepositoryEnv(str(BASE_DIR / '.env')))

# Базовые настройки
SECRET_KEY = config('SECRET_KEY', default='local-dev-secret-key-that-is-not-secure')
DEBUG = config('DEBUG', default=True, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='127.0.0.1,localhost', cast=Csv())

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    'rest_framework',
    'corsheaders',

    'accounts',
    'cms',
    'core',
]

MIDDLEWARE = [
    # SecurityMiddleware всегда должен быть одним из первых
    'django.middleware.security.SecurityMiddleware',
    # WhiteNoise должен быть сразу после SecurityMiddleware
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        # --- ИСПРАВЛЕНИЕ: Указываем Django, где искать index.html ---
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

WSGI_APPLICATION = 'config.wsgi.application'

# База данных: Приоритет DATABASE_URL из окружения (для Render)
DATABASE_URL = config('DATABASE_URL', default=None)
if DATABASE_URL:
    DATABASES = {
        'default': dj_database_url.config(
            default=DATABASE_URL,
            conn_max_age=600,
            conn_health_checks=True,
        )
    }
else:
    # Фоллбэк для локальной разработки, если DATABASE_URL не задан
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': config('PG_NAME', default='scannyrf'),
            'USER': config('PG_USER', default='postgres'),
            'PASSWORD': config('PG_PASS', default='postgres'),
            'HOST': config('PG_HOST', default='127.0.0.1'),
            'PORT': config('PG_PORT', default='5432'),
        }
    }


AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'ru-ru'
TIME_ZONE = 'Europe/Moscow'
USE_I18N = True
USE_TZ = True

# Статические файлы (CSS, JS, изображения фронтенда)
STATIC_URL = '/static/'
# Папка, куда collectstatic будет собирать все статические файлы
STATIC_ROOT = BASE_DIR / 'staticfiles'
# Папки, где Django будет дополнительно искать статику (сюда собирается билд React)
STATICFILES_DIRS = [
    BASE_DIR / 'static',
]

# Медиа-файлы (загружаемые пользователями) - ВАШ ПРОЕКТ ИХ НЕ ИСПОЛЬЗУЕТ НА ДИСКЕ
# MEDIA_URL = '/media/'
# MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
}

CORS_ALLOW_ALL_ORIGINS = True # Для разработки. В проде лучше ограничить.
AUTH_USER_MODEL = 'accounts.User'

# E-mail
EMAIL_BACKEND = config('EMAIL_BACKEND', default='django.core.mail.backends.smtp.EmailBackend')
DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default='no-reply@scannyrf')
EMAIL_HOST = config('EMAIL_HOST', default='smtp.gmail.com')
EMAIL_PORT = config('EMAIL_PORT', default=587, cast=int)
EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')
EMAIL_USE_TLS = config('EMAIL_USE_TLS', default=True, cast=bool)
EMAIL_USE_SSL = config('EMAIL_USE_SSL', default=False, cast=bool)
if EMAIL_USE_SSL:
    EMAIL_USE_TLS = False

# Ключи OAuth
GOOGLE_CLIENT_ID    = config('GOOGLE_CLIENT_ID', default='')
FACEBOOK_APP_ID     = config('FACEBOOK_APP_ID', default='')
FACEBOOK_APP_SECRET = config('FACEBOOK_APP_SECRET', default='')
VK_SERVICE_KEY      = config('VK_SERVICE_KEY', default='')

# ==============================================================================
# НАСТРОЙКИ ДЛЯ ПРОДАКШЕНА (OnRender)
# ==============================================================================

# WhiteNoise для раздачи статики
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# Проверяем, запущено ли приложение на Render
if config('RENDER', default=False, cast=bool):
    DEBUG = False

    # Домен вашего сервиса на Render
    RENDER_EXTERNAL_HOSTNAME = config('RENDER_EXTERNAL_HOSTNAME', default=None)
    if RENDER_EXTERNAL_HOSTNAME:
        ALLOWED_HOSTS = [RENDER_EXTERNAL_HOSTNAME]
        # Для CORS можно сделать более строгую настройку
        CORS_ALLOWED_ORIGINS = [f"https://{RENDER_EXTERNAL_HOSTNAME}"]
        CSRF_TRUSTED_ORIGINS = [f"https://{RENDER_EXTERNAL_HOSTNAME}"]


    # Django должен доверять заголовкам от прокси-сервера Render
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True