-- =====================================================================
-- 08_seed_data_source.sql
-- The six ingestible sources from the source report (section 2).
-- =====================================================================

INSERT INTO data_source (name, access_method, licence, base_url, redistributable) VALUES
    ('OSM',          'api',    'ODbL',        'https://overpass-api.de/api/interpreter',                    true),
    ('OpenAEDMap',   'api',    'ODbL',        'https://openaedmap.org/api/v1/countries/PL.geojson',         true),
    ('RatujZSercem', 'scrape', 'none',        'DBProxy.aspx?method=GetPoints',                              false),
    ('WarsawAPI',    'api',    'CC-BY',       'https://api.um.warszawa.pl/ (dataset 7bc32ffc-c2ac-4d32-83c9-b6f7a0b38de8)', true),
    ('Krakow',       'scrape', 'public-info', 'Kraków "Impuls Życia" list',                                 true),
    ('TED',          'api',    'CC-BY',       'https://api.ted.europa.eu/v3/notices/search',                true)
ON CONFLICT (name) DO NOTHING;
