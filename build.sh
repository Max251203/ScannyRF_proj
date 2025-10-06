#!/usr/bin/env bash
# Завершить выполнение при любой ошибке
set -o errexit

# --- Установка и сборка фронтенда ---
echo "Building frontend..."
cd frontend
npm install
npm run build
cd ..

# --- Установка зависимостей бэкенда ---
echo "Installing backend dependencies..."
pip install -r backend/requirements.txt

# --- Подготовка Django (запускаем из корня проекта) ---
echo "Preparing Django..."

# Указываем PYTHONPATH, чтобы Django нашел свои модули
export PYTHONPATH=$(pwd)

# Запускаем collectstatic
python backend/manage.py collectstatic --no-input --clear

# Применяем миграции
python backend/manage.py migrate

# Создаем суперпользователя (скрипт уже исправлен)
echo "Creating superuser..."
python backend/create_superuser.py