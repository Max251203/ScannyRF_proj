#!/usr/bin/env bash
set -o errexit

echo "Building frontend..."
cd frontend

# Установка npm-зависимостей
npm ci || npm install

# Вычисляем публичный URL сервиса (для VITE_API_URL), чтобы фронт знал /api
if [ -n "${RENDER_EXTERNAL_URL}" ]; then
  PUBLIC_URL="${RENDER_EXTERNAL_URL}"
elif [ -n "${RENDER_EXTERNAL_HOSTNAME}" ]; then
  PUBLIC_URL="https://${RENDER_EXTERNAL_HOSTNAME}"
else
  PUBLIC_URL="http://127.0.0.1:8000"
fi

echo "Using PUBLIC_URL=${PUBLIC_URL}"
VITE_API_URL=${PUBLIC_URL}/api npm run build

cd ..

echo "Installing backend dependencies..."
pip install -r backend/requirements.txt

echo "Running Django management commands..."
export PYTHONPATH="$(pwd)"

# Стадия build может не иметь доступа к БД в Render, поэтому миграции лучше вынести в Pre-Deploy.
# Оставим только collectstatic.
python backend/manage.py collectstatic --noinput --clear

# Если хотите выполнять миграции на стадии build локально — раскомментируйте:
python backend/manage.py migrate
python backend/create_superuser.py

echo "Build completed."