#!/usr/bin/env bash
# Завершить выполнение при любой ошибке
set -o errexit

# --- Установка и сборка фронтенда ---
echo "Building frontend..."
cd frontend
npm install
npm run build
cd ..

# --- Установка зависимостей и подготовка бэкенда ---
echo "Preparing backend..."
# Устанавливаем зависимости, используя pip из папки venv, которую создаст Render
pip install -r backend/requirements.txt

# Запускаем collectstatic, чтобы WhiteNoise нашел все статические файлы
python backend/manage.py collectstatic --no-input

# Применяем миграции к базе данных
python backend/manage.py migrate

# --- Создание суперпользователя (запускаем из корня проекта) ---
echo "Creating superuser..."
python backend/create_superuser.py