import os
import re
from datetime import timedelta

from .hours import parse_opening_hours
from .http import Politeness, PoliteClient
from .records import PayloadLink, Pull, SiteFields, SourceRecord

DAY_NAMES = ("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su")
_DAY_PREFIXES = (("pon", 1), ("pn", 1), ("wt", 2), ("śr", 3), ("czw", 4), ("piąt", 5), ("pt", 5),
                 ("sob", 6), ("sb", 6), ("niedz", 7), ("nd", 7))
_DAY_GROUPS = {"powszednie": range(1, 6), "robocze": range(1, 6), "tygodniu": range(1, 6),
               "weekend": (6, 7), "weekendy": (6, 7), "weekendów": (6, 7), "codziennie": range(1, 8)}
_FILLER = {"od", "w", "we", "dni", "dostępny", "dostępne", "oraz", "i", "pracy", "obiektu", "ośrodka", "tj"}
_RANGE = {"-", "do"}
_ALWAYS = {"całodobowo", "całodobowa", "całodobowy", "24/7", "24h"}

_TOKEN = re.compile(r"[a-ząćęłńóśźż]+|-")
_SPAN = re.compile(r"(?<![\d:.])(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|do)\s*(\d{1,2})(?:[:.](\d{2}))?(?![\d:.])")


class WarsawSource:
    """dane.um.warszawa.pl "Lokalizacja defibrylatorów (AED)", CC-BY, Stołeczne Centrum Bezpieczeństwa."""
    name = "WarsawAPI"
    politeness = Politeness(min_interval_s=1, timeout_s=120)
    min_refresh = timedelta(hours=12)   # dataset is refreshed daily
    creates_sites = True
    geocode_method = "manual"
    url = "https://dane.um.warszawa.pl/api/action/get_scb_lokalizacja_defibrylatorow"

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.environ.get("WARSAW_API_KEY")
        if not self.api_key:
            raise ValueError("WarsawAPI needs a dane.um.warszawa.pl key: pass api_key or set WARSAW_API_KEY")

    def fetch(self, http: PoliteClient) -> Pull:
        items = http.post(self.url, headers={"Authorization": self.api_key}).json()
        return Pull([self._record(item) for item in items])

    @staticmethod
    def _record(item: dict) -> SourceRecord:
        props = item["properties"]
        external_id = str(props["defibrillator_id"])
        coordinates = item["geometry"]["coordinates"]
        lon, lat = coordinates[0] if isinstance(coordinates[0], list) else coordinates
        osm_ref = ("ref:api-um-warszawa-pl",)
        return SourceRecord(
            external_id=external_id,
            payload=item,
            site=site_from_properties(lon, lat, props),
            payload_links=(PayloadLink("OpenAEDMap", ("properties", *osm_ref), external_id),
                           PayloadLink("OSM", ("tags", *osm_ref), external_id)),
        )


def site_from_properties(lon: float, lat: float, props: dict) -> SiteFields:
    hours_text = props.get("device_access_description") or None
    opening_hours = polish_hours_to_osm(hours_text) if hours_text else None
    location = (props.get("device_location") or "").lower()
    availability = (props.get("device_availability") or "").strip().lower()
    public_access = (props.get("device_public_access") or "").strip().lower()
    return SiteFields(
        lon=lon,
        lat=lat,
        name=props.get("location_object_name"),
        indoor=True if "wewnątrz" in location else False if "zewnątrz" in location else None,
        placement_pl=props.get("location_description"),
        access_type={"publiczny": "yes", "prywatny": "private"}.get(public_access),
        access_note=hours_text,
        opening_hours_raw=opening_hours,
        is_24_7=availability == "tak" or opening_hours == "24/7" if availability or opening_hours else None,
    )


def polish_hours_to_osm(text: str) -> str | None:
    """Free-text Polish hours to OSM opening_hours; None unless every word is understood."""
    text = _normalise(text)
    if text in _ALWAYS:
        return "24/7"
    rules, cursor = [], 0
    for span in _SPAN.finditer(text):
        days = _days(text[cursor:span.start()])
        start, end = _time(span[1], span[2]), _time(span[3], span[4])
        if not days or not start or not end or start == end:
            return None
        rules.append(f"{_osm_days(days)} {start}-{end}")
        cursor = span.end()
    if not rules or _days(text[cursor:]) != set():
        return None
    osm = "; ".join(rules)
    return osm if parse_opening_hours(osm) else None


def _normalise(text: str) -> str:
    text = text.lower().replace("–", "-").replace("—", "-")
    text = re.sub(r"(\d{1,2});(\d{2})", r"\1:\2", text)
    text = re.sub(r"godz\w*\.?", " ", text)
    return text.strip(" .")


def _days(selector: str) -> set[int] | None:
    """Days named in a selector; None if it contains a word we do not understand."""
    days: set[int] = set()
    last, open_range = None, False
    for token in _TOKEN.findall(selector):
        day = next((number for prefix, number in _DAY_PREFIXES if token.startswith(prefix)), None)
        if day:
            days.update(_day_range(last, day) if open_range else (day,))
            last, open_range = day, False
        elif token in _RANGE:
            open_range = last is not None
        elif token in _DAY_GROUPS:
            days.update(_DAY_GROUPS[token])
        elif token not in _FILLER:
            return None
    return days


def _day_range(first: int, last: int) -> list[int]:
    return [(first - 1 + i) % 7 + 1 for i in range((last - first) % 7 + 1)]


def _time(hours: str, minutes: str | None) -> str | None:
    h, m = int(hours), int(minutes or 0)
    if h > 24 or m > 59 or (h == 24 and m):
        return None
    return f"{h:02d}:{m:02d}"


def _osm_days(days: set[int]) -> str:
    runs: list[list[int]] = []
    for day in sorted(days):
        if runs and day == runs[-1][-1] + 1:
            runs[-1].append(day)
        else:
            runs.append([day])
    return ",".join(f"{DAY_NAMES[r[0] - 1]}-{DAY_NAMES[r[-1] - 1]}" if len(r) > 2
                    else ",".join(DAY_NAMES[d - 1] for d in r) for r in runs)
