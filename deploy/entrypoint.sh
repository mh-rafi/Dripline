#!/bin/sh
set -e

# Migrations run before the app process starts, so an upgrade is just "pull the
# new image and recreate the container". node-pg-migrate takes a Postgres
# advisory lock, so this is safe even if several containers start at once.
# Set RUN_MIGRATIONS=false to manage schema changes yourself.
if [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
    attempt=1
    max_attempts="${MIGRATE_MAX_ATTEMPTS:-30}"

    while true; do
        if output=$(node-pg-migrate up 2>&1); then
            printf '%s\n' "$output"
            break
        fi
        printf '%s\n' "$output" >&2

        # A credentials error never succeeds on a retry, and looping on it
        # buries the one line that explains what went wrong. Postgres reads
        # POSTGRES_USER/PASSWORD/DB only while initialising an empty data
        # directory, so changing them after the first start leaves the volume
        # on the old ones -- by far the most common way to land here.
        if printf '%s' "$output" | grep -qiE 'password authentication failed|no pg_hba\.conf entry|role ".*" does not exist|database ".*" does not exist'; then
            cat >&2 <<'MSG'

dripline: the database rejected these credentials, so this will not succeed on
a retry.

POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB take effect only when Postgres
initialises an empty data directory. If this volume was created by an earlier
deploy, those variables are ignored now and the credentials that created it
still apply -- the container's environment will look correct while the database
disagrees.

  Fresh install, nothing to lose:  delete the Postgres volume, then deploy
                                   again (docker compose down -v).
  Data you need to keep:           set the variables back to whatever created
                                   the volume, or rename the role in place.

Full instructions: the "password authentication failed" entry in
docs/self-hosting.md.

MSG
            exit 1
        fi

        # Postgres is often still starting up when this container does (bare
        # `docker run`, or an orchestrator without health-gated ordering), so a
        # failure to connect is retried rather than crash-looping the container.
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
