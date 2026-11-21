#!/bin/sh
# Runs once, when the data volume is first created.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /sql/init.sql
