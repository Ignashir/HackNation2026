# Setup checklist: open data portal + AED register

Follow these steps in order to run the whole system on your own machine:

- the dane.gov.pl portal (`backend_latest` + `frontend_latest`) with the national AED list;
- the AED map (`solution/app`) and its database;
- the AED importers.

Every command is meant to be typed by hand. Run commands from the repository root unless a step says
otherwise. More detail is in [deploy/README.md](deploy/README.md).

There are two ways to run it:

- **Laptop** (macOS; phones on the same Wi-Fi can connect). This is the main path below.
- **Server** (Linux, reachable from the internet). The differences are listed in [step 5](#5-server-instead-of-a-laptop).

---

## 1. Machine and tools

- [ ] **Hardware**
  - Laptop: 16 GB RAM or more, and about 30 GB of free disk space.
  - Server: 16 GB RAM, 4 vCPUs, x86-64.
- [ ] **Docker**
  - macOS: install [Docker Desktop](https://docs.docker.com/desktop/). Linux: Docker Engine.
  - You need Docker Compose v2.24 or newer. Check with `docker compose version`.
- [ ] **Docker Desktop memory (macOS):** Settings → Resources → Memory → set **12 GB**, then Apply.
  With the default 8 GB, Elasticsearch and the Django processes run out of memory.
- [ ] **Git**
- [ ] **For the AED importers:** install [uv](https://docs.astral.sh/uv/getting-started/installation/).
  It installs the Python 3.12+ that `solution/importer` needs.

You don't need Node.js or a local Python for the portal itself, because both are built inside Docker.
Node 20 or newer is only needed if you run the Angular dev server outside Docker.

## 2. Get the code

- [ ] Clone the repository:
  ```bash
  git clone <repo-url> HackNation2026
  cd HackNation2026
  ```
- [ ] **Check that `backend_latest/` and `frontend_latest/` are in your checkout.**
  - They contain the dane.gov.pl code with the AED changes already applied: the `mcod/standards` app
    and the `src/app/pages/aed-register` page.
  - If they are missing, ask the team for them. The alternative is to get the upstream dane.gov.pl
    `backend` and `frontend` code and apply [solution/portal_patch](solution/portal_patch/README.md)
    yourself.
  - Quick check: `ls backend_latest/mcod/standards frontend_latest/src/app/pages/aed-register`
    should list files, not errors.

## 3. Configuration files

- [ ] **Backend environment:**
  ```bash
  cp backend_latest/env.sample backend_latest/.env
  ```
  - In `backend_latest/.env`, set `DISCOURSE_FORUM_ENABLED=false`. The forum image is in a private
    registry.
  - Optional: make your own encryption key with
    `python3 -c "import secrets; print(secrets.token_hex(32))"` and put it in `FIELD_ENCRYPTION_KEYS`.
- [ ] **Deploy environment:**
  ```bash
  cp deploy/.env.example deploy/.env
  ```
  - Laptop: leave `PUBLIC_DOMAIN` as it is. `laptop.sh` works out the domain from your Wi-Fi address.
  - Set `TOOLS_PASSWORD_HASH`, which is the login for the mail and Celery monitor pages. Generate it
    with:
    ```bash
    docker run --rm caddy:2.10-alpine caddy hash-password --plaintext 'choose-a-password'
    ```
    Paste the output in **single quotes**: the value contains `$`.
  - Leave `POSTGRES_USER` and `POSTGRES_PASSWORD` equal to the values in `backend_latest/.env`
    (`mcod` / `mcod`).
- [ ] **Free the ports.** Nothing else may use ports 80, 443 or 54329. Stop other stacks first, for
  example the dev stacks in `backend_latest/` or `solution/`, with `docker compose down` in their
  folder.

## 4. Build and start (laptop)

All commands in this step run in `deploy/`:

```bash
cd deploy
```

- [ ] **Build the images.** The first build takes 30 to 60 minutes. On Apple Silicon the backend,
  PostGIS and Elasticsearch images run emulated as amd64.
  ```bash
  docker compose build
  ```
- [ ] **Collect the static files** for the Django admin and the CMS:
  ```bash
  docker compose run --rm mcod-admin python manage.py collectstatic --noinput
  ```
- [ ] **Start everything.** The script prints the URLs. Write down the domain, for example
  `10-250-162-60.sslip.io`.
  ```bash
  ./laptop.sh
  ```
  - `mcod-api` runs the database migrations when it starts.
  - Wait until `docker compose ps` shows every container as `Up`.
  - If macOS asks whether Docker may accept incoming connections, choose **Allow**.
- [ ] **Load the portal's initial data**, including the categories and the test accounts:
  ```bash
  docker compose run --rm mcod-admin python manage.py init_mcod_db
  ```
- [ ] **Build the search index:**
  ```bash
  docker compose run --rm mcod-admin python manage.py search_index --rebuild -f
  ```
- [ ] **Create your own admin account** (optional; the test accounts are listed in [step 6](#6-use-it)):
  ```bash
  docker compose run --rm mcod-admin python manage.py createsuperuser
  ```
- [ ] **Load the AED data standard and the example providers.** This creates:
  - the institutions for Krosno, Przemyśl, Marki and Warsaw, with their representative accounts;
  - their AED register datasets and the providers' original files;
  - the coordinator institution that publishes the national list.

  ```bash
  docker compose run --rm mcod-admin python manage.py load_data_standards
  docker compose run --rm mcod-admin python manage.py load_aed_providers
  ```
- [ ] **Fill the AED map database.** This pulls OpenAEDMap, then Warsaw, then Kraków. It runs from
  `solution/`:
  ```bash
  cd ../solution && ./pull_all.sh && cd ../deploy
  ```
  - `WarsawAPI` needs `WARSAW_API_KEY` in your environment, or in a `.env` file in
    `solution/importer`. Get a key at https://dane.um.warszawa.pl/pl/key-api.
  - Without a key, that one source fails and the others still import.
- [ ] **Optional: add the AED map database to the portal as a provider.**
  1. Export it to a file in the AED standard. Run this in `solution/importer`:
     ```bash
     AED_DSN=postgresql://aed:aed@127.0.0.1:54329/aed uv run python -m aed_import.export_standard --out aed_baza.csv
     ```
  2. Load the file with `manage.py load_aed_providers --config <your providers.json>`. Use
     `backend_latest/data/standards/aed/providers/providers.json` as the template for that config.
- [ ] **Build the national AED list.** Normally a nightly Celery job (04:00) does this. The deploy
  stack doesn't run the Celery scheduler ("beat"), so run it by hand after loading or changing data:
  ```bash
  docker compose run --rm mcod-admin python manage.py build_standard_aggregate aed
  ```
- [ ] **Restart the portal's nginx.** nginx looks up the container addresses only once, when it
  starts. If containers were recreated since then, `https://api.<domain>` returns 502.
  ```bash
  docker compose restart mcod-nginx
  ```
- [ ] **Trust the local certificates** on each device that will open the site. On a laptop, Caddy
  issues certificates from its own certificate authority.
  - **This Mac:**
    ```bash
    curl -o /tmp/caddy-root.crt http://ca.<domain>
    sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/caddy-root.crt
    ```
  - **iPhone:**
    1. In Safari, open `http://ca.<domain>` and tap Allow.
    2. Settings → Profile Downloaded → Install.
    3. Settings → General → About → Certificate Trust Settings → turn on "Caddy Local Authority".
  - **Android:** download `http://ca.<domain>`, then Settings → Security → Encryption & credentials →
    Install a certificate → CA certificate.
  - Without this, browsers show a warning you can click through. Some mobile browsers then also block
    location access, which the AED finder needs.

## 5. Server instead of a laptop

Replace step 4 with the following:

- [ ] **Open the firewall** for ports 22, 80 and 443 only.
- [ ] **Raise the Elasticsearch memory-map limit:**
  ```bash
  sudo sysctl -w vm.max_map_count=262144
  ```
  To keep it after a reboot, add `vm.max_map_count=262144` to `/etc/sysctl.conf`.
- [ ] **Set the public domain** in `deploy/.env`. It is the server's public IPv4 address with dashes
  plus `.sslip.io`, for example `PUBLIC_DOMAIN=203-0-113-10.sslip.io`. Find the address with
  `curl -4 ifconfig.me`.
- [ ] **Start the stack** with `docker compose up -d` instead of `./laptop.sh`.
  - Run all the other commands from step 4 as they are.
  - Skip the certificate step: Caddy gets Let's Encrypt certificates automatically.

## 6. Use it

Replace `<domain>` with the domain from step 4, for example `10-250-162-60.sslip.io`.

| What | URL | Login |
|---|---|---|
| Portal (Angular) | `https://<domain>` | – |
| **National AED list (table + map)** | `https://<domain>/pl/aed` | – |
| Portal API | `https://api.<domain>` (e.g. `/datasets`, `/standards/aed/aggregated`) | – |
| Admin panel | `https://admin.<domain>` | `admin@mcod.local` / `testadmin123!` |
| CMS (Wagtail) | `https://cms.<domain>/admin` | same as the admin panel |
| AED map | `https://aed.<domain>` | – |
| AED mobile finder | `https://m.<domain>` | – |
| AED data converter | `https://konwerter.<domain>` | – |
| Captured e-mail / Celery monitor | `https://mail.<domain>`, `https://flower.<domain>` | `TOOLS_USER` + your password |

Representative accounts for the example AED providers all use the password `AedTest123!` (local use
only): `aed.krosno@mcod.local`, `aed.przemysl@mcod.local`, `aed.marki@mcod.local`,
`aed.warszawa@mcod.local`, and the coordinator `aed.koordynator@mcod.local`.

### Check that it works

- [ ] `https://<domain>` shows the "Otwarte Dane" portal.
- [ ] `https://api.<domain>/datasets` returns JSON with datasets.
- [ ] `https://api.<domain>/standards/aed/aggregated` returns the national list summary, with
  `rows` > 0 and a list of providers.
- [ ] `https://<domain>/pl/aed` shows the national AED list, and the **Tabela** (table) tab lists
  devices.
- [ ] `https://admin.<domain>` lets you log in.
- [ ] `https://aed.<domain>` shows AED pins on the map.

### Try the manual and automatic data feeds

- [ ] **Manual upload:**
  1. Log in to the admin panel as a representative, for example `aed.krosno@mcod.local`.
  2. Open the institution's AED dataset and add a resource with a CSV file.
  3. The file is checked against the AED standard. The result is on the file's "Data standard" tab.
     A file that conforms is published; one that doesn't stays a draft.
- [ ] **Automatic harvest (Marki demo):** follow
  [solution/feed/README.md → Demo on the local portal](solution/feed/README.md).
  1. Generate the feed into `backend_latest/media/feeds`.
  2. Register it under Admin → Harvester as an XML data source for Urząd Miasta Marki.
  3. Run the import. The original file stays a draft.
  4. Switch to the corrected file, generate the feed again and run the import again. The file is
     published.
- [ ] After either feed, rebuild the national list:
  `docker compose run --rm mcod-admin python manage.py build_standard_aggregate aed`

## 7. Everyday commands

Run these in `deploy/`:

- **Status:** `docker compose ps`
- **Logs:** `docker compose logs -f mcod-api caddy` (any service names)
- **Stop (data is kept):** `./laptop.sh down`
- **Start again:** `./laptop.sh`
  - Run it again after moving to another Wi-Fi network, because every URL changes with the IP.
  - Certificates you already installed stay valid.
- **Update after `git pull`:** `./laptop.sh --build`, then `docker compose restart mcod-nginx`
- **Keep the Mac awake while presenting:** `caffeinate -dis`

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `Port 80/443/54329 is taken by …` | Stop the stack that holds the port (`docker compose down` in its folder). For the AED database you can use another port: `AED_DB_HOST_PORT=54339 ./laptop.sh` |
| `https://api.<domain>` returns 502, but `https://<domain>/api/datasets` works | `docker compose restart mcod-nginx` |
| Containers exit with code 137 | Docker is out of memory: raise Docker Desktop memory to 12 GB or more |
| Elasticsearch won't start (server) | `sudo sysctl -w vm.max_map_count=262144` |
| `/pl/aed` says "Wykaz nie jest jeszcze dostępny" (the list is not available yet) | Run `load_data_standards`, `load_aed_providers`, then `build_standard_aggregate aed` |
| Phones can't connect | The venue Wi-Fi isolates devices from each other: use a phone hotspot that the laptop and the phones all join |
| Browser shows a certificate warning, or the AED finder can't get your location | Install the Caddy certificate from `http://ca.<domain>` (step 4) |
| `Pool overlaps with other one on this address space` (only when using the `backend_latest` dev compose) | The dev stack needs the subnet `172.18.18.0/24`. Remove the unused Docker network that overlaps it, or use the `deploy/` stack, which doesn't need a fixed subnet |
