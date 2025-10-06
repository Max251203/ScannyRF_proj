#!/usr/bin/env bash
set -o errexit

echo "Building frontend..."
cd frontend
npm install
npm run build
cd ..

echo "Preparing backend..."
pip install -r backend/requirements.txt
python backend/manage.py collectstatic --no-input
python backend/manage.py migrate

echo "Creating superuser..."
python backend/create_superuser.py