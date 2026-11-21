-- =====================================================================
-- 06_coverage_request.sql
-- COVERAGE_REQUEST: "an AED is needed here" (gap analysis).
-- =====================================================================

CREATE TABLE coverage_request (
    request_id     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    teryt_code     varchar(10)  REFERENCES admin_unit (teryt_code)
                                ON UPDATE CASCADE ON DELETE SET NULL,
    location       geography(Point, 4326),
    requested_via  text         CHECK (requested_via IN ('Ratownik', 'InPost vote', 'manual')),
    votes          integer      NOT NULL DEFAULT 1 CHECK (votes >= 0),
    requested_at   timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT coverage_request_where CHECK (teryt_code IS NOT NULL OR location IS NOT NULL)
);

CREATE INDEX coverage_request_teryt_idx    ON coverage_request (teryt_code);
CREATE INDEX coverage_request_location_gix ON coverage_request USING gist (location);
