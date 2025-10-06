#!/usr/bin/env bash
set -o errexit

echo "Building frontend..."
cd frontend
npm install
VITE_API_URL=${RENDER_EXTERNAL_URL}/api npm run build
cd ..

echo "Installing backend dependencies..."
pip install -r backend/requirements.txt

# Устанавливаем PYTHONPATH перед каждой командой Django
echo "Running Django management commands..."
PYTHONPATH=$(pwd) python backend/manage.py collectstatic --no-input --clear
PYTHONPATH=$(pwd) python backend/manage.py migrate
PYTHONPATH=$(pwd) python backend/create_superuser.py