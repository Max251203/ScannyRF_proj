"""
Django settings for config project.
"""
from pathlib import Path
import os
from decouple import Config, RepositoryEnv
import dj_database_url

# BASE_DIR указывает на корень всего проекта
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# --- ИСПРАВЛЕНИЕ: Безопасная загрузка .env файла ---
# На сервере OnRender .env файла не будет, и это нормально.
# decouple будет брать переменные из окружения сервиса.
env_path = BASE_DIR / 'backend' / '.env'
if env_path.exists():
    # Используем RepositoryEnv только если .env файл существует (для локальной разработки)
    config = Config(RepositoryEnv(str(env_path)))
else:
    # В продакшене создаем пустой config, который будет читать только из os.environ
    config = Config()

# --- Основные настройки ---
# На проде SECRET_KEY ДОЛЖЕН быть в переменных окружения, поэтому убираем default
SECRET_KEY = config('SECRET_KEY')
# В проде DEBUG всегда False
DEBUG = config('DEBUG', default=False, cast=bool)
# ALLOWED_HOSTS будет переопределен ниже для Render
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='127.0.0.1,localhost').split(',')


# --- Приложения ---
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'whitenoise.runserver_nostatic',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'accounts',
    'cms',
    'core',
]

# --- Middleware ---
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
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
# dj-database-url автоматически возьмет DATABASE_URL из окружения
DATABASES = {
    'default': dj_database_url.config(
        default=config('DATABASE_URL'), # Используем config, чтобы он взял из .env локально
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
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [
    BASE_DIR / 'frontend' / 'dist' / 'assets',
    # Добавим корень dist, чтобы Django нашел vite.svg и др. файлы в корне
    BASE_DIR / 'frontend' / 'dist',
]
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# --- Прочие настройки ---
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ('rest_framework_simplejwt.authentication.JWTAuthentication',),
}
CORS_ALLOW_ALL_ORIGINS = True

# --- Настройки E-mail и OAuth ---
EMAIL_BACKEND = config('EMAIL_BACKEND', default='django.core.mail.backends.smtp.EmailBackend')
DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default='no-reply@scannyrf')
EMAIL_HOST = config('EMAIL_HOST', default='smtp.gmail.com')
EMAIL_PORT = config('EMAIL_PORT', cast=int)
EMAIL_HOST_USER = config('EMAIL_HOST_USER')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD')
EMAIL_USE_TLS = config('EMAIL_USE_TLS', cast=bool, default=True)
EMAIL_USE_SSL = config('EMAIL_USE_SSL', cast=bool, default=False)
if EMAIL_USE_SSL:
    EMAIL_USE_TLS = False

GOOGLE_CLIENT_ID    = config('GOOGLE_CLIENT_ID', default='')
FACEBOOK_APP_ID     = config('FACEBOOK_APP_ID', default='')
FACEBOOK_APP_SECRET = config('FACEBOOK_APP_SECRET', default='')
VK_SERVICE_KEY      = config('VK_SERVICE_KEY', default='')

# ==============================================================================
# НАСТРОЙКИ ДЛЯ ПРОДАКШЕНА (OnRender)
# ==============================================================================
if 'RENDER' in os.environ:
    DEBUG = False
    RENDER_EXTERNAL_HOSTNAME = os.environ.get('RENDER_EXTERNAL_HOSTNAME')
    if RENDER_EXTERNAL_HOSTNAME:
        ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)
        CORS_ALLOWED_ORIGINS = [f"https://{RENDER_EXTERNAL_HOSTNAME}"]
        CSRF_TRUSTED_ORIGINS = [f"https://{RENDER_EXTERNAL_HOSTNAME}"]

    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True