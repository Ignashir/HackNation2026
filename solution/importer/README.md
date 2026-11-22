# aed_import

Pulls AED records from a data source and maps them into the unified AED database (`solution/sql`).

## Setup

Needs Python 3.12+, [uv](https://docs.astral.sh/uv/), and a database built with `solution/sql/init.sql`.

```sh
cd solution/importer
uv sync
export AED_DSN=postgresql://user:pass@localhost:5432/aed
export AED_IMPORT_CONTACT="you@example.org"   # optional, added to the User-Agent
```

## Local database (Docker)

```sh
cd solution
docker compose up -d --wait   # PostGIS on 127.0.0.1:54329, schema created on first start
./pull_all.sh                 # OpenAEDMap, WarsawAPI, then Krakow; extra args (e.g. --force) go to each import
```

Data lives in the `aed-data` volume and survives restarts. `docker compose down -v` deletes it.
Connect with `postgresql://aed:aed@127.0.0.1:54329/aed`.

## Run an import

```sh
uv run python -m aed_import OpenAEDMap   # or: OSM (Overpass), WarsawAPI, Krakow
uv run python -m aed_import OSM --force  # ignore the source's minimum refresh interval
```

`WarsawAPI` reads `WARSAW_API_KEY` from the environment or from a `.env` file (searched upwards from the working directory). The key must come from https://dane.um.warszawa.pl/pl/key-api. Keys from the older api.um.warszawa.pl portal are rejected with HTTP 403. The data is CC-BY: credit "Stołeczne Centrum Bezpieczeństwa / m.st. Warszawa" when republishing.

Exit codes: `0` success, `1` partial or failed, `2` refused (too soon, or another import of the same source is running).

From Python:

```python
import psycopg
from aed_import import OpenAEDMapSource, SourceImporter

with psycopg.connect(dsn, autocommit=True) as conn:
    summary = SourceImporter(conn, OpenAEDMapSource()).run()
    print(summary.status, summary.outcomes, summary.gone)
```

## What a run does

1. Takes a per-source lock and refuses to run if the last successful pull is newer than the source's `min_refresh`.
2. Creates an `import_run` row, then fetches. Requests are spaced by `min_interval_s`, and the importer retries on 429 and 5xx with backoff, honouring `Retry-After`.
3. Upserts every record into `source_record` (each new payload version goes to `source_record_version`).
4. Matches each record to an `aed_site`: first by linked ID (e.g. the same OSM node in another source), then by the nearest site within 30 m, else creates a site (for sources with `creates_sites`).
5. Writes curated fields only if the source is `redistributable`. Conflicts follow `SOURCE_PRIORITY` (higher wins, equal = newest), recorded in `field_provenance`. Opening hours are parsed into `availability_rule`.
6. Commits in batches of 500; a failing record is skipped and logged (run becomes `partial`). Every change is attributed to the run in `change_log`.
7. Finishes the `import_run` and logs a summary: `created`, `matched`, `known`, `unmatched`, `failed`, and `gone` (records not seen this run).

## Adding a source

Register it in `data_source`, then write a class with the `Source` attributes and a `fetch()` that returns a `Pull` of `SourceRecord`s:

```python
class WarsawSource:
    name = "WarsawAPI"                      # must match data_source.name
    politeness = Politeness(min_interval_s=1)
    min_refresh = timedelta(days=1)         # dataset is updated daily
    creates_sites = True
    geocode_method = "survey"

    def fetch(self, http: PoliteClient) -> Pull:
        ...
```

Add it to `SOURCES` in `aed_import/__init__.py` to expose it on the command line.

## Kraków city list (geocoded)

`uv run python -m aed_import Krakow` reads the city's "Krakowski IMPULS ŻYCIA AED" list on
[krakow.pl](https://krakow.pl/aed---impuls-zycia/3992,artykul,mapa-aed.html): 4 list pages and one detail page per
location (name, address, "Liczba AED", placement), about 160 requests at one per second. Run it after `OpenAEDMap`.

- **Positions are geocoded.** The list has no coordinates (its map is a Google embed, which may not be extracted), so
  each address is looked up in the national address register (PRG) with the
  [GUGiK geocoder](https://services.gugik.gov.pl/uug/). Only the exact house number on the same street is accepted
  (PRG uses full names: "Piłsudskiego" is "Marszałka Józefa Piłsudskiego"); without a number, the street's centre.
  A number PRG doesn't have is not replaced by the street's centre, which can be far off: the record is kept without
  a site and logged.
- **A surveyed position always wins.** Sites placed this way get `geocode_method = 'address'` and
  `position_accuracy_m` (50 for an address point, 250 for a street). A geocoded position never moves a site that
  another source placed, and a surveyed one (OSM) replaces a geocoded one, whatever `SOURCE_PRIORITY` says.
- **Matching** uses a 60 m radius (`match_radius_m` on the source) because an address point can be a building's width
  away from the AED, and the closest pairs match first.
- AEDs carried in vehicles (Straż Miejska and MPK patrol cars) are kept as records without a site: the address given
  is the depot. The 15 tram AEDs are mentioned only in the page's text.
- The list is refreshed a few times a year; one pull per 7 days is allowed.

## Providers' registers on dane.gov.pl (matching only)

`uv run python -m aed_import DaneGovPl` finds the AED datasets on dane.gov.pl, reads each provider's CSV (columns
mapped by the AED standard; mis-quoted rows unwrapped, swapped coordinates put right) and **links** the records to our
sites (nearest within 30 m, name similarity). The source is not redistributable: we never republish those records,
because the providers publish them themselves. The links become `same_as` in our export.

## Export in the AED standard

Writes the database as a CSV in the [AED register standard](../standard/aed/) (one row per device, or per site when
no device is known; `aed_id` is the stable UUID from our database; `same_as` lists the site's OSM node and the
providers' records linked to it, so the national list merges them instead of listing an AED twice):

```sh
uv run python -m aed_import.export_standard --out aed_standard.csv
uv run python -m aed_import.export_standard --out aed_cc_by.csv --licences CC-BY   # only CC BY sources
```

Only redistributable sources are exported. OSM and OpenAEDMap data is ODbL, which dane.gov.pl does not offer as a
licence. A file exported from them is fine for a local demo, but not for publication on the production portal.

## Tests

```sh
uv run pytest
```
