"""
Django settings for config project.
"""
from pathlib import Path
import os
from decouple import Config, RepositoryEnv, Csv
import dj_database_url

# BASE_DIR теперь указывает на корень всего проекта (на 2 уровня выше этого файла)
# backend/config/settings.py -> backend/config -> backend -> корень
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# .env файл теперь ищется в папке backend
config = Config(RepositoryEnv(str(BASE_DIR / 'backend' / '.env')))

# --- Основные настройки ---
SECRET_KEY = config('SECRET_KEY', default='local-dev-secret-key-that-is-not-secure')
DEBUG = config('DEBUG', default=True, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='127.0.0.1,localhost', cast=Csv())


# --- Приложения ---
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    # WhiteNoise должен быть здесь для команды runserver_nostatic
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
ROOT_URLCONF = 'backend.config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        # Указываем Django, где искать index.html из билда React
        'DIRS': [
            BASE_DIR / 'frontend' / 'dist',
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

WSGI_APPLICATION = 'backend.config.wsgi.application'

# --- База данных ---
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
    # Фоллбэк для локальной разработки
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

# --- Статические и медиа-файлы ---
STATIC_URL = '/static/'
# Папка, куда `collectstatic` соберет ВСЕ статические файлы для продакшена
STATIC_ROOT = BASE_DIR / 'staticfiles'
# Папки, где Django будет дополнительно искать статику (включая билд React)
STATICFILES_DIRS = [
    BASE_DIR / 'frontend' / 'dist',
]
# Хранилище для WhiteNoise
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# --- Прочие настройки Django ---
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# --- Настройки DRF и CORS ---
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
}
CORS_ALLOW_ALL_ORIGINS = True # В проде лучше ограничить

# --- Настройки E-mail ---
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

# --- Ключи OAuth ---
GOOGLE_CLIENT_ID    = config('GOOGLE_CLIENT_ID', default='')
FACEBOOK_APP_ID     = config('FACEBOOK_APP_ID', default='')
FACEBOOK_APP_SECRET = config('FACEBOOK_APP_SECRET', default='')
VK_SERVICE_KEY      = config('VK_SERVICE_KEY', default='')

# ==============================================================================
# НАСТРОЙКИ ДЛЯ ПРОДАКШЕНА (OnRender)
# ==============================================================================
if config('RENDER', default=False, cast=bool):
    DEBUG = False

    RENDER_EXTERNAL_HOSTNAME = config('RENDER_EXTERNAL_HOSTNAME', default=None)
    if RENDER_EXTERNAL_HOSTNAME:
        ALLOWED_HOSTS = [RENDER_EXTERNAL_HOSTNAME]
        CORS_ALLOWED_ORIGINS = [f"https://{RENDER_EXTERNAL_HOSTNAME}"]
        CSRF_TRUSTED_ORIGINS = [f"https://{RENDER_EXTERNAL_HOSTNAME}"]

    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True