#!/usr/bin/env bash
set -euo pipefail

CMD="${1:-help}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV="$ROOT/.venv"

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN=python3
else
  PYTHON_BIN=python
fi

create_venv_if_needed() {
  if [ ! -d "$VENV" ]; then
    echo "[venv] creating $VENV..."
    "$PYTHON_BIN" -m venv "$VENV"
  fi
}

pip_cmd() {
  if [ -x "$VENV/bin/pip" ]; then
    "$VENV/bin/pip" "$@"
  else
    pip "$@"
  fi
}

python_venv() {
  if [ -x "$VENV/bin/python" ]; then
    "$VENV/bin/python" "$@"
  else
    "$PYTHON_BIN" "$@"
  fi
}

sync_frontend_env() {
  if [ -f "$ROOT/.env" ]; then
    echo "[env] syncing VITE_* to frontend/.env..."
    grep '^VITE_' "$ROOT/.env" > "$FRONTEND/.env" || true
  fi
}

case "$CMD" in
  dev)
    create_venv_if_needed
    echo "[dev] backend requirements..."
    pip_cmd install -r "$BACKEND/requirements.txt"

    echo "[dev] frontend deps..."
    sync_frontend_env
    (cd "$FRONTEND" && (npm install || npm ci || true))

    echo "[dev] running daphne + vite..."
    (cd "$BACKEND" && python_venv -m daphne -b 0.0.0.0 -p 8000 backend.config.asgi:application) &
    BACK_PID=$!
    (cd "$FRONTEND" && npm run dev) &
    FRONT_PID=$!

    trap "kill $BACK_PID $FRONT_PID 2>/dev/null || true" INT TERM
    wait $BACK_PID $FRONT_PID
    ;;

  build)
    echo "[build] frontend..."
    sync_frontend_env
    cd "$FRONTEND"
    npm ci || npm install
    npm run build
    cd "$ROOT"

    create_venv_if_needed
    echo "[build] backend requirements..."
    pip_cmd install -r "$BACKEND/requirements.txt"

    export PYTHONPATH="$ROOT"
    cd "$BACKEND"
    python_venv manage.py collectstatic --noinput --clear
    python_venv manage.py migrate
    python_venv ../create_superuser.py || true
    ;;

  start)
    create_venv_if_needed
    export PYTHONPATH="$ROOT"
    cd "$BACKEND"
    PORT="${PORT:-8000}"
    echo "[start] daphne on port $PORT..."
    python_venv -m daphne -b 0.0.0.0 -p "$PORT" backend.config.asgi:application
    ;;

  *)
    echo "Usage: ./manage.sh [dev|build|start]"
    exit 1
    ;;
esac