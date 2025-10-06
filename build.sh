#!/usr/bin/env bash
# exit on error
set -o errexit

# --- Установка и сборка фронтенда ---
echo "Building frontend..."
cd frontend
npm install
npm run build
cd ..

# --- Установка зависимостей и подготовка бэкенда ---
echo "Preparing backend..."
pip install -r backend/requirements.txt
python backend/manage.py collectstatic --no-input
python backend/manage.py migrate

# --- Создание суперпользователя (запускаем из корня) ---
echo "Creating superuser..."
python backend/create_superuser.py