#!/bin/bash
# Runs once, on the first start of an empty volume (docker-entrypoint-initdb.d).
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /sql/init.sql

# Dummy data is optional: solution/sql/dev/ is gitignored, so fresh clones do not have it.
if [ -f /sql/dev/seed_dummy.sql ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /sql/dev/seed_dummy.sql
else
  echo "initdb: /sql/dev/seed_dummy.sql not found, skipping dummy data"
fi
