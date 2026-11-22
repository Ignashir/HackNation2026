-- =====================================================================
-- 08_seed_data_source.sql
-- The six ingestible sources from the source report (section 2).
-- =====================================================================

INSERT INTO data_source (name, access_method, licence, base_url, redistributable) VALUES
    ('OSM',          'api',    'ODbL',        'https://overpass-api.de/api/interpreter',                    true),
    ('OpenAEDMap',   'api',    'ODbL',        'https://openaedmap.org/api/v1/countries/PL.geojson',         true),
    ('RatujZSercem', 'scrape', 'none',        'DBProxy.aspx?method=GetPoints',                              false),
    ('WarsawAPI',    'api',    'CC-BY',       'https://api.um.warszawa.pl/ (dataset 7bc32ffc-c2ac-4d32-83c9-b6f7a0b38de8)', true),
    ('Krakow',       'scrape', 'public-info', 'https://krakow.pl/aed---impuls-zycia/3992,artykul,mapa-aed.html', true),
    ('TED',          'api',    'CC-BY',       'https://api.ted.europa.eu/v3/notices/search',                true),
    -- AED registers published by providers on dane.gov.pl: used to link our sites to the providers' records
    -- (same_as in our export); never republished by us, the providers publish them themselves.
    ('DaneGovPl',    'api',    'CC-BY',       'https://api.dane.gov.pl/1.4',                                false)
ON CONFLICT (name) DO NOTHING;
