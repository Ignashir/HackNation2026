-- =====================================================================
-- 03_aed_site.sql
-- AED_SITE (a place where AEDs are), AVAILABILITY_RULE, MEDIA.
-- =====================================================================

-- ---------------------------------------------------------------------
-- AED_SITE: the curated, de-duplicated location. Sources are matched to
-- it through source_record; devices hang off it.
-- ---------------------------------------------------------------------
CREATE TABLE aed_site (
    site_id                uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   text,
    address_id             uuid      REFERENCES address (address_id) ON DELETE SET NULL,
    operator_org_id        uuid      REFERENCES organization (org_id) ON DELETE SET NULL,
    location               geography(Point, 4326) NOT NULL,
    geocode_method         text      CHECK (geocode_method IN ('survey', 'osm', 'address', 'manual')),
    position_accuracy_m    integer   CHECK (position_accuracy_m IS NULL OR position_accuracy_m >= 0),
    indoor                 boolean,
    floor_level            text,
    placement_pl           text,
    placement_en           text,
    access_type            text      CHECK (access_type IN ('yes', 'customers', 'permit', 'private', 'no')),
    access_note            text,
    opening_hours_raw      text,
    is_24_7                boolean   NOT NULL DEFAULT false,
    wheelchair_accessible  boolean,
    cabinet_type           text,
    cabinet_locked         boolean,
    unlock_method          text      CHECK (unlock_method IN ('none', 'code_112', 'key', 'staff')),
    osm_poi_ref            text,
    device_count_reported  integer   CHECK (device_count_reported IS NULL OR device_count_reported >= 0),
    confidence_score       real      CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
    last_verified_at       date,
    voivodeship_teryt      varchar(2) REFERENCES admin_unit (teryt_code)
                                      ON UPDATE CASCADE ON DELETE SET NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT aed_site_osm_poi_ref_format
        CHECK (osm_poi_ref IS NULL OR osm_poi_ref ~ '^(node|way|relation)/[0-9]+$')
);

COMMENT ON TABLE  aed_site IS 'A place where one or more AEDs are installed. Curated from all source records.';
COMMENT ON COLUMN aed_site.name IS 'Site name; OSM rarely names the AED node, so often taken from the enclosing POI.';
COMMENT ON COLUMN aed_site.operator_org_id IS 'Host organisation that keeps the AED (may differ from device owner).';
COMMENT ON COLUMN aed_site.geocode_method IS 'survey|osm|address|manual: how the coordinates were obtained.';
COMMENT ON COLUMN aed_site.floor_level IS 'Floor as text (OSM level can be "0;1", "-1", "parter").';
COMMENT ON COLUMN aed_site.placement_pl IS 'OSM defibrillator:location / Ratuj z Sercem "Dokładne miejsce".';
COMMENT ON COLUMN aed_site.access_type IS 'OSM access vocabulary: yes|customers|permit|private|no.';
COMMENT ON COLUMN aed_site.opening_hours_raw IS 'opening_hours in OSM syntax; parsed into availability_rule.';
COMMENT ON COLUMN aed_site.unlock_method IS 'none|code_112 (code given by dispatcher)|key|staff.';
COMMENT ON COLUMN aed_site.osm_poi_ref IS 'Enclosing building/POI, e.g. way/123456.';
COMMENT ON COLUMN aed_site.device_count_reported IS 'Count stated by a source (e.g. Kraków "Liczba AED").';
COMMENT ON COLUMN aed_site.confidence_score IS '0..1 from number of agreeing sources, recency and verification.';

CREATE INDEX aed_site_location_gix  ON aed_site USING gist (location);
CREATE INDEX aed_site_address_idx   ON aed_site (address_id);
CREATE INDEX aed_site_operator_idx  ON aed_site (operator_org_id);
CREATE INDEX aed_site_24_7_idx      ON aed_site (site_id) WHERE is_24_7;
CREATE INDEX aed_site_name_trgm     ON aed_site USING gin (name gin_trgm_ops);
CREATE INDEX aed_site_voivodeship_idx ON aed_site (voivodeship_teryt);

COMMENT ON COLUMN aed_site.voivodeship_teryt IS
    'Derived: voivodeship TERC code (02..32) from location, else from address. Maintained by trigger; partition key of change_log.';

