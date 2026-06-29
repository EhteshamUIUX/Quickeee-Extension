#!/usr/bin/env bash
set -e

# Wait for Postgres if a host is configured (skipped for Neon/managed URLs).
if [ -z "$DATABASE_URL_OVERRIDE" ] && [ -n "$POSTGRES_HOST" ]; then
  echo "Waiting for Postgres at $POSTGRES_HOST:$POSTGRES_PORT ..."
  until python -c "import socket,os,sys; s=socket.socket(); s.settimeout(2); \
    s.connect((os.environ['POSTGRES_HOST'], int(os.environ.get('POSTGRES_PORT','5432')))); s.close()" 2>/dev/null; do
    sleep 1
  done
fi

# Apply migrations (idempotent). Falls back to create_all on startup if this fails.
echo "Running migrations..."
alembic upgrade head || echo "Alembic failed; app will create_all on startup."

echo "Starting API..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
