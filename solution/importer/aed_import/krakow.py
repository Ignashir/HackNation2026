"""
Kraków "Krakowski IMPULS ŻYCIA AED" list on krakow.pl (Urząd Miasta Krakowa).

The list has names and addresses but no coordinates (its map is a Google embed, which may not be extracted), so each
address is geocoded against the national address register (PRG) through the GUGiK geocoder. Sites placed this way
are `geocode_method = 'address'`: they match OSM AEDs within a wider radius, and their position never replaces a
surveyed one (see SourceImporter).

Pages: a list of about 20 rows per page (name, address) and one detail page per row ("Liczba AED", placement,
publication date). AEDs carried in vehicles (MPK patrol cars, trams) are kept as records without a site: the address
given is the depot, not where the AED is.
"""

import html
import logging
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone

from .http import Politeness, PoliteClient
from .records import Pull, SiteFields, SourceRecord

log = logging.getLogger(__name__)

BASE = "https://krakow.pl"
FIRST_PAGE = f"{BASE}/aed---impuls-zycia/3992,artykul,mapa-aed.html"
PAGE = BASE + "/instcbi/3992/2432/{}"          # page N + 1; no trailing slash (that one redirects)
GEOCODER = "https://services.gugik.gov.pl/uug/"

# Positions: an address point stands for a whole building, a street centroid for the whole street.
ADDRESS_POINT_ACCURACY_M = 50
STREET_ACCURACY_M = 250
MIN_GEOCODE_ACCURACY = 0.5

_ROW = re.compile(r'<h4[^>]*>\s*<a href="(?P<href>/instcbi/3992/inst/(?P<id>\d+)/[^"]+)">(?P<name>.*?)</a>\s*</h4>'
                  r'\s*(?:<p>(?P<address>.*?)</p>)?', re.S)
_PAGE_LINK = re.compile(r'href="/instcbi/3992/2432/(\d+)/?[#"]')
_AS_OF = re.compile(r"stan na dzień\s*(\d{1,2})\.(\d{1,2})\.(\d{4})", re.I)
_DETAIL_ADDRESS = re.compile(r"<td>\s*Adres:\s*</td>\s*<td>(.*?)</td>", re.S)
_DESCRIPTION = re.compile(r'<div class="object_desc">(.*?)</div>', re.S)
_COUNT = re.compile(r"Liczba AED:\s*(\d+)", re.I)
_PUBLISHED = re.compile(r'<time[^>]*datetime="(\d{4}-\d{2}-\d{2})"')
_MOBILE = re.compile(r"na wyposażeniu|radiowoz|tramwaj|pojazd|samochod", re.I)
_ADDRESS = re.compile(
    r"^(?P<street>.+?)"
    # "Lipowa 4 4": number repeated; "3-4": a range (not a postcode)
    r"(?:\s+(?!\d{2}-\d{3}\b)(?P<number>\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)(?:\s+(?P=number))?)?"
    r"\s*,?\s*(?:(?P<postcode>\d{2}-\d{3})\s+)?(?P<city>[^\d,]+?)\s*$")
_STREET_PREFIX = re.compile(r"^(?:ul\.|ulica)\s+", re.I)
_POLISH = str.maketrans("łŁ", "lL")


class KrakowSource:
    name = "Krakow"
    politeness = Politeness(min_interval_s=1.0)
    min_refresh = timedelta(days=7)      # the city updates the list a few times a year
    creates_sites = True
    geocode_method = "address"
    match_radius_m = 60.0                # an address point can be a building's width away from the AED

    def fetch(self, http: PoliteClient) -> Pull:
        first = http.get(FIRST_PAGE).text
        pages = [first] + [http.get(PAGE.format(n)).text for n in range(1, last_page_index(first) + 1)]
        rows = {row["id"]: row for page in pages for row in parse_list(page)}
        log.info("Krakow: %d rows on %d pages", len(rows), len(pages))
        records = [self._record(http, row) for row in rows.values()]
        return Pull(records, data_as_of=as_of(first))

    def _record(self, http: PoliteClient, row: dict) -> SourceRecord:
        detail = parse_detail(http.get(BASE + row["href"]).text)
        payload = {**row, **detail, "url": BASE + row["href"]}
        published = detail.get("published")
        modified_at = datetime.combine(date.fromisoformat(published), datetime.min.time(), timezone.utc) \
            if published else None
        if _MOBILE.search(row["name"]):
            log.info("Krakow: %s is carried in vehicles, kept without a site", row["id"])
            return SourceRecord(row["id"], payload | {"mobile": True}, modified_at=modified_at)

        address = parse_address(detail.get("address") or row.get("address") or "")
        point = geocode(http, address) if address else None
        payload |= {"address_parsed": address, "geocoded": point}
        if not point:
            log.warning("Krakow: %s %r could not be geocoded, kept without a site", row["id"], row.get("address"))
            return SourceRecord(row["id"], payload, modified_at=modified_at)
        placement = detail.get("placement")
        return SourceRecord(
            external_id=row["id"],
            payload=payload,
            modified_at=modified_at,
            site=SiteFields(
                lon=point["lon"], lat=point["lat"],
                name=site_name(row["name"], placement),
                placement_pl=placement,
                device_count_reported=detail.get("count"),
                position_accuracy_m=point["accuracy_m"],
            ),
        )


