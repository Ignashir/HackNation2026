"""
Export the unified AED database (solution/sql) as a CSV in the AED register standard (solution/standard/aed).

    uv run python -m aed_import.export_standard --out aed_standard.csv [--sources OpenAEDMap,OSM] [--licences ODbL,CC-BY]

One row per device, or one row per site when no device is known. `aed_id` is the device or site UUID from our
database, so it stays stable between exports. Only sites backed by a redistributable source are exported, and only
from the sources and licences asked for. Values are written as the standard expects (dates ISO, booleans tak/nie);
nothing is invented: unknown values stay empty.
"""

import argparse
import csv
import json
import logging
import os
import sys
from pathlib import Path

import psycopg

log = logging.getLogger("aed_import.export_standard")

SCHEMA = Path(__file__).resolve().parents[2] / "standard" / "aed" / "1.0" / "schema.json"

QUERY = """
WITH eligible AS (
    SELECT DISTINCT sr.site_id
    FROM source_record sr
    JOIN data_source ds ON ds.source_id = sr.source_id
    WHERE sr.site_id IS NOT NULL AND ds.redistributable
      AND (%(sources)s::text[] IS NULL OR ds.name = ANY (%(sources)s::text[]))
      AND (%(licences)s::text[] IS NULL OR ds.licence = ANY (%(licences)s::text[]))
)
SELECT coalesce(d.device_id, s.site_id)::text                    AS aed_id,
       round(ST_Y(s.location::geometry)::numeric, 7)::text         AS lat,
       round(ST_X(s.location::geometry)::numeric, 7)::text         AS lon,
       s.name                                                      AS name,
       concat_ws(', ', nullif(concat_ws(' ', a.street, a.house_number), ''),
                       nullif(concat_ws(' ', a.postcode, a.city), ''))  AS address,
       a.street, a.house_number, a.postcode, a.city,
       NULL::text                                                  AS teryt,
       s.placement_pl                                              AS placement,
       s.indoor, s.floor_level AS floor, s.access_type AS access,
       s.opening_hours_raw AS opening_hours, s.is_24_7, s.cabinet_locked, s.unlock_method,
       coalesce(mf.short_name, mf.name)                            AS manufacturer,
       m.name                                                      AS model,
       d.serial_number, NULL::text AS udi_di,
       d.status, d.paediatric_capable, d.pads_expiry, d.battery_expiry,
       s.last_verified_at                                          AS last_verified,
       op.name                                                     AS operator,
       NULL::text AS contact_phone,
       NULL::text AS notes,
       -- same device elsewhere: its OSM node, and the providers' own records linked to this site by our matching
       (SELECT string_agg(ref, ';' ORDER BY ref) FROM (
            SELECT 'osm:' || sr.external_id AS ref
            FROM source_record sr JOIN data_source ds ON ds.source_id = sr.source_id
            WHERE sr.site_id = s.site_id AND ds.name IN ('OSM', 'OpenAEDMap')
              AND sr.external_id ~ '^(node|way|relation)/[0-9]+$'
            UNION
            SELECT sr.external_id
            FROM source_record sr JOIN data_source ds ON ds.source_id = sr.source_id
            WHERE sr.site_id = s.site_id AND ds.name = 'DaneGovPl'
       ) refs)                                                     AS same_as
FROM aed_site s
JOIN eligible e ON e.site_id = s.site_id
LEFT JOIN address a        ON a.address_id = s.address_id
LEFT JOIN organization op  ON op.org_id = s.operator_org_id
LEFT JOIN aed_device d     ON d.site_id = s.site_id
LEFT JOIN device_model m   ON m.model_id = d.model_id
LEFT JOIN organization mf  ON mf.org_id = m.manufacturer_org_id
ORDER BY s.site_id, d.device_id
"""


def _value(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "tak" if value else "nie"
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return " ".join(str(value).split())  # one line per record: collapse line breaks and repeated spaces


def site_label(row: dict) -> str:
    """
    The standard requires a place name. OSM AED nodes are often unnamed, so fall back to the exact placement or the
    address; mark it as generic only when nothing else is known.
    """
    for candidate in (row.get("name"), row.get("placement"), row.get("address")):
        text = " ".join(str(candidate or "").split())
        if len(text) >= 2:
            return text[:200]
    return "AED (brak nazwy miejsca w źródle)"


def export(conn, out, *, sources=None, licences=None) -> int:
    fields = [f["name"] for f in json.loads(SCHEMA.read_text(encoding="utf-8"))["fields"]]
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    count = 0
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(QUERY, {"sources": sources, "licences": licences})
        for row in cur:
            row["name"] = site_label(row)
            writer.writerow({name: _value(row.get(name)) for name in fields})
            count += 1
    return count


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m aed_import.export_standard", description=__doc__.split("\n\n")[0])
    parser.add_argument("--dsn", default=os.environ.get("AED_DSN"))
    parser.add_argument("--out", required=True, help="output CSV path ('-' for stdout)")
    parser.add_argument("--sources", help="comma-separated data_source names (default: all redistributable)")
    parser.add_argument("--licences", help="comma-separated licences, e.g. CC-BY (default: any)")
    args = parser.parse_args(argv)
    if not args.dsn:
        parser.error("no database: pass --dsn or set AED_DSN")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    split = lambda v: [x.strip() for x in v.split(",") if x.strip()] if v else None  # noqa: E731
    with psycopg.connect(args.dsn) as conn:
        if args.out == "-":
            count = export(conn, sys.stdout, sources=split(args.sources), licences=split(args.licences))
        else:
            with open(args.out, "w", encoding="utf-8", newline="") as fh:
                count = export(conn, fh, sources=split(args.sources), licences=split(args.licences))
    log.info("exported %d AED rows to %s", count, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
