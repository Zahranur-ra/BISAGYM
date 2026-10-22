#!/bin/sh
set -eu

if [ "${MIGRATE_ON_START:-true}" = "true" ]; then
  if [ -f alembic.ini ]; then
    echo "Applying database migrations..."
    python -m alembic upgrade head
  else
    echo "MIGRATE_ON_START=true, but alembic.ini is not present; skipping migrations."
  fi
fi

exec "$@"
