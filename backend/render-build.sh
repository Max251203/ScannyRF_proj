#!/usr/bin/env bash
cd ../frontend
npm install
npm run build
cp -r dist/* ../backend/static/
cd ../backend
pip install -r requirements.txt
python manage.py collectstatic --noinput
python manage.py migrate