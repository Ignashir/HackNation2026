# AED map (prototype)

A React + Leaflet map of Poland showing AED sites from the unified AED database in [`../sql`](../sql).
Clicking a pin opens a card with everything the DB knows about the site: exact placement, access and opening hours,
devices (model, status, battery/pads expiry, last inspection), operator, open issue reports, data quality,
sources, and change history.

**The data is dummy data**, from [`../sql/dev/seed_dummy.sql`](../sql/dev/seed_dummy.sql): 19 sites across all
16 voivodeships, every name prefixed `DEMO ·`.

## Run it

Requirements: Docker and Node 20+.

```bash
cd solution/app
npm install
npm run db:up      # PostGIS on localhost:5433; first start loads sql/init.sql + dev/seed_dummy.sql
npm run dev        # API on :3001 + Vite on :5173
```

Open http://localhost:5173.

- `npm run db:reset` wipes the volume and rebuilds the DB. Use it after changing anything in `solution/sql`
  (the init scripts only run on an empty volume).
- DB credentials: `aed` / `aed`, database `aed`, port **5433** (5432 was already taken on the dev machine).
  To use another DB, set `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` for the API.
- Shell into the DB: `docker exec -it aed-db psql -U aed -d aed`

## Layout

| Path | What |
|---|---|
| `docker-compose.yml`, `db/initdb.sh` | `postgis/postgis:17-3.5`; mounts `../sql` read-only and runs `init.sql`, then the dummy seed |
| `server/index.js` | Express, read-only API (Vite proxies `/api` to it) |
| `src/components/AedMap.jsx` | Leaflet map, pins coloured by state, fly-to, legend |
| `src/components/AedCard.jsx` | Info card (side panel on desktop, bottom sheet on phones) |
| `src/labels.js` | Polish labels for the schema's enum values |

## API

| Endpoint | Backed by |
|---|---|
| `GET /api/sites` | `aed_site` + `site_open_at()` + device counts. One row per pin, with `state` = `open` / `closed` / `unknown` / `down` |
| `GET /api/sites/:id` | Site, address, operator, devices + models + last inspection, `availability_rule`, `media`, `source_record`, `issue_report`, `v_aed_timeline` |
| `GET /api/nearest?lat=&lon=&limit=&max_m=` | `nearest_available_aed()`, used by the "Najbliższy AED" button (browser geolocation) |
| `GET /api/cells/:geohash` | Offline cell for the mobile finder: every site in one geohash-4 cell, with opening rules |
| `POST /api/reports`, `GET /api/reports` | Mobile "Skaner AED" reports → `citizen_report` (+ `issue_report` for issues); GET lists the latest 50 |

Pin colours: green = open now, amber = closed now, grey = hours unknown, red = all devices out of service.

