#!/usr/bin/env bash
# Pulls every source into the database; extra arguments (e.g. --force) go to each import.
set -u
cd "$(dirname "$0")/importer"
export AED_DSN="${AED_DSN:-postgresql://aed:${AED_DB_PASSWORD:-aed}@127.0.0.1:54329/aed}"

worst=0
# OpenAEDMap first: the city lists are matched against its sites.
for source in OpenAEDMap WarsawAPI Krakow; do
    uv run --quiet python -m aed_import "$source" "$@"
    code=$?
    echo "== $source: exit $code"
    [ "$code" -gt "$worst" ] && worst=$code
done
exit "$worst"
