-- =====================================================================
-- 09_change_history.sql
-- Tracing updates to AEDs.
--   * change_log            - append-only audit of every curated change
--                             (sites, devices, hours, photos, provenance,
--                             source matching, issue status), filled by
--                             triggers, with a per-field old/new diff.
--   * source_record_version - every distinct payload a source delivered,
--                             so "what did OSM say last month" survives
--                             the daily overwrite of source_record.
--   * v_aed_timeline        - one chronological feed per site/device:
--                             curated changes + source versions +
--                             inspections + issue reports.
--
-- Attributing a change: the writer sets transaction-local settings,
--   BEGIN;
--   SET LOCAL app.actor           = 'ingest:openaedmap';   -- or a person
--   SET LOCAL app.import_run_id   = '<import_run.run_id>';
--   SET LOCAL app.change_reason   = 'daily import';
--   ... INSERT / UPDATE / DELETE ...
--   COMMIT;
-- Unset values fall back to session_user / NULL.
-- =====================================================================

-- ---------------------------------------------------------------------
-- jsonb_diff: {key: {"old": .., "new": ..}} for top-level keys whose
-- values differ. NULL old/new means "row did not exist" (insert/delete).
-- A missing key and a JSON null count as equal, so inserts/deletes list
-- only the columns that actually hold a value.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION jsonb_diff(
    p_old     jsonb,
    p_new     jsonb,
    p_ignore  text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(
               jsonb_object_agg(k, jsonb_build_object('old', p_old -> k, 'new', p_new -> k)),
               '{}'::jsonb)
    FROM (
        SELECT jsonb_object_keys(COALESCE(p_old, '{}'::jsonb))
        UNION
        SELECT jsonb_object_keys(COALESCE(p_new, '{}'::jsonb))
    ) AS keys (k)
    WHERE NOT (k = ANY (p_ignore))
      AND COALESCE(p_old -> k, 'null'::jsonb) IS DISTINCT FROM COALESCE(p_new -> k, 'null'::jsonb);
$$;


-- ---------------------------------------------------------------------
-- CHANGE_LOG, LIST-partitioned by voivodeship (TERC code).
-- No foreign keys on purpose: history must outlive deleted rows.
-- Rows whose voivodeship is unknown (unmatched source records, mobile
-- AEDs without a site, sites outside loaded boundaries) carry '00' and
-- land in the default partition. Rows are never moved afterwards, so
-- load admin_unit boundaries before the first import.
-- ---------------------------------------------------------------------
CREATE TABLE change_log (
    change_id          bigint       GENERATED ALWAYS AS IDENTITY,
    voivodeship_teryt  varchar(2)   NOT NULL DEFAULT '00'
                                    CHECK (voivodeship_teryt ~ '^[0-9]{2}$'),
    table_name   text         NOT NULL,
    row_key      text         NOT NULL,
    operation    text         NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    site_id      uuid,
    device_id    uuid,
    changes      jsonb        NOT NULL,
    changed_at   timestamptz  NOT NULL DEFAULT clock_timestamp(),
    xact_id      xid8         NOT NULL DEFAULT pg_current_xact_id(),
    changed_by   text         NOT NULL,
    run_id       uuid,
    reason       text,

    PRIMARY KEY (change_id, voivodeship_teryt)
) PARTITION BY LIST (voivodeship_teryt);

CREATE TABLE change_log_02 PARTITION OF change_log FOR VALUES IN ('02');  -- dolnośląskie
CREATE TABLE change_log_04 PARTITION OF change_log FOR VALUES IN ('04');  -- kujawsko-pomorskie
CREATE TABLE change_log_06 PARTITION OF change_log FOR VALUES IN ('06');  -- lubelskie
CREATE TABLE change_log_08 PARTITION OF change_log FOR VALUES IN ('08');  -- lubuskie
CREATE TABLE change_log_10 PARTITION OF change_log FOR VALUES IN ('10');  -- łódzkie
CREATE TABLE change_log_12 PARTITION OF change_log FOR VALUES IN ('12');  -- małopolskie
CREATE TABLE change_log_14 PARTITION OF change_log FOR VALUES IN ('14');  -- mazowieckie
CREATE TABLE change_log_16 PARTITION OF change_log FOR VALUES IN ('16');  -- opolskie
CREATE TABLE change_log_18 PARTITION OF change_log FOR VALUES IN ('18');  -- podkarpackie
CREATE TABLE change_log_20 PARTITION OF change_log FOR VALUES IN ('20');  -- podlaskie
CREATE TABLE change_log_22 PARTITION OF change_log FOR VALUES IN ('22');  -- pomorskie
CREATE TABLE change_log_24 PARTITION OF change_log FOR VALUES IN ('24');  -- śląskie
CREATE TABLE change_log_26 PARTITION OF change_log FOR VALUES IN ('26');  -- świętokrzyskie
CREATE TABLE change_log_28 PARTITION OF change_log FOR VALUES IN ('28');  -- warmińsko-mazurskie
CREATE TABLE change_log_30 PARTITION OF change_log FOR VALUES IN ('30');  -- wielkopolskie
CREATE TABLE change_log_32 PARTITION OF change_log FOR VALUES IN ('32');  -- zachodniopomorskie
-- '00' (unassigned) and any unexpected code: never block the data change being logged.
CREATE TABLE change_log_unassigned PARTITION OF change_log DEFAULT;

COMMENT ON TABLE  change_log IS 'Append-only audit trail of curated AED data, written by log_change() triggers. Partitioned by voivodeship.';
COMMENT ON COLUMN change_log.voivodeship_teryt IS 'Voivodeship TERC code of the site at the time of the change; ''00'' = unassigned.';
COMMENT ON COLUMN change_log.row_key IS 'Primary key of the changed row; composite keys joined with "/".';
COMMENT ON COLUMN change_log.site_id IS 'Site the row belongs to after the change (before it, for DELETE). A device move keeps the old site in changes->site_id->old.';
COMMENT ON COLUMN change_log.changes IS '{field: {old, new}} for changed fields only. INSERT has old=null, DELETE has new=null.';
COMMENT ON COLUMN change_log.xact_id IS 'Groups all changes made by one transaction (e.g. one import or one manual edit).';
COMMENT ON COLUMN change_log.run_id IS 'import_run that made the change, from app.import_run_id; NULL for manual edits.';

CREATE INDEX change_log_site_idx   ON change_log (site_id, changed_at DESC);
CREATE INDEX change_log_device_idx ON change_log (device_id, changed_at DESC) WHERE device_id IS NOT NULL;
CREATE INDEX change_log_row_idx    ON change_log (table_name, row_key, changed_at DESC);
CREATE INDEX change_log_run_idx    ON change_log (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX change_log_xact_idx   ON change_log (xact_id);

-- Append-only: no edits or deletes of history rows.
CREATE OR REPLACE FUNCTION change_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'change_log is append-only (% not allowed)', TG_OP;
END;
$$;

CREATE TRIGGER change_log_no_update_delete
    BEFORE UPDATE OR DELETE ON change_log
    FOR EACH ROW EXECUTE FUNCTION change_log_append_only();


-- ---------------------------------------------------------------------
-- log_change(): generic AFTER trigger.
--   TG_ARGV[0]  = primary-key column(s), comma-separated
--   TG_ARGV[1:] = extra columns to ignore (updated_at is always ignored)
-- Updates that change nothing (other than ignored columns) are not logged.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_old     jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
    v_new     jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
    v_row     jsonb := COALESCE(CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END, to_jsonb(OLD));
    v_ignore  text[] := ARRAY['updated_at'] || COALESCE(TG_ARGV[1:TG_NARGS - 1], '{}');
    v_changes jsonb;
    v_key     text;
    v_site    uuid := (v_row ->> 'site_id')::uuid;
    v_voiv    varchar(2);
BEGIN
    v_changes := jsonb_diff(v_old, v_new, v_ignore);
    IF v_changes = '{}'::jsonb THEN
        RETURN NULL;
    END IF;

    SELECT string_agg(v_row ->> c.col, '/' ORDER BY c.ord)
      INTO v_key
      FROM unnest(string_to_array(TG_ARGV[0], ',')) WITH ORDINALITY AS c (col, ord);

    -- Partition key: the site's voivodeship.
    IF TG_TABLE_NAME = 'aed_site' THEN
        v_voiv := v_row ->> 'voivodeship_teryt';
    ELSIF v_site IS NOT NULL THEN
        SELECT s.voivodeship_teryt INTO v_voiv FROM aed_site s WHERE s.site_id = v_site;
        IF NOT FOUND THEN
            -- Site already deleted (cascaded child rows): reuse its last known region.
            SELECT cl.voivodeship_teryt INTO v_voiv
              FROM change_log cl
             WHERE cl.site_id = v_site
             ORDER BY cl.change_id DESC
             LIMIT 1;
        END IF;
    END IF;

    INSERT INTO change_log (voivodeship_teryt, table_name, row_key, operation, site_id, device_id,
                            changes, changed_by, run_id, reason)
    VALUES (COALESCE(v_voiv, '00'),
            TG_TABLE_NAME,
            v_key,
            TG_OP,
            v_site,
            (v_row ->> 'device_id')::uuid,
            v_changes,
            COALESCE(NULLIF(current_setting('app.actor', true), ''), session_user),
            NULLIF(current_setting('app.import_run_id', true), '')::uuid,
            NULLIF(current_setting('app.change_reason', true), ''));
    RETURN NULL;
END;
$$;

CREATE TRIGGER aed_site_log_change
    AFTER INSERT OR UPDATE OR DELETE ON aed_site
    FOR EACH ROW EXECUTE FUNCTION log_change('site_id');

CREATE TRIGGER aed_device_log_change
    AFTER INSERT OR UPDATE OR DELETE ON aed_device
    FOR EACH ROW EXECUTE FUNCTION log_change('device_id');

CREATE TRIGGER availability_rule_log_change
    AFTER INSERT OR UPDATE OR DELETE ON availability_rule
    FOR EACH ROW EXECUTE FUNCTION log_change('rule_id');

CREATE TRIGGER media_log_change
    AFTER INSERT OR UPDATE OR DELETE ON media
    FOR EACH ROW EXECUTE FUNCTION log_change('media_id');

CREATE TRIGGER field_provenance_log_change
    AFTER INSERT OR UPDATE OR DELETE ON field_provenance
    FOR EACH ROW EXECUTE FUNCTION log_change('site_id,field_name', 'chosen_at');

CREATE TRIGGER issue_report_log_change
    AFTER INSERT OR UPDATE OR DELETE ON issue_report
    FOR EACH ROW EXECUTE FUNCTION log_change('issue_id');

-- source_record: log matching decisions (site_id, match_method, ...).
-- Payload changes go to source_record_version instead; per-run
-- bookkeeping (run_id, last_seen_at) is not a change.
CREATE TRIGGER source_record_log_change
    AFTER INSERT OR UPDATE OR DELETE ON source_record
    FOR EACH ROW EXECUTE FUNCTION log_change(
        'source_record_id',
        'raw_payload', 'run_id', 'last_seen_at', 'external_version', 'source_modified_at');


-- ---------------------------------------------------------------------
-- SOURCE_RECORD_VERSION: one row per distinct payload/version received.
-- An entity that vanishes upstream is detected by source_record.last_seen_at
-- falling behind the latest successful import_run, not by deleting it,
-- so versions are protected with ON DELETE RESTRICT.
-- ---------------------------------------------------------------------
CREATE TABLE source_record_version (
    version_id          bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_record_id    uuid         NOT NULL REFERENCES source_record (source_record_id) ON DELETE RESTRICT,
    external_version    integer,
    raw_payload         jsonb        NOT NULL,
    source_modified_at  timestamptz,
    run_id              uuid         REFERENCES import_run (run_id) ON DELETE SET NULL,
    captured_at         timestamptz  NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE source_record_version IS 'Every distinct payload a source delivered for a record (e.g. each OSM node version).';

CREATE INDEX source_record_version_record_idx
    ON source_record_version (source_record_id, captured_at DESC);
CREATE INDEX source_record_version_run_idx
    ON source_record_version (run_id);

CREATE OR REPLACE FUNCTION capture_source_record_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO source_record_version (source_record_id, external_version, raw_payload,
                                       source_modified_at, run_id)
    VALUES (NEW.source_record_id, NEW.external_version, NEW.raw_payload,
            NEW.source_modified_at, NEW.run_id);
    RETURN NULL;
END;
$$;

CREATE TRIGGER source_record_version_on_insert
    AFTER INSERT ON source_record
    FOR EACH ROW EXECUTE FUNCTION capture_source_record_version();

CREATE TRIGGER source_record_version_on_update
    AFTER UPDATE OF raw_payload, external_version ON source_record
    FOR EACH ROW
    WHEN (OLD.raw_payload      IS DISTINCT FROM NEW.raw_payload
       OR OLD.external_version IS DISTINCT FROM NEW.external_version)
    EXECUTE FUNCTION capture_source_record_version();


-- ---------------------------------------------------------------------
-- device_site_at: where a device was at a given moment, replayed from
-- change_log (site_id there is the site after each change). NULL when
-- the device has no logged change before p_at (e.g. pre-history data).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION device_site_at(p_device_id uuid, p_at timestamptz)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT cl.site_id
    FROM change_log cl
    WHERE cl.table_name = 'aed_device'
      AND cl.device_id  = p_device_id
      AND cl.changed_at <= p_at
    ORDER BY cl.changed_at DESC, cl.change_id DESC
    LIMIT 1;
$$;


-- ---------------------------------------------------------------------
-- v_aed_timeline: everything that happened to a site or its devices.
--   SELECT * FROM v_aed_timeline WHERE site_id = $1 ORDER BY event_at DESC;
-- A device moved between sites appears in both sites' timelines.
-- Source versions appear under the site the record is matched to now.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_aed_timeline AS
-- curated changes
SELECT s.site_id,
       cl.device_id,
       cl.changed_at                                    AS event_at,
       cl.table_name || '.' || lower(cl.operation)      AS event_type,
       cl.changed_by                                    AS actor,
       cl.run_id,
       cl.reason                                        AS note,
       cl.changes                                       AS details
FROM change_log cl
CROSS JOIN LATERAL (
    SELECT DISTINCT x
    FROM unnest(ARRAY[cl.site_id, (cl.changes -> 'site_id' ->> 'old')::uuid]) AS x
    WHERE x IS NOT NULL
) AS s (site_id)
-- the report itself comes from the issue branch below (it also covers
-- device-only reports); keep its later status changes from change_log
WHERE NOT (cl.table_name = 'issue_report' AND cl.operation = 'INSERT')

UNION ALL
-- what each source said, as a diff against its previous version
SELECT sr.site_id,
       NULL,
       v.captured_at,
       CASE WHEN v.prev_payload IS NULL THEN 'source.new' ELSE 'source.changed' END,
       ds.name,
       v.run_id,
       sr.external_id || COALESCE(' v' || v.external_version, ''),
       jsonb_diff(v.prev_payload, v.raw_payload)
FROM (
    SELECT srv.*,
           lag(srv.raw_payload) OVER (PARTITION BY srv.source_record_id
                                      ORDER BY srv.captured_at, srv.version_id) AS prev_payload
    FROM source_record_version srv
) AS v
JOIN source_record sr ON sr.source_record_id = v.source_record_id
JOIN data_source   ds ON ds.source_id        = sr.source_id
WHERE sr.site_id IS NOT NULL

UNION ALL
-- inspections, at the site the device was at when inspected
SELECT COALESCE(device_site_at(i.device_id, i.inspected_at), d.site_id),
       i.device_id,
       i.inspected_at,
       'inspection.' || i.result,
       i.inspected_by,
       NULL,
       i.note,
       NULL
FROM inspection i
JOIN aed_device d ON d.device_id = i.device_id

UNION ALL
-- issue reports (status changes are in change_log as issue_report.update)
SELECT COALESCE(r.site_id, device_site_at(r.device_id, r.reported_at), d.site_id),
       r.device_id,
       r.reported_at,
       'issue.' || r.issue_type,
       r.reported_via,
       NULL,
       r.status,
       NULL
FROM issue_report r
LEFT JOIN aed_device d ON d.device_id = r.device_id;
