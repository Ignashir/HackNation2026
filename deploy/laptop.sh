#!/usr/bin/env bash
# Runs the stack on this Mac for devices on the same Wi-Fi.
#
#   ./laptop.sh            start or update (pass extra args to compose: --build, service names, ...)
#   ./laptop.sh down       stop everything (data volumes are kept)
#
# The domain is <wifi-ip-with-dashes>.sslip.io, worked out on every run, so after moving to
# another network just run it again. Caddy uses its own CA (local_certs) because
# Let's Encrypt cannot reach a private address.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Missing deploy/.env: cp .env.example .env and fill it in." >&2; exit 1; }

# LAPTOP_IP overrides the detected address, e.g. a Tailscale one: LAPTOP_IP=$(tailscale ip -4) ./laptop.sh
iface="$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }')"
ip="${LAPTOP_IP:-$(ipconfig getifaddr "${iface:-en0}" || true)}"
[ -n "$ip" ] || { echo "No network address on ${iface:-en0}. Are you on Wi-Fi?" >&2; exit 1; }

export PUBLIC_DOMAIN="${ip//./-}.sslip.io"
export CADDY_GLOBAL_OPTIONS=local_certs

if [ "${1:-}" = "down" ]; then
    shift
    exec docker compose down "$@"
fi

# The dev stacks clash with this one: backend_latest's mcod-nginx takes 80/443 and
# solution/compose.yaml's database takes 54329. Running both would not fit in memory anyway.
aed_port="${AED_DB_HOST_PORT:-54329}"
for port in 80 443 "$aed_port"; do
    other="$(docker ps --filter "publish=$port" --format '{{.Names}}' | grep -v '^hacknation-' || true)"
    if [ -n "$other" ]; then
        echo "Port $port is taken by: $(echo $other)" >&2
        echo "Stop the dev stack first (docker compose down in its folder)." >&2
        [ "$port" = "$aed_port" ] && echo "Or keep it and use another port: AED_DB_HOST_PORT=54339 $0 $*" >&2
        exit 1
    fi
done

docker compose up -d "$@"
./relink.sh "https://api.$PUBLIC_DOMAIN" 2>&1 | grep -v 'level=warning' || true

cat <<EOF

Running on $ip. Open on any device on this Wi-Fi:

  Portal       https://$PUBLIC_DOMAIN
  Admin        https://admin.$PUBLIC_DOMAIN
  AED map      https://aed.$PUBLIC_DOMAIN
  AED mobile   https://m.$PUBLIC_DOMAIN
  Converter    https://konwerter.$PUBLIC_DOMAIN
  E-mail       https://mail.$PUBLIC_DOMAIN   (login: TOOLS_USER from .env)

Stop certificate warnings: install http://ca.$PUBLIC_DOMAIN (see README, "Laptop").
Keep the Mac awake while presenting: caffeinate -dis
EOF
