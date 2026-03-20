#!/usr/bin/env bash
set -e

CMD="${1:-help}"

# Абсолютные пути
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV="$ROOT/.venv"

# python3 или python
if command -v python3 >/dev/null 2>&1; then
  PY_BIN=python3
else
  PY_BIN=python
fi

create_venv_if_needed() {
  if [ ! -d "$VENV" ]; then
    echo "[venv] creating $VENV ..."
    "$PY_BIN" -m venv "$VENV"
  fi
}

pip_venv() {
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
    "$PY_BIN" "$@"
  fi
}

sync_frontend_env() {
  if [ -f "$ROOT/.env" ]; then
    echo "[env] syncing VITE_* to frontend/.env ..."
    grep '^VITE_' "$ROOT/.env" > "$FRONTEND/.env" || true
  fi
}

case "$CMD" in
  dev)
    echo "[dev] === backend deps ==="
    create_venv_if_needed
    pip_venv install -r "$BACKEND/requirements.txt"

    echo "[dev] === frontend deps ==="
    sync_frontend_env
    cd "$FRONTEND"
    npm install || npm ci || true

    echo "[dev] === start daphne & vite ==="
    cd "$BACKEND"
    python_venv -m daphne -b 0.0.0.0 -p 8000 backend.config.asgi:application &
    BACK_PID=$!

    cd "$FRONTEND"
    npm run dev &
    FRONT_PID=$!

    echo "[dev] backend pid: $BACK_PID, frontend pid: $FRONT_PID"
    wait $BACK_PID $FRONT_PID
    ;;

  build)
    echo "[build] === frontend build ==="
    sync_frontend_env
    cd "$FRONTEND"
    npm ci || npm install
    npm run build

    echo "[build] === backend collectstatic & migrate ==="
    create_venv_if_needed
    pip_venv install -r "$BACKEND/requirements.txt"
    export PYTHONPATH="$ROOT"
    cd "$BACKEND"
    python_venv manage.py collectstatic --noinput --clear
    python_venv manage.py migrate
    python_venv ../create_superuser.py || true
    ;;

  start)
    echo "[start] === production daphne ==="
    create_venv_if_needed
    export PYTHONPATH="$ROOT"
    cd "$BACKEND"
    PORT="${PORT:-8000}"
    echo "[start] listening on $PORT"
    python_venv -m daphne -b 0.0.0.0 -p "$PORT" backend.config.asgi:application
    ;;

  *)
    echo "Usage: ./manage.sh [dev|build|start]"
    exit 1
    ;;
esac