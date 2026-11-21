-- =====================================================================
-- 04_aed_device.sql
-- AED_DEVICE (a physical unit), INSPECTION, ISSUE_REPORT.
-- =====================================================================

-- ---------------------------------------------------------------------
-- AED_DEVICE
-- ---------------------------------------------------------------------
CREATE TABLE aed_device (
    device_id           uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id             uuid     REFERENCES aed_site (site_id) ON DELETE RESTRICT,
    owner_org_id        uuid     REFERENCES organization (org_id) ON DELETE SET NULL,
    model_id            uuid     REFERENCES device_model (model_id) ON DELETE SET NULL,
    serial_number       text,
    status              text     NOT NULL DEFAULT 'unknown'
                        CHECK (status IN ('active', 'out_of_service', 'removed', 'unknown')),
    is_mobile           boolean  NOT NULL DEFAULT false,
    vehicle_ref         text,
    paediatric_capable  boolean,
    installed_at        date,
    battery_expiry      date,
    pads_expiry         date,
    procurement_id      uuid     REFERENCES procurement (procurement_id) ON DELETE SET NULL,
    funding_programme   text,

    -- Fixed AEDs must sit at a site; mobile AEDs (fire engines, trams,
    -- city-guard cars) may have a home site or none.
    CONSTRAINT aed_device_site_required CHECK (site_id IS NOT NULL OR is_mobile),
    CONSTRAINT aed_device_vehicle_only_mobile CHECK (vehicle_ref IS NULL OR is_mobile)
);

COMMENT ON TABLE  aed_device IS 'A physical AED unit. Created from device_count_reported or from owner-supplied serial numbers.';
COMMENT ON COLUMN aed_device.owner_org_id IS 'Organisation that bought/owns the unit (e.g. gmina under OLiOC).';
COMMENT ON COLUMN aed_device.status IS 'active|out_of_service|removed|unknown. Dispatch must skip non-active units.';
COMMENT ON COLUMN aed_device.vehicle_ref IS 'Vehicle identifier for mobile AEDs (e.g. tram number, OSP engine).';
COMMENT ON COLUMN aed_device.funding_programme IS 'e.g. OLiOC, budżet obywatelski, Fundacja LOTTO.';

-- Serial numbers are unique per model when known.
CREATE UNIQUE INDEX aed_device_serial_uq
    ON aed_device (model_id, serial_number) WHERE serial_number IS NOT NULL;

CREATE INDEX aed_device_site_idx        ON aed_device (site_id);
CREATE INDEX aed_device_owner_idx       ON aed_device (owner_org_id);
CREATE INDEX aed_device_model_idx       ON aed_device (model_id);
CREATE INDEX aed_device_procurement_idx ON aed_device (procurement_id);
CREATE INDEX aed_device_battery_idx     ON aed_device (battery_expiry) WHERE status = 'active';
CREATE INDEX aed_device_pads_idx        ON aed_device (pads_expiry)    WHERE status = 'active';


-- ---------------------------------------------------------------------
-- INSPECTION: a real maintenance check of a device.
-- ---------------------------------------------------------------------
CREATE TABLE inspection (
    inspection_id  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id      uuid         NOT NULL REFERENCES aed_device (device_id) ON DELETE CASCADE,
    inspected_at   timestamptz  NOT NULL,
    inspected_by   text,
    result         text         NOT NULL
                   CHECK (result IN ('ok', 'battery_low', 'pads_expired', 'missing', 'damaged')),
    note           text
);

CREATE INDEX inspection_device_idx ON inspection (device_id, inspected_at DESC);


-- ---------------------------------------------------------------------
-- ISSUE_REPORT: user / dispatcher reports (missing, broken, moved ...).
-- A report targets a device when known, otherwise the site.
-- ---------------------------------------------------------------------
CREATE TABLE issue_report (
    issue_id      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id     uuid         REFERENCES aed_device (device_id) ON DELETE CASCADE,
    site_id       uuid         REFERENCES aed_site (site_id) ON DELETE CASCADE,
    issue_type    text         NOT NULL
                  CHECK (issue_type IN ('missing', 'broken', 'moved', 'wrong_hours')),
    reported_via  text         CHECK (reported_via IN ('19115', 'app', 'osm_note')),
    reported_at   timestamptz  NOT NULL DEFAULT now(),
    status        text         NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'confirmed', 'resolved', 'rejected')),

    CONSTRAINT issue_report_target CHECK (device_id IS NOT NULL OR site_id IS NOT NULL)
);

CREATE INDEX issue_report_device_idx ON issue_report (device_id);
CREATE INDEX issue_report_site_idx   ON issue_report (site_id);
CREATE INDEX issue_report_open_idx   ON issue_report (reported_at) WHERE status = 'open';