# --- pages ---------------------------------------------------------------


def _text(fragment: str | None) -> str | None:
    if fragment is None:
        return None
    text = html.unescape(re.sub(r"<[^>]+>", " ", fragment))
    return re.sub(r"\s+", " ", text).strip() or None


def parse_list(page: str) -> list[dict]:
    return [{"id": m["id"], "href": m["href"], "name": _text(m["name"]), "address": _text(m["address"])}
            for m in _ROW.finditer(page)]


def last_page_index(page: str) -> int:
    return max((int(n) for n in _PAGE_LINK.findall(page)), default=0)


def as_of(page: str) -> datetime | None:
    m = _AS_OF.search(page)
    return datetime(int(m[3]), int(m[2]), int(m[1]), tzinfo=timezone.utc) if m else None


def parse_detail(page: str) -> dict:
    detail: dict = {}
    if m := _DETAIL_ADDRESS.search(page):
        detail["address"] = _text(m[1])
    if m := _DESCRIPTION.search(page):
        first, *rest = re.split(r"<br\s*/?>", m[1], maxsplit=1, flags=re.I)
        if c := _COUNT.search(_text(first) or ""):
            detail["count"] = int(c[1])
            detail["placement"] = _text(rest[0]) if rest else None
        else:
            detail["placement"] = _text(m[1])
    if m := _PUBLISHED.search(page):
        detail["published"] = m[1]
    return {k: v for k, v in detail.items() if v is not None}


def site_name(name: str, placement: str | None) -> str:
    """The list appends the placement to the name ("Dom Jana Matejki – hol parter"); keep the place only."""
    if placement:
        tail = re.compile(r"\s*[-–—]\s*" + re.escape(placement) + r"\s*$", re.I)
        stripped = tail.sub("", name)
        if stripped and stripped != name:
            return stripped
    return name


# --- addresses -----------------------------------------------------------


def parse_address(text: str) -> dict | None:
    """'ul. Lipowa 4 4 30-702 Kraków' -> street, number, postcode, city. None when there is no street."""
    m = _ADDRESS.match(re.sub(r"\s+", " ", text).strip())
    if not m:
        return None
    street = _STREET_PREFIX.sub("", m["street"]).strip(" ,")
    return {"street": street, "number": m["number"], "postcode": m["postcode"], "city": m["city"].strip()} \
        if street else None


def geocode(http: PoliteClient, address: dict) -> dict | None:
    numbers = [address["number"]]
    if address["number"] and "-" in address["number"]:      # "3-4": PRG has the first number
        numbers.append(address["number"].split("-")[0])
    for number in numbers:
        wanted = {**address, "number": number}
        query = f'{address["city"]}, {address["street"]}' + (f" {number}" if number else "")
        body = http.get(GEOCODER, params={"request": "GetAddress", "address": query, "srid": "4326"}).json()
        if point := pick_geocode(body, wanted):
            return point
    return None


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.translate(_POLISH))
    return "".join(ch for ch in text if not unicodedata.combining(ch)).lower()


def same_street(ours: str, prg: str | None) -> bool:
    """PRG has full names ("Marszałka Józefa Piłsudskiego"): our street's last word must be one of PRG's words."""
    words = re.findall(r"\w+", _fold(ours))
    return bool(words) and words[-1] in re.findall(r"\w+", _fold(prg or ""))


def pick_geocode(body: dict, address: dict) -> dict | None:
    """Best GUGiK result on our street: the exact house number when we have one, the street when we have none.
    None if unsure: a house number PRG doesn't have is not replaced by the street's centre (it can be far off)."""
    results = [r for r in (body.get("results") or {}).values() if same_street(address["street"], r.get("street"))]
    if body.get("type") == "address" and address["number"]:
        wanted = address["number"].lower()
        candidates = [r for r in results if str(r.get("number", "")).lower() == wanted
                      and float(r.get("accuracy") or 0) >= MIN_GEOCODE_ACCURACY]
        if address["postcode"]:   # the city's postcodes are sometimes not PRG's: prefer, don't require
            candidates.sort(key=lambda r: r.get("code") != address["postcode"])
        candidates.sort(key=lambda r: -float(r.get("accuracy") or 0))
        if candidates:
            best = candidates[0]
            return {"lon": float(best["x"]), "lat": float(best["y"]), "accuracy_m": ADDRESS_POINT_ACCURACY_M,
                    "prg": {k: best.get(k) for k in ("city", "street", "number", "code", "simc", "ulic", "accuracy")}}
        return None
    if body.get("type") == "street" and not address["number"] and results:
        best = results[0]
        return {"lon": float(best["x"]), "lat": float(best["y"]), "accuracy_m": STREET_ACCURACY_M,
                "prg": {k: best.get(k) for k in ("city", "street", "simc", "ulic")}}
    return None
