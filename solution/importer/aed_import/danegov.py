"""
AED registers published by providers on dane.gov.pl, imported for matching only.

The providers publish these registers themselves (and the portal puts them in the national AED list), so our registry
never republishes them: the data source is not redistributable. We use them to link our sites to the providers'
records, so our export can state `same_as` = "<provider REGON>:<provider aed_id>" and the national list merges the
records by its published rules instead of listing the same AED twice.

Column mapping follows the AED standard (solution/standard/aed): exact names, header synonyms, coordinate ranges,
one GeoJSON-like point column. A mis-quoted CSV (each row quoted as one field) is unwrapped and swapped lat/lon are
put right, since this copy only serves matching.
"""

import csv
import io
import json
import logging
import re
import unicodedata
from datetime import timedelta
from pathlib import Path

from .http import Politeness, PoliteClient
from .records import Pull, SiteFields, SourceRecord

log = logging.getLogger(__name__)

API = "https://api.dane.gov.pl/1.4"
SCHEMA = Path(__file__).resolve().parents[2] / "standard" / "aed" / "1.0" / "schema.json"
QUERIES = ("defibrylator", "defibrylatory", "AED")
TITLE = re.compile(r"defibryl|\bAED\b", re.I)
LAT, LON = (49.0, 54.9), (14.1, 24.2)
_POLISH = str.maketrans("łŁ", "lL")


def normalize_header(value) -> str:
    value = unicodedata.normalize("NFKD", str(value).translate(_POLISH))
    value = "".join(ch for ch in value if not unicodedata.combining(ch)).lower()
    return re.sub(r"[\s_\-./]+", " ", value).strip()


def _float(value):
    try:
        return float(str(value).replace(",", ".").strip())
    except (TypeError, ValueError):
        return None


def _in(value, bounds):
    return value is not None and bounds[0] <= value <= bounds[1]


def parse_point(value):
    """(lat, lon) from GeoJSON {"coordinates":[lon,lat]}, {"lat":..,"long":..} or "lat, lon" text."""
    if not value:
        return None
    text = str(value).strip()
    if text.startswith(("{", "[")):
        try:
            obj = json.loads(text)
        except ValueError:
            return None
        if isinstance(obj, dict) and "coordinates" in obj:
            obj = obj["coordinates"]
        if isinstance(obj, dict):
            lat, lon = _float(obj.get("lat") or obj.get("latitude")), _float(obj.get("lon") or obj.get("long") or obj.get("lng"))
            return (lat, lon) if lat is not None and lon is not None else None
        if isinstance(obj, list) and len(obj) >= 2:
            return _float(obj[1]), _float(obj[0])
        return None
    parts = re.split(r"[,; ]+", text.strip("() "))
    if len(parts) == 2:
        a, b = _float(parts[0]), _float(parts[1])
        if a is not None and b is not None:
            return (b, a) if _in(a, LON) and _in(b, LAT) else (a, b)
    return None


def read_table(content: bytes):
    """Rows of a provider CSV as (headers, rows); unwraps files where each whole row was quoted as one field."""
    text = content.decode("utf-8-sig", errors="replace")
    header_line = text.split("\n", 1)[0]
    delimiter = max(",;\t|", key=header_line.count)  # the header has no free text, unlike some values
    rows = [r for r in csv.reader(io.StringIO(text), delimiter=delimiter) if any(c.strip() for c in r)]
    if rows and len(rows[0]) == 1 and any(sep in rows[0][0] for sep in ",;"):
        inner = "\n".join(r[0] for r in rows)
        rows = [r for r in csv.reader(io.StringIO(inner)) if any(c.strip() for c in r)]
    if not rows:
        return [], []
    return [h.strip() for h in rows[0]], rows[1:]


