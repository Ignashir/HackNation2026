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

## Known limitations

- The client still downloads all sites once (fine at about 19k). Well beyond about 100k, switch to server-side
  clustering per bbox and zoom (e.g. `ST_SnapToGrid` / `ST_ClusterDBSCAN` with the GiST index).
- Public holidays are not passed to `site_open_at()` (it is always called with `p_is_holiday = false`).
- Map tiles come from the public OSM tile server, which is fine for a demo. Production needs our own tiles or a provider.
