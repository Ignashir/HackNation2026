#!/bin/bash
# Runs once, on the first start of an empty volume (docker-entrypoint-initdb.d).
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /sql/init.sql
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /sql/dev/seed_dummy.sql