-- ---------------------------------------------------------------------
-- resolve_voivodeship: voivodeship of a point, from the voivodeship
-- boundaries; if those are not loaded or the point is outside them,
-- by walking the TERYT hierarchy up from the address locality.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_voivodeship(p_location geography, p_address_id uuid)
RETURNS varchar(2)
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        (SELECT au.teryt_code
         FROM admin_unit au
         WHERE au.level = 'voivodeship'
           AND au.boundary IS NOT NULL
           AND ST_Covers(au.boundary, p_location::geometry)
         LIMIT 1),
        (WITH RECURSIVE up AS (
             SELECT au.teryt_code, au.level, au.parent_teryt
             FROM address a
             JOIN admin_unit au ON au.teryt_code = a.teryt_simc
             WHERE a.address_id = p_address_id
             UNION ALL
             SELECT p.teryt_code, p.level, p.parent_teryt
             FROM admin_unit p
             JOIN up ON p.teryt_code = up.parent_teryt
         )
         SELECT teryt_code FROM up WHERE level = 'voivodeship' LIMIT 1)
    );
$$;

CREATE OR REPLACE FUNCTION aed_site_set_voivodeship()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.voivodeship_teryt := resolve_voivodeship(NEW.location, NEW.address_id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER aed_site_set_voivodeship
    BEFORE INSERT OR UPDATE OF location, address_id ON aed_site
    FOR EACH ROW EXECUTE FUNCTION aed_site_set_voivodeship();

-- Re-derive voivodeship_teryt for all sites (run after loading or
-- changing admin_unit boundaries / addresses). Returns rows changed.
CREATE OR REPLACE FUNCTION refresh_site_voivodeship()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE aed_site s
       SET voivodeship_teryt = resolve_voivodeship(s.location, s.address_id)
     WHERE s.voivodeship_teryt IS DISTINCT FROM resolve_voivodeship(s.location, s.address_id);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

CREATE TRIGGER aed_site_set_updated_at
    BEFORE UPDATE ON aed_site
    FOR EACH ROW
    WHEN (OLD.* IS DISTINCT FROM NEW.*)   -- no-op re-imports keep updated_at
    EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------
-- AVAILABILITY_RULE: structured opening hours, parsed from opening_hours.
-- A site is available when is_24_7 or any rule matches the moment.
-- ---------------------------------------------------------------------
CREATE TABLE availability_rule (
    rule_id         uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid      NOT NULL REFERENCES aed_site (site_id) ON DELETE CASCADE,
    weekday         smallint  CHECK (weekday BETWEEN 1 AND 7),
    open_from       time      NOT NULL,
    open_to         time      NOT NULL,
    public_holiday  boolean   NOT NULL DEFAULT false,
    valid_from      date,
    valid_to        date,

    CONSTRAINT availability_rule_valid_range
        CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to),
    CONSTRAINT availability_rule_nonempty CHECK (open_from <> open_to)
);

COMMENT ON COLUMN availability_rule.weekday IS 'ISO weekday 1=Mon..7=Sun; NULL = every day.';
COMMENT ON COLUMN availability_rule.open_to IS 'If open_to < open_from the window runs past midnight. Use 24:00 for end of day.';
COMMENT ON COLUMN availability_rule.public_holiday IS 'true = rule applies on public holidays (OSM "PH").';

CREATE INDEX availability_rule_site_idx ON availability_rule (site_id, weekday);


-- ---------------------------------------------------------------------
-- MEDIA: photos of the site/AED.
-- ---------------------------------------------------------------------
CREATE TABLE media (
    media_id    uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id     uuid  NOT NULL REFERENCES aed_site (site_id) ON DELETE CASCADE,
    url         text  NOT NULL,
    license     text  NOT NULL DEFAULT 'unknown',
    source_ref  text,

    CONSTRAINT media_site_url_uq UNIQUE (site_id, url)
);

COMMENT ON COLUMN media.license IS 'e.g. CC0, CC-BY-4.0, CC-BY-SA-4.0, unknown.';
COMMENT ON COLUMN media.source_ref IS 'Where the photo came from, e.g. OSM image tag, OpenAEDMap @photo_id, Ratuj z Sercem grafika/*.jpg.';