**Grouping (clustering):** the client loads every site once and groups them with
[supercluster](https://github.com/mapbox/supercluster) (`ClusteredSites` in `AedMap.jsx`).
- Only the groups and pins inside the current view are drawn (tens to a few hundred markers, never 19k).
- A bubble shows the count, and its ring shows the open/closed/unknown/broken mix inside.
- Clicking a bubble zooms to where it splits. From zoom 16 (`SITE_ZOOM`) every AED is its own pin.
- Tuning knobs: `CLUSTER_RADIUS_PX` (80) and `CLUSTER_MAX_ZOOM` (15).

Tested with 19k synthetic sites: about 0.7 MB gzipped payload and an under-0.2 s index build, with no multi-second stalls.
`GET /api/sites` is gzipped and cached for 60 s on the server. Since "open now" changes per minute, that delay doesn't matter.

For a local load test: `docker exec -i aed-db psql -U aed -d aed < ../sql/dev/seed_stress.sql`
(19k `STRESS ·` sites; `npm run db:reset` removes them).

**My location:** on load the app asks for geolocation and tracks it continuously
(`src/useGeolocation.js`, `watchPosition`). It shows a pulsing blue dot with an accuracy circle, plus a heading cone
on devices that report direction. The button under the zoom controls re-centres the map on you, and
"Najbliższy AED" uses the same tracked position. Browsers only allow geolocation on `localhost` or HTTPS.

## Mobile concept: "Najbliższy AED" (`/mobile.html`)

A prototype of AED features inside a static look-alike of the current mObywatel app. It has the tabs Dokumenty,
Usługi, Kod QR and Więcej, and follows the system light/dark mode. The emblem and wording are generic, not the
official branding. Only the AED parts work; every other item shows a "makieta" (mock-up) toast.

- **AED pill in the header** (green, with the distance, on every tab) and **Usługi → Ratunek → Najbliższy AED**
  open the "Find My"-style finder: an arrow, a rounded distance, a turn hint and details that help you find the
  device (placement, floor, access, unlock method, hours). It switches to "Jesteś blisko" once you are within
  GPS accuracy, then shows how to use an AED.
- **Usługi → Ratunek → Skaner AED**: take a photo (live camera, gallery, or a sample photo when there is no
  camera). If the offline cache has an AED within 25–60 m, you confirm it or report a problem: locked, broken,
  missing or moved. Otherwise you describe a new AED (placement, indoor, floor, 24/7, locked, access).
  The photo, position and answers go to `POST /api/reports` and land in `citizen_report`
  ([`sql/10_citizen_report.sql`](../sql/10_citizen_report.sql)) with status `pending`, for the data provider
  to review. Photos are saved in `server/uploads/` (gitignored). An issue about a known site is also copied into
  `issue_report`, so it shows on the map card. Without signal, the report waits in an IndexedDB outbox and is
  sent automatically later. "Twoje zgłoszenia" (your reports) shows each one's state.
  There is no image recognition: the photo is evidence for the reviewer.

Open http://localhost:5173/mobile.html, or run `npm run mobile` to serve it at `/`. Through the phone tunnel
(`*.trycloudflare.com`), `/` always serves the mobile app, and the map stays at `/index.html`.
On a laptop it renders inside a phone frame.

> Existing database: `citizen_report` is new. Add it without a reset:
> `docker exec -i aed-db psql -U aed -d aed < ../sql/10_citizen_report.sql`

**Offline by design.** Finding an AED never calls the server:
- `GET /api/cells/:geohash` returns every AED in one geohash-4 cell (~39 x 20 km), including opening rules.
  The Warsaw centre cell is ~790 sites, 45 KB gzipped. In production it would be a static file on a CDN.
- While the app is open, `src/mobile/aedCache.js` keeps the user's cell and its 8 neighbours in IndexedDB.
  It refreshes cells older than 24 h and re-checks when the user moves to a new cell.
- `src/mobile/aedRules.js` decides on the phone whether an AED is open now. It mirrors `site_open_at()`
  (Europe/Warsaw, overnight windows), and `nearest_available_aed()` for the ranking.
- Privacy: the server only learns which ~40 km cell the phone is in, never the position.

**Compass.** iOS asks for motion permission when you tap the AED card (a tap is required).
Android uses `deviceorientationabsolute`. Headings are corrected for Poland's magnetic declination (+6.5°).
Without a compass the arrow is drawn relative to north (N).

**Demo panel** (⚙︎, top right). For a projector with no GPS or compass, or a venue with poor data:
- a simulated position ("Ustaw ~250 m od AED") and a walk to the AED at 1–10× speed
- a simulated compass (slider, "Obróć w stronę AED")
- blocking the network, to prove it works offline
- adding 3 well-described test AEDs around you (stored only on the phone)

The 112 button deliberately does not dial in this prototype.

### On an iPhone

iOS gives location and compass access only to HTTPS pages, and from WSL2 the phone can't reach the dev server
directly. A Cloudflare quick tunnel solves both, with no account needed:

```bash
# one-time install (single binary)
curl -fsSL -o ~/.local/bin/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x ~/.local/bin/cloudflared

npm run dev       # terminal 1
npm run tunnel    # terminal 2: prints https://<random>.trycloudflare.com
```

Open `https://<random>.trycloudflare.com` in Safari (the mobile app is served at `/` there), then Share → Add to Home Screen for the full-screen app.
On iOS, Settings → Privacy & Security → Location Services → Safari Websites must be "While Using".
Anyone with the URL can reach the dev server while the tunnel runs, so stop it when you're done.

## Known limitations

- The client still downloads all sites once (fine at about 19k). Well beyond about 100k, switch to server-side
  clustering per bbox and zoom (e.g. `ST_SnapToGrid` / `ST_ClusterDBSCAN` with the GiST index).
- Public holidays are not passed to `site_open_at()` (it is always called with `p_is_holiday = false`).
- Map tiles come from the public OSM tile server, which is fine for a demo. Production needs our own tiles or a provider.