def map_columns(headers, rows, fields):
    """{standard field: column index} by exact name, then synonyms (most varied column wins), plus a point column."""
    norm = [normalize_header(h) for h in headers]
    mapping, used = {}, set()

    def varied(i):
        return len({r[i] for r in rows[:200] if i < len(r) and r[i].strip()})

    for field in fields:
        for i, h in enumerate(norm):
            if i not in used and h == normalize_header(field["name"]):
                mapping[field["name"]] = i
                used.add(i)
                break
    for field in fields:
        if field["name"] in mapping:
            continue
        synonyms = {normalize_header(s) for s in field.get("x-aed", {}).get("synonyms", [])}
        candidates = [i for i, h in enumerate(norm) if i not in used and h in synonyms]
        if candidates:
            best = max(candidates, key=lambda i: (varied(i), -i))
            mapping[field["name"]] = best
            used.add(best)
    if "lat" not in mapping or "lon" not in mapping:
        for i in range(len(headers)):
            if i in used:
                continue
            points = [parse_point(r[i]) for r in rows[:50] if i < len(r) and r[i].strip()]
            inside = [p for p in points if p and _in(p[0], LAT) and _in(p[1], LON)]
            if points and len(inside) / len(points) > 0.9:
                mapping["_point"] = i
                break
    return mapping


def coordinates(row, mapping):
    if "_point" in mapping:
        point = parse_point(row[mapping["_point"]]) if mapping["_point"] < len(row) else None
        lat, lon = point if point else (None, None)
    else:
        lat = _float(row[mapping["lat"]]) if mapping.get("lat", 99) < len(row) else None
        lon = _float(row[mapping["lon"]]) if mapping.get("lon", 99) < len(row) else None
    if _in(lon, LAT) and _in(lat, LON):  # swapped by the provider
        lat, lon = lon, lat
    return (lat, lon) if _in(lat, LAT) and _in(lon, LON) else (None, None)


class DaneGovPlSource:
    """AED registers published by providers on dane.gov.pl (matching only; the providers publish them themselves)."""

    name = "DaneGovPl"
    politeness = Politeness(min_interval_s=1, timeout_s=120)
    min_refresh = timedelta(hours=12)
    creates_sites = False
    geocode_method = "manual"

    def __init__(self, dataset_ids=None):
        self.dataset_ids = dataset_ids

    def fetch(self, http: PoliteClient) -> Pull:
        fields = json.loads(SCHEMA.read_text(encoding="utf-8"))["fields"]
        records = []
        for dataset_id in self.dataset_ids or self._discover(http):
            records.extend(self._dataset_records(http, dataset_id, fields))
        return Pull(records)

    def _discover(self, http):
        found = []
        for query in QUERIES:
            body = http.get(f"{API}/datasets", params={"q": query, "per_page": 100}).json()
            for item in body.get("data", []):
                title = re.sub(r"<[^>]+>", "", item["attributes"].get("title", ""))
                if TITLE.search(title) and item["id"] not in found:
                    found.append(item["id"])
        log.info("dane.gov.pl: AED datasets %s", found)
        return found

    def _dataset_records(self, http, dataset_id, fields):
        body = http.get(f"{API}/datasets/{dataset_id}", params={"include": "institution"}).json()
        institution = next((i for i in body.get("included", []) if i["type"] == "institution"), None)
        regon = ((institution or {}).get("attributes") or {}).get("regon") or ""
        provider = ((institution or {}).get("attributes") or {}).get("title") or ""
        if not regon:
            log.warning("dane.gov.pl dataset %s: institution without REGON, skipped", dataset_id)
            return []
        resources = http.get(f"{API}/datasets/{dataset_id}/resources").json().get("data", [])
        csvs = [r for r in resources if (r["attributes"].get("format") or "").lower() == "csv"]
        if not csvs:
            log.info("dane.gov.pl dataset %s (%s): no CSV file, skipped", dataset_id, provider)
            return []
        resource = csvs[0]
        url = resource["attributes"].get("download_url") or resource["attributes"].get("link")
        headers, rows = read_table(http.get(url).content)
        mapping = map_columns(headers, rows, fields)
        records = []
        for n, row in enumerate(rows, 1):
            lat, lon = coordinates(row, mapping)
            if lat is None:
                continue
            aed_id = row[mapping["aed_id"]].strip() if mapping.get("aed_id", 99) < len(row) else str(n)
            name = row[mapping["name"]].strip() if mapping.get("name", 99) < len(row) else None
            records.append(
                SourceRecord(
                    external_id=f"{regon}:{aed_id or n}",
                    payload={"dataset_id": dataset_id, "resource_id": resource["id"], "provider": provider,
                             "regon": regon, "aed_id": aed_id or str(n), "row": dict(zip(headers, row))},
                    site=SiteFields(lon=lon, lat=lat, name=name or None),
                )
            )
        log.info("dane.gov.pl dataset %s (%s, REGON %s): %d records", dataset_id, provider, regon, len(records))
        return records
