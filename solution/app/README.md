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

Pin colours: green = open now, amber = closed now, grey = hours unknown, red = all devices out of service.

**My location:** on load the app asks for geolocation and tracks it continuously
(`src/useGeolocation.js`, `watchPosition`). It shows a pulsing blue dot with an accuracy circle, plus a heading cone
on devices that report direction. The button under the zoom controls re-centres the map on you, and
"Najbliższy AED" uses the same tracked position. Browsers only allow geolocation on `localhost` or HTTPS.

## Known limitations

- All pins are loaded at once. That's fine for hundreds of sites; for the national dataset (tens of thousands),
  add bbox filtering (`ST_MakeEnvelope` + the GiST index) and marker clustering.
- Public holidays are not passed to `site_open_at()` (it is always called with `p_is_holiday = false`).
- Map tiles come from the public OSM tile server, which is fine for a demo. Production needs our own tiles or a provider.
