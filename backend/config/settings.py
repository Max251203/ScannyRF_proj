import os
from pathlib import Path
import dj_database_url
from decouple import Config, RepositoryEnv

# BASE_DIR указывает на папку 'backend'
BASE_DIR = Path(__file__).resolve().parent.parent

# decouple ищет .env в папке `backend`
config = Config(RepositoryEnv(str(BASE_DIR / '.env')))

# --- Основные настройки ---
# На проде SECRET_KEY ДОЛЖЕН быть в переменных окружения.
# Локально он будет взят из .env файла.
SECRET_KEY = config('SECRET_KEY') 
DEBUG = config('DEBUG', default=False, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='127.0.0.1,localhost').split(',')


# --- Приложения ---
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    # WhiteNoise для обслуживания статики Django в DEBUG=False
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
ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'

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

# --- База данных ---
DATABASES = {
    # dj-database-url автоматически читает переменную DATABASE_URL из окружения
    'default': dj_database_url.config(
        # Локально будет использован sqlite, если DATABASE_URL не задана
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
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
CORS_ALLOW_ALL_ORIGINS = True # В проде будет переопределено

# --- Настройки E-mail и OAuth ---
EMAIL_BACKEND = "sendgrid_backend.SendgridBackend"
# DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default='no-reply@example.com')
# EMAIL_HOST = config('EMAIL_HOST', default='')
# EMAIL_PORT = config('EMAIL_PORT', default=587, cast=int)
# EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
# EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')
# EMAIL_USE_TLS = config('EMAIL_USE_TLS', default=True, cast=bool)
# EMAIL_USE_SSL = config('EMAIL_USE_SSL', default=False, cast=bool)
SENDGRID_API_KEY = config('SENDGRID_API_KEY')
DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', 'no-reply@scannyrf.com')

GOOGLE_CLIENT_ID    = config('GOOGLE_CLIENT_ID', default='')
FACEBOOK_APP_ID     = config('FACEBOOK_APP_ID', default='')
FACEBOOK_APP_SECRET = config('FACEBOOK_APP_SECRET', default='')
VK_SERVICE_KEY      = config('VK_SERVICE_KEY', default='')


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
    
    # Django доверяет заголовкам от прокси-сервера Render
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True