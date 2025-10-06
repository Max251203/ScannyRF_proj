#!/usr/bin/env bash
set -o errexit

echo "Building frontend..."
cd frontend
npm install
# --- ИСПРАВЛЕНИЕ: Передаем URL API в Vite ---
VITE_API_URL=${RENDER_EXTERNAL_URL}/api npm run build
# ---------------------------------------------
cd ..

echo "Installing backend dependencies..."
pip install -r backend/requirements.txt

export PYTHONPATH=$(pwd)

echo "Running Django management commands..."
python backend/manage.py collectstatic --no-input --clear
python backend/manage.py migrate
python backend/create_superuser.py