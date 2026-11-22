// Minimal read-only API over the AED schema (solution/sql).
//   GET /api/sites          - all fixed sites as map pins
//   GET /api/sites/:id      - everything the info card shows
//   GET /api/nearest        - ?lat=&lon=[&limit=&max_m=] -> nearest_available_aed()
//   GET /api/cells/:geohash - offline cell for the mobile finder (src/mobile)
//   POST /api/reports       - citizen report from the mobile "Skaner AED"; GET lists the latest
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express from 'express';
import pg from 'pg';
import { CELL_PRECISION, GEOHASH_RE, geohashBounds } from '../src/mobile/geo.js';

const pool = new pg.Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'aed',
  password: process.env.PGPASSWORD ?? 'aed',
  database: process.env.PGDATABASE ?? 'aed',
});

// Return dates as plain 'YYYY-MM-DD' strings instead of JS Date at local midnight.
pg.types.setTypeParser(1082, (v) => v);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const app = express();
app.use(compression());

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'database error' });
  });

app.get('/api/health', wrap(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));

// Pins: location + just enough to colour them. Kept lean because the client
// loads every site once and clusters them itself (supercluster).
//   state = 'down'    all devices out_of_service/removed
//           'open'    open now (24/7 or matching availability_rule)
//           'closed'  closed now
//           'unknown' no hours known
// "Open now" only changes on minute boundaries, so the result is cached briefly.
const SITES_TTL_MS = 60_000;
let sitesCache = { at: 0, body: null, pending: null };

async function loadSites() {
  const { rows } = await pool.query(`
    SELECT s.site_id,
           s.name,
           round(ST_Y(s.location::geometry)::numeric, 6)::float8 AS lat,
           round(ST_X(s.location::geometry)::numeric, 6)::float8 AS lon,
           CASE WHEN d.total > 0 AND d.usable = 0 THEN 'down'
                WHEN o.open_now IS TRUE  THEN 'open'
                WHEN o.open_now IS FALSE THEN 'closed'
                ELSE 'unknown' END AS state
    FROM aed_site s
    CROSS JOIN LATERAL (SELECT site_open_at(s.site_id) AS open_now) o
    CROSS JOIN LATERAL (
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE dv.status IN ('active', 'unknown'))::int AS usable
        FROM aed_device dv WHERE dv.site_id = s.site_id
    ) d`);
  return JSON.stringify(rows);
}

app.get('/api/sites', wrap(async (_req, res) => {
  if (!sitesCache.body || Date.now() - sitesCache.at > SITES_TTL_MS) {
    // Concurrent requests share one in-flight query.
    sitesCache.pending ??= loadSites()
      .then((body) => { sitesCache = { at: Date.now(), body, pending: null }; })
      .finally(() => { sitesCache.pending = null; });
    await sitesCache.pending;
  }
  res.type('json').set('Cache-Control', 'max-age=30').send(sitesCache.body);
}));

