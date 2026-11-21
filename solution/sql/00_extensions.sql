-- =====================================================================
-- 00_extensions.sql
-- Unified AED database for Poland: extensions and shared helpers.
-- Target: PostgreSQL 15+ with PostGIS 3+.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;   -- geography / geometry types, GiST
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy name/address matching of source records

-- gen_random_uuid() is built into PostgreSQL 13+, no pgcrypto needed.

-- Keeps updated_at current on every UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
