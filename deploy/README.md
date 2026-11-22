# One-server deploy

Runs the open data portal (`backend_latest`, `frontend_latest`) and the AED map (`solution/app`)
on one machine: a laptop serving the same Wi-Fi ([Laptop](#laptop-same-wi-fi-only)) or an internet
server ([Server](#server)). [Caddy](https://caddyserver.com) is the only container with published ports
(80 and 443). It handles HTTPS and routes each hostname to a container.
No domain is needed: `203-0-113-10.sslip.io` and all of its subdomains resolve to `203.0.113.10`.

**Setting it up for the first time?** Follow the step-by-step checklist in
[SETUP_TODO.md](../SETUP_TODO.md). It goes from installing the tools and getting the code, through
the configuration, build and data loading, to checking that everything works, with fixes for common
problems. This README is the reference behind it.

## URLs

With `PUBLIC_DOMAIN=203-0-113-10.sslip.io`:

| URL | What |
|---|---|
| `https://203-0-113-10.sslip.io` | Portal (Angular). `/api/*` goes to the API and `/cms/*` to the CMS |
| `https://api.…`, `https://admin.…`, `https://cms.…` | Portal API, Django admin, CMS |
| `https://aed.…` | AED map. The mobile finder is at `/mobile.html` |
| `https://m.…` | AED mobile finder at `/` (link this one from a QR code) |
| `https://konwerter.…` | AED data converter (`solution/konwerter`): turns a provider's register into a file in the AED standard, in the browser |
| `https://forum.…` | Discourse, only with `--profile forum` |
| `https://mail.…`, `https://flower.…` | Captured e-mail (MailHog) and Celery monitor. Login: `TOOLS_USER` |
| `http://ca.…` | Laptop mode: Caddy's root certificate, to install on phones |

## Laptop (same Wi-Fi only)

The stack runs on a Mac and serves phones and laptops on the same network. Let's Encrypt can't
reach a private address, so Caddy issues certificates from its own CA (`local_certs`).
`laptop.sh` works out the domain from the current Wi-Fi IP, e.g. `10-250-162-60.sslip.io`.

1. **Docker Desktop memory:** Settings → Resources → Memory: 12 GB (the default 8 GB is too
   little for Elasticsearch plus the Django processes). On Apple Silicon the backend, PostGIS and
   Elasticsearch images run emulated, so the first build is slow.
2. **Stop the dev stacks:** `backend_latest`'s nginx holds ports 80/443 and `solution/compose.yaml`
   holds 54329. `laptop.sh` checks for both and tells you which one is in the way.
3. **Configure and start:**
   ```bash
   cp deploy/.env.example deploy/.env      # set TOOLS_PASSWORD_HASH; leave PUBLIC_DOMAIN as is
   cd deploy
   docker compose build
   docker compose run --rm mcod-admin python manage.py collectstatic --noinput
   ./laptop.sh                             # prints the URLs
   ```
   Then run the remaining first-run steps from [First run](#first-run) (`createsuperuser`, `pull_all.sh`).
   Every `docker compose …` command works as in the server instructions, except starting and
   stopping, which go through `./laptop.sh` (any extra arguments are passed to `up -d`) and
   `./laptop.sh down`.
4. **Allow incoming connections** when macOS asks about Docker, or no other device can connect.
5. **Trust the certificates** (once per device; the CA is kept in the `caddy_data` volume):
   - **iPhone:** open `http://ca.<domain>` in Safari → Allow → Settings → Profile Downloaded →
     Install. Then Settings → General → About → Certificate Trust Settings → turn on
     "Caddy Local Authority".
   - **Android:** download `http://ca.<domain>`, then Settings → Security → Encryption &
     credentials → Install a certificate → CA certificate.
   - **This Mac:** `curl -o /tmp/caddy-root.crt http://ca.<domain> && sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/caddy-root.crt`

   Without this, browsers show a warning you can click through, but some mobile browsers then
   refuse geolocation, which the AED finder needs.

Moving to another network changes the IP, and with it every URL: run `./laptop.sh` again.
Installed certificates stay valid. Keep the Mac awake while presenting: `caffeinate -dis`.

**Reusing the dev stacks' data** (`PORTAL_VOLUMES=backend_latest`, `AED_DB_VOLUME=solution_aed-data`
in `.env`): only one of the two stacks can run at a time. The portal stores links to its own files
with the domain they were uploaded under, and treats any other domain as an external link, so
`laptop.sh` runs `relink.sh` to point them at the current domain. Before going back to the dev stack:

```bash
./relink.sh https://api.mcod.local && ./laptop.sh down
docker compose -p backend_latest start && docker compose -p solution start
```

**AED sites in the portal:** the national list on the portal's `/aed` page is built from provider files
in the AED standard. To add the AED database (`aed.<domain>`) as a provider, export it with
`uv run python -m aed_import.export_standard --out aed_baza.csv` (in `solution/importer`, with
`AED_DSN=postgresql://aed:aed@127.0.0.1:54329/aed`), load it with `manage.py load_aed_providers --config …`
and run `manage.py build_standard_aggregate aed`.
Venue Wi-Fi sometimes blocks traffic between devices ("client isolation"). If phones can't connect,
use a phone hotspot that the laptop and the phones all join.

## Server

- 16 GB RAM, 4 vCPUs, x86-64 (Elasticsearch, five Django processes and Celery; 8 GB is the bare minimum)
- Docker with Compose v2.24 or newer
- Firewall: open 22, 80 and 443 only
- Elasticsearch needs `sudo sysctl -w vm.max_map_count=262144`. To keep it after a reboot, add it to `/etc/sysctl.conf`

## First run

```bash
git clone <repo> && cd <repo>
cp backend_latest/env.sample backend_latest/.env   # if not already there
cp deploy/.env.example deploy/.env
#   PUBLIC_DOMAIN: the server's IP with dashes + .sslip.io (curl -4 ifconfig.me)
#   TOOLS_PASSWORD_HASH: docker run --rm caddy:2.10-alpine caddy hash-password --plaintext '…'

cd deploy
docker compose build
docker compose run --rm mcod-admin python manage.py collectstatic --noinput
docker compose up -d                  # mcod-api runs the migrations when it starts
docker compose run --rm mcod-admin python manage.py createsuperuser

# AED data: the importer reads 127.0.0.1:54329, which is the aed-db port on this host
../solution/pull_all.sh
```

For the portal's initial data and search index, follow `backend_latest/README.md`, running each
`manage.py` command as `docker compose run --rm mcod-admin python manage.py …`.

## Everyday commands

```bash
docker compose ps
docker compose logs -f caddy mcod-api          # any service names
git pull && docker compose up -d --build       # deploy a new version
docker compose restart caddy                   # after editing the Caddyfile (it is mounted as a single file)
docker compose --profile forum up -d           # add the forum (also set DISCOURSE_FORUM_ENABLED=true)
```

## How it fits together

```
internet ──443──▶ caddy ─┬─ <domain>/api/*, /cms/* ─────────▶ mcod-api, mcod-cms
                         ├─ <domain>, api., admin., cms. ──▶ mcod-nginx ─▶ frontend / api / admin / cms / ws
                         ├─ forum. ──────────────────────▶ mcod-discourse        (optional)
                         ├─ aed., m. ────────────────────▶ aed-web, aed-api ─▶ aed-db
                         └─ mail., flower. (password) ───▶ mcod-smtp, mcod-flower
       Postgres, Redis, RabbitMQ, Elasticsearch, Fuseki: internal network only
```

- `mcod-nginx` keeps the backend's own rules (static files, media, protected downloads through
  `X-Accel-Redirect`, websockets). `nginx/render-templates.sh` generates `nginx/templates/` from
  `backend_latest/docker/nginx/config-templates/`. The generated configs use plain HTTP and the public
  domain instead of `mcod.local`. Run the script again when the backend's templates change.
- Django runs with `mcod.settings.base`, which reads DEBUG, the public URLs and the cookie domain from
  the environment set in `compose.yaml`. `local.py` (the dev default) is not used because it hard-codes
  the `mcod.local` cookie domain.
- Backend code is mounted from the checkout, the same way as in `docker-compose.local.yml`. The image
  holds only the dependencies.

## Known limits

- The login and account-linking buttons in the Angular app hard-code `https://admin.mcod.local`
  (`login.component.ts`, `header.component.ts`, `my-dashboard.component.ts`). They only matter for
  login.gov.pl.
- Let's Encrypt limits certificates per registered domain each week. sslip.io is shared by many users.
  If issuance fails, Caddy retries with ZeroSSL automatically. A real domain avoids the problem.