app.get('/api/sites/:id', wrap(async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid site id' });

  const site = await pool.query(`
    SELECT s.site_id, s.name, s.indoor, s.floor_level, s.placement_pl, s.placement_en,
           s.access_type, s.access_note, s.opening_hours_raw, s.is_24_7,
           s.wheelchair_accessible, s.cabinet_type, s.cabinet_locked, s.unlock_method,
           s.device_count_reported, s.confidence_score, s.last_verified_at,
           s.geocode_method, s.position_accuracy_m, s.osm_poi_ref, s.updated_at,
           ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lon,
           site_open_at(s.site_id) AS open_now,
           v.name AS voivodeship,
           json_build_object('street', a.street, 'house_number', a.house_number,
                             'postcode', a.postcode, 'city', a.city) AS address,
           CASE WHEN o.org_id IS NULL THEN NULL ELSE
             json_build_object('name', o.name, 'org_type', o.org_type, 'phone', o.phone,
                               'email', o.email, 'website', o.website) END AS operator
    FROM aed_site s
    LEFT JOIN address      a ON a.address_id = s.address_id
    LEFT JOIN organization o ON o.org_id     = s.operator_org_id
    LEFT JOIN admin_unit   v ON v.teryt_code = s.voivodeship_teryt
    WHERE s.site_id = $1`, [id]);
  if (site.rowCount === 0) return res.status(404).json({ error: 'site not found' });

  const [devices, rules, media, sources, issues, timeline] = await Promise.all([
    pool.query(`
      SELECT d.device_id, d.serial_number, d.status, d.paediatric_capable, d.installed_at,
             d.battery_expiry, d.pads_expiry, d.funding_programme,
             m.name AS model, m.fully_automatic, mf.short_name AS manufacturer,
             ow.name AS owner,
             li.inspected_at AS last_inspected_at, li.result AS last_inspection_result
      FROM aed_device d
      LEFT JOIN device_model m  ON m.model_id = d.model_id
      LEFT JOIN organization mf ON mf.org_id  = m.manufacturer_org_id
      LEFT JOIN organization ow ON ow.org_id  = d.owner_org_id
      LEFT JOIN LATERAL (
          SELECT i.inspected_at, i.result FROM inspection i
          WHERE i.device_id = d.device_id ORDER BY i.inspected_at DESC LIMIT 1
      ) li ON true
      WHERE d.site_id = $1
      ORDER BY d.status = 'active' DESC, d.serial_number`, [id]),
    pool.query(`
      SELECT weekday, to_char(open_from, 'HH24:MI') AS open_from,
             to_char(open_to, 'HH24:MI') AS open_to, public_holiday
      FROM availability_rule WHERE site_id = $1
      ORDER BY public_holiday, weekday NULLS FIRST, open_from`, [id]),
    pool.query(`SELECT url, license, source_ref FROM media WHERE site_id = $1`, [id]),
    pool.query(`
      SELECT ds.name AS source, ds.licence, ds.redistributable, sr.external_id,
             sr.match_method, sr.last_seen_at
      FROM source_record sr JOIN data_source ds ON ds.source_id = sr.source_id
      WHERE sr.site_id = $1 ORDER BY ds.name`, [id]),
    pool.query(`
      SELECT issue_type, reported_via, reported_at, status
      FROM issue_report
      WHERE site_id = $1 OR device_id IN (SELECT device_id FROM aed_device WHERE site_id = $1)
      ORDER BY reported_at DESC`, [id]),
    pool.query(`
      SELECT event_at, event_type, actor, note
      FROM v_aed_timeline WHERE site_id = $1
      ORDER BY event_at DESC LIMIT 15`, [id]),
  ]);

  res.json({
    ...site.rows[0],
    devices: devices.rows,
    availability: rules.rows,
    media: media.rows,
    sources: sources.rows,
    issues: issues.rows,
    timeline: timeline.rows,
  });
}));

app.get('/api/nearest', wrap(async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const limit = Math.min(Number(req.query.limit ?? 5), 50);
  const maxM = Math.min(Number(req.query.max_m ?? 2000), 50000);
  if (![lat, lon, limit, maxM].every(Number.isFinite)) {
    return res.status(400).json({ error: 'lat and lon are required numbers' });
  }
  const { rows } = await pool.query(
    'SELECT * FROM nearest_available_aed($1, $2, now(), $3, $4)',
    [lat, lon, limit, maxM],
  );
  res.json(rows);
}));

// Offline cell for the mobile finder (src/mobile): every fixed site inside one
// geohash cell, with everything needed to pick, guide to and describe an AED
// WITHOUT the network (opening rules travel with the site; the phone evaluates
// "open now" itself). The phone keeps its cell + 8 neighbours in IndexedDB.
// Static per cell, so in production this is a file on a CDN, not a query.
const CELL_TTL_MS = 5 * 60_000;
const cellCache = new Map();

async function loadCell(gh) {
  const b = geohashBounds(gh);
  const { rows } = await pool.query(`
    SELECT s.site_id AS id, s.name,
           round(ST_Y(s.location::geometry)::numeric, 6)::float8 AS lat,
           round(ST_X(s.location::geometry)::numeric, 6)::float8 AS lon,
           s.position_accuracy_m AS pos_acc, s.indoor, s.floor_level AS floor,
           s.placement_pl AS placement, s.access_type AS access, s.access_note,
           s.is_24_7 AS h24, s.opening_hours_raw AS hours_raw,
           s.cabinet_locked AS locked, s.unlock_method AS unlock, s.last_verified_at AS verified,
           nullif(concat_ws(', ', nullif(concat_ws(' ', a.street, a.house_number), ''), a.city), '') AS address,
           o.name AS operator, o.phone,
           (SELECT json_agg(json_build_array(r.weekday, to_char(r.open_from, 'HH24:MI'),
                                             to_char(r.open_to, 'HH24:MI')))
              FROM availability_rule r
             WHERE r.site_id = s.site_id AND NOT r.public_holiday
               AND (r.valid_from IS NULL OR r.valid_from <= current_date)
               AND (r.valid_to   IS NULL OR r.valid_to   >= current_date)) AS hours,
           d.total AS devices, d.usable AS usable, d.paed,
           (SELECT m.url FROM media m WHERE m.site_id = s.site_id LIMIT 1) AS photo
    FROM aed_site s
    LEFT JOIN address      a ON a.address_id = s.address_id
    LEFT JOIN organization o ON o.org_id     = s.operator_org_id
    CROSS JOIN LATERAL (
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE dv.status IN ('active', 'unknown') AND NOT dv.is_mobile)::int AS usable,
               bool_or(dv.paediatric_capable) AS paed
        FROM aed_device dv WHERE dv.site_id = s.site_id
    ) d
    WHERE s.access_type IS DISTINCT FROM 'no'
      AND ST_Y(s.location::geometry) >= $1 AND ST_Y(s.location::geometry) < $2
      AND ST_X(s.location::geometry) >= $3 AND ST_X(s.location::geometry) < $4`,
  [b.s, b.n, b.w, b.e]);
  // Drop null fields: a dense city cell is a few thousand sites.
  const sites = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null)));
  return JSON.stringify({ cell: gh, generated_at: new Date().toISOString(), sites });
}

