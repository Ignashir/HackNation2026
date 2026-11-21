-- =====================================================================
-- 07_functions_views.sql
-- Query helpers on top of the ERD:
--   * site_open_at()          - is a site open at a given moment?
--   * nearest_available_aed() - "nearest available AED now" (GiST + rules)
--   * v_device_maintenance_due - batteries/pads expiring soon
-- =====================================================================

-- ---------------------------------------------------------------------
-- site_open_at: true = open, false = closed, NULL = hours unknown
-- (not 24/7 and no availability rules). Times are evaluated in
-- Europe/Warsaw. Windows with open_to < open_from run past midnight.
-- On a public holiday, the site's PH rules apply if it has any;
-- otherwise its normal weekday rules apply (OSM semantics).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION site_open_at(
    p_site_id     uuid,
    p_at          timestamptz DEFAULT now(),
    p_is_holiday  boolean     DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    WITH loc AS (
        SELECT (p_at AT TIME ZONE 'Europe/Warsaw')::date               AS d,
               (p_at AT TIME ZONE 'Europe/Warsaw')::time               AS tm,
               extract(isodow FROM p_at AT TIME ZONE 'Europe/Warsaw')::int AS dow
    ),
    use_ph AS (
        SELECT p_is_holiday AND EXISTS (
                   SELECT 1 FROM availability_rule h
                   WHERE h.site_id = p_site_id AND h.public_holiday) AS v
    ),
    rules AS (
        SELECT r.*
        FROM availability_rule r, use_ph
        WHERE r.site_id = p_site_id
          AND r.public_holiday = use_ph.v
    )
    SELECT CASE
        WHEN s.is_24_7 THEN true
        WHEN NOT EXISTS (SELECT 1 FROM availability_rule a WHERE a.site_id = p_site_id) THEN NULL
        ELSE EXISTS (
            SELECT 1
            FROM rules r, loc
            WHERE
                -- window starting today
                (    (r.weekday IS NULL OR r.weekday = loc.dow)
                 AND (r.valid_from IS NULL OR r.valid_from <= loc.d)
                 AND (r.valid_to   IS NULL OR loc.d <= r.valid_to)
                 AND loc.tm >= r.open_from
                 AND (r.open_to < r.open_from OR loc.tm < r.open_to))
                OR
                -- overnight window that started yesterday
                (    r.open_to < r.open_from
                 AND (r.weekday IS NULL OR r.weekday = (loc.dow + 5) % 7 + 1)
                 AND (r.valid_from IS NULL OR r.valid_from <= loc.d - 1)
                 AND (r.valid_to   IS NULL OR loc.d - 1 <= r.valid_to)
                 AND loc.tm < r.open_to)
        )
    END
    FROM aed_site s
    WHERE s.site_id = p_site_id;
$$;

COMMENT ON FUNCTION site_open_at(uuid, timestamptz, boolean) IS
    'true/false = open/closed at p_at (Europe/Warsaw); NULL = hours unknown.';


-- ---------------------------------------------------------------------
-- nearest_available_aed: fixed AED sites within p_max_distance_m of a
-- point, nearest first, that are open (or of unknown hours if allowed)
-- and not known to be dead (a site whose devices are all out of service
-- or removed is skipped; a site with no device rows yet is kept).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nearest_available_aed(
    p_lat                   double precision,
    p_lon                   double precision,
    p_at                    timestamptz      DEFAULT now(),
    p_limit                 integer          DEFAULT 5,
    p_max_distance_m        double precision DEFAULT 2000,
    p_include_unknown_hours boolean          DEFAULT true,
    p_is_holiday            boolean          DEFAULT false
)
RETURNS TABLE (
    site_id         uuid,
    name            text,
    distance_m      double precision,
    open_now        boolean,
    access_type     text,
    placement_pl    text,
    unlock_method   text,
    usable_devices  integer
)
LANGUAGE sql
STABLE
AS $$
    WITH p AS (
        SELECT ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography AS g
    ),
    cand AS (
        SELECT s.site_id, s.name, s.access_type, s.placement_pl, s.unlock_method,
               ST_Distance(s.location, p.g) AS dist
        FROM aed_site s, p
        WHERE ST_DWithin(s.location, p.g, p_max_distance_m)
          AND s.access_type IS DISTINCT FROM 'no'
    )
    SELECT c.site_id, c.name, c.dist, o.open_now, c.access_type,
           c.placement_pl, c.unlock_method, d.usable
    FROM cand c
    CROSS JOIN LATERAL (
        SELECT site_open_at(c.site_id, p_at, p_is_holiday) AS open_now
    ) o
    CROSS JOIN LATERAL (
        SELECT count(*) FILTER (WHERE dv.status IN ('active', 'unknown')
                                  AND NOT dv.is_mobile)::int AS usable,
               count(*)::int                                  AS total
        FROM aed_device dv
        WHERE dv.site_id = c.site_id
    ) d
    WHERE (o.open_now OR (o.open_now IS NULL AND p_include_unknown_hours))
      AND (d.total = 0 OR d.usable > 0)
    ORDER BY c.dist
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION nearest_available_aed(double precision, double precision, timestamptz,
                                          integer, double precision, boolean, boolean) IS
    'Nearest open, non-dead fixed AED sites to (lat, lon). Uses the GiST index on aed_site.location.';


-- ---------------------------------------------------------------------
-- v_device_maintenance_due: active devices whose battery or pads expire
-- within 60 days (or already expired), with the latest inspection.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_device_maintenance_due AS
SELECT d.device_id,
       d.site_id,
       s.name                        AS site_name,
       d.serial_number,
       m.name                        AS model_name,
       d.battery_expiry,
       d.pads_expiry,
       LEAST(d.battery_expiry, d.pads_expiry) AS next_expiry,
       li.inspected_at               AS last_inspected_at,
       li.result                     AS last_inspection_result,
       COALESCE(op.name, ow.name)    AS responsible_org
FROM aed_device d
LEFT JOIN aed_site     s  ON s.site_id  = d.site_id
LEFT JOIN device_model m  ON m.model_id = d.model_id
LEFT JOIN organization op ON op.org_id  = s.operator_org_id
LEFT JOIN organization ow ON ow.org_id  = d.owner_org_id
LEFT JOIN LATERAL (
    SELECT i.inspected_at, i.result
    FROM inspection i
    WHERE i.device_id = d.device_id
    ORDER BY i.inspected_at DESC
    LIMIT 1
) li ON true
WHERE d.status = 'active'
  AND LEAST(d.battery_expiry, d.pads_expiry) <= current_date + 60;
