-- =====================================================================
-- init.sql: builds the whole unified AED schema in one transaction.
--   psql -v ON_ERROR_STOP=1 -d aed -f solution/sql/init.sql
-- Requires PostgreSQL 15+ (UNIQUE NULLS NOT DISTINCT) and PostGIS 3+.
-- =====================================================================

\set ON_ERROR_STOP on

BEGIN;
\ir 00_extensions.sql
\ir 01_admin_unit_address.sql
\ir 02_organization_model_procurement.sql
\ir 03_aed_site.sql
\ir 04_aed_device.sql
\ir 05_data_source_provenance.sql
\ir 06_coverage_request.sql
\ir 07_functions_views.sql
\ir 08_seed_data_source.sql
\ir 09_change_history.sql
COMMIT;
