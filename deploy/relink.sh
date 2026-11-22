#!/usr/bin/env bash
# Points the portal's stored links to its own files at an API address.
#
#   ./relink.sh https://api.10-250-162-60.sslip.io   (laptop.sh runs this on every start)
#   ./relink.sh https://api.mcod.local               (before going back to the backend_latest dev stack)
#
# The backend saves each uploaded file's link as API_URL + /media/..., and later treats a link as
# its own file only if it starts with the current API_URL. When the domain changes (dev stack vs
# this deploy, or a new Wi-Fi address), its own files look external and reprocessing them fails
# trying to download them. Only links to /media/ on api.mcod.local or *.sslip.io are rewritten.
set -euo pipefail
cd "$(dirname "$0")"
api_url="${1:?usage: $0 https://api.<domain>}"
api_url="${api_url%/}"

for _ in $(seq 1 30); do
    docker compose exec -T mcod-db sh -c 'pg_isready -q -U "$POSTGRES_USER"' 2>/dev/null && break
    sleep 2
done

docker compose exec -T -e API_URL="$api_url" mcod-db sh -c '
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v api_url="$API_URL" <<'"'"'SQL'"'"'
UPDATE resource
   SET link = regexp_replace(link, '"'"'^https?://api\.(mcod\.local|[0-9-]+\.sslip\.io)/media/'"'"', :'"'"'api_url'"'"' || '"'"'/media/'"'"')
 WHERE link ~ '"'"'^https?://api\.(mcod\.local|[0-9-]+\.sslip\.io)/media/'"'"'
   AND NOT link LIKE :'"'"'api_url'"'"' || '"'"'/media/%'"'"';
SQL' | sed "s|^UPDATE |relink: rewrote links to $api_url: |"
