-- =====================================================================
-- 10_citizen_report.sql
-- CITIZEN_REPORT: a report sent from the citizen app ("Skaner AED"):
--   new      - "there is an AED here that is not on the map"
--   confirm  - "this AED is here and looks usable" (verification)
--   issue    - "this AED is missing / broken / locked / moved"
-- Reports never change aed_site directly: they wait for review by the
-- data provider (gmina / operator), who accepts, rejects or merges them.
-- =====================================================================

CREATE TABLE citizen_report (
    report_id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                 text         NOT NULL CHECK (kind IN ('new', 'confirm', 'issue')),
    site_id              uuid         REFERENCES aed_site (site_id) ON DELETE SET NULL,
    issue_type           text         CHECK (issue_type IN ('missing', 'broken', 'moved', 'wrong_hours', 'locked')),
    location             geography(Point, 4326) NOT NULL,
    position_accuracy_m  integer      CHECK (position_accuracy_m IS NULL OR position_accuracy_m >= 0),
    placement_pl         text,
    floor_level          text,
    indoor               boolean,
    access_type          text         CHECK (access_type IN ('yes', 'customers', 'permit', 'private', 'no')),
    is_24_7              boolean,
    cabinet_locked       boolean,
    note                 text,
    photo_path           text,
    -- Pseudonymous per-install reference (anti-spam / dedup). In mObywatel
    -- the reporter is authenticated; the data provider never sees who it was.
    client_ref           text,
    reported_at          timestamptz  NOT NULL DEFAULT now(),
    status               text         NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'accepted', 'rejected', 'merged')),
    reviewed_at          timestamptz,

    CONSTRAINT citizen_report_issue_type CHECK ((kind = 'issue') = (issue_type IS NOT NULL)),
    CONSTRAINT citizen_report_site CHECK (kind = 'new' OR site_id IS NOT NULL OR note IS NOT NULL)
);

COMMENT ON TABLE citizen_report IS
    'Reports from the citizen app (photo + position): new AED, confirmation, or issue. Reviewed before use.';

CREATE INDEX citizen_report_location_gix ON citizen_report USING gist (location);
CREATE INDEX citizen_report_pending_idx  ON citizen_report (reported_at) WHERE status = 'pending';
CREATE INDEX citizen_report_site_idx     ON citizen_report (site_id);