app.get('/api/cells/:gh', wrap(async (req, res) => {
  const gh = req.params.gh.replace(/\.json$/, '').toLowerCase();
  if (!GEOHASH_RE.test(gh) || gh.length !== CELL_PRECISION) {
    return res.status(400).json({ error: `expected a geohash of length ${CELL_PRECISION}` });
  }
  let hit = cellCache.get(gh);
  if (!hit || Date.now() - hit.at > CELL_TTL_MS) {
    hit = { at: Date.now(), body: await loadCell(gh) };
    cellCache.set(gh, hit);
  }
  res.type('json').set('Cache-Control', 'max-age=300').send(hit.body);
}));

// Citizen reports from the mobile "Skaner AED" (sql/10_citizen_report.sql).
// JSON body; the photo comes as a downscaled JPEG data URL and is stored on
// disk (server/uploads/). An "issue" about a known site is also mirrored into
// issue_report so it shows up on the map card right away.
const UPLOAD_DIR = fileURLToPath(new URL('./uploads/', import.meta.url));
const REPORT_KINDS = new Set(['new', 'confirm', 'issue']);
const ISSUE_TYPES = new Set(['missing', 'broken', 'moved', 'wrong_hours', 'locked']);
const ACCESS_TYPES = new Set(['yes', 'customers', 'permit', 'private', 'no']);
const str = (v, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const bool = (v) => (typeof v === 'boolean' ? v : null);

app.post('/api/reports', express.json({ limit: '6mb' }), wrap(async (req, res) => {
  const b = req.body ?? {};
  const lat = Number(b.lat); const lon = Number(b.lon);
  if (!REPORT_KINDS.has(b.kind) || !Number.isFinite(lat) || !Number.isFinite(lon)
      || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'kind, lat and lon are required' });
  }
  const issueType = b.kind === 'issue' ? b.issue_type : null;
  if (b.kind === 'issue' && !ISSUE_TYPES.has(issueType)) return res.status(400).json({ error: 'bad issue_type' });
  const siteId = typeof b.site_id === 'string' && UUID_RE.test(b.site_id) ? b.site_id : null;
  const note = str(b.note, 1000) ?? (b.kind !== 'new' && !siteId ? `site ref: ${str(b.site_id, 80) ?? '?'}` : null);

  let photoPath = null;
  const m = typeof b.photo === 'string' && b.photo.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (m) {
    await mkdir(UPLOAD_DIR, { recursive: true });
    photoPath = `${randomUUID()}.jpg`;
    await writeFile(UPLOAD_DIR + photoPath, Buffer.from(m[1], 'base64')); // UPLOAD_DIR ends with '/'
  }

  const { rows } = await pool.query(`
    INSERT INTO citizen_report (kind, site_id, issue_type, location, position_accuracy_m, placement_pl,
                                floor_level, indoor, access_type, is_24_7, cabinet_locked, note, photo_path, client_ref)
    VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING report_id, status, reported_at`,
  [b.kind, siteId, issueType, lat, lon,
    Number.isFinite(Number(b.accuracy)) ? Math.round(Number(b.accuracy)) : null,
    str(b.placement), str(b.floor, 20), bool(b.indoor),
    ACCESS_TYPES.has(b.access) ? b.access : null, bool(b.h24), bool(b.locked),
    note, photoPath, str(b.client_ref, 64)]);

  if (b.kind === 'issue' && siteId && issueType !== 'locked') {
    await pool.query(
      `INSERT INTO issue_report (site_id, issue_type, reported_via) VALUES ($1, $2, 'app')`,
      [siteId, issueType],
    );
  }
  res.status(201).json(rows[0]);
}));

app.get('/api/reports', wrap(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT report_id, kind, site_id, issue_type, placement_pl, status, reported_at, photo_path IS NOT NULL AS has_photo,
           ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
    FROM citizen_report ORDER BY reported_at DESC LIMIT 50`);
  res.json(rows);
}));

// The UI is served by Vite, not by this API; send stray browser visits there.
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5173';
app.get('/', (_req, res) => res.redirect(WEB_URL));

const port = Number(process.env.API_PORT ?? 3001);
app.listen(port, () => console.log(`AED API listening on :${port} (JSON only). Open the app at ${WEB_URL}`));
