#!/bin/sh
set -e

# Migrations run before the app process starts, so an upgrade is just "pull the
# new image and recreate the container". node-pg-migrate takes a Postgres
# advisory lock, so this is safe even if several containers start at once.
# Set RUN_MIGRATIONS=false to manage schema changes yourself.
if [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
    attempt=1
    max_attempts="${MIGRATE_MAX_ATTEMPTS:-30}"
    # Postgres is often still starting up when this container does (bare
    # `docker run`, or an orchestrator without health-gated ordering), so a
    # failure to connect is retried rather than crash-looping the container.
    until node-pg-migrate up; do
        if [ "$attempt" -ge "$max_attempts" ]; then
            echo "dripline: migrations failed after ${attempt} attempts, giving up" >&2
            exit 1
        fi
        echo "dripline: migration attempt ${attempt} failed, retrying in 2s..." >&2
        attempt=$((attempt + 1))
        sleep 2
    done
fi

exec "$@"
