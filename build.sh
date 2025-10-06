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
cd backend
pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate

# --- Создание суперпользователя ---
echo "Creating superuser..."
python create_superuser.py
cd ..