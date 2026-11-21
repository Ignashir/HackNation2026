// Minimal read-only API over the AED schema (solution/sql).
//   GET /api/sites          - all fixed sites as map pins
//   GET /api/sites/:id      - everything the info card shows
//   GET /api/nearest        - ?lat=&lon=[&limit=&max_m=] -> nearest_available_aed()
import express from 'express';
import pg from 'pg';

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

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'database error' });
  });

app.get('/api/health', wrap(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));

// Pins: location + just enough to colour them.
//   state = 'down'    all devices out_of_service/removed
//           'open'    open now (24/7 or matching availability_rule)
//           'closed'  closed now
//           'unknown' no hours known
app.get('/api/sites', wrap(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT s.site_id,
           s.name,
           ST_Y(s.location::geometry) AS lat,
           ST_X(s.location::geometry) AS lon,
           s.is_24_7,
           a.city,
           o.open_now,
           d.total AS device_count,
           CASE WHEN d.total > 0 AND d.usable = 0 THEN 'down'
                WHEN o.open_now IS TRUE  THEN 'open'
                WHEN o.open_now IS FALSE THEN 'closed'
                ELSE 'unknown' END AS state
    FROM aed_site s
    LEFT JOIN address a ON a.address_id = s.address_id
    CROSS JOIN LATERAL (SELECT site_open_at(s.site_id) AS open_now) o
    CROSS JOIN LATERAL (
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE dv.status IN ('active', 'unknown'))::int AS usable
        FROM aed_device dv WHERE dv.site_id = s.site_id
    ) d
    ORDER BY s.name`);
  res.json(rows);
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

// The UI is served by Vite, not by this API; send stray browser visits there.
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5173';
app.get('/', (_req, res) => res.redirect(WEB_URL));

const port = Number(process.env.API_PORT ?? 3001);
app.listen(port, () => console.log(`AED API listening on :${port} (JSON only). Open the app at ${WEB_URL}`));
