from dataclasses import dataclass, fields
from datetime import date, datetime, timedelta
from typing import Protocol

from .http import Politeness, PoliteClient


@dataclass(frozen=True)
class SiteFields:
    lon: float
    lat: float
    name: str | None = None
    indoor: bool | None = None
    floor_level: str | None = None
    placement_pl: str | None = None
    placement_en: str | None = None
    access_type: str | None = None
    access_note: str | None = None
    opening_hours_raw: str | None = None
    is_24_7: bool | None = None
    wheelchair_accessible: bool | None = None
    cabinet_locked: bool | None = None
    last_verified_at: date | None = None
    device_count_reported: int | None = None
    position_accuracy_m: int | None = None     # set by sources that geocode (geocode_method 'address')

    def columns(self) -> dict[str, object]:
        """aed_site column -> value, for the values this record provides."""
        values = {f.name: getattr(self, f.name) for f in fields(self) if f.name not in ("lon", "lat")}
        return {"location": (self.lon, self.lat)} | {k: v for k, v in values.items() if v is not None}


@dataclass(frozen=True)
class PayloadLink:
    """Same AED in another source, found by a value inside that source's raw payload."""
    source: str
    path: tuple[str, ...]
    value: str


@dataclass(frozen=True)
class SourceRecord:
    external_id: str
    payload: dict
    site: SiteFields | None = None
    version: int | None = None
    modified_at: datetime | None = None
    links: tuple[tuple[str, str], ...] = ()   # (data_source.name, external_id) of the same AED elsewhere
    payload_links: tuple[PayloadLink, ...] = ()


@dataclass(frozen=True)
class Pull:
    records: list[SourceRecord]
    data_as_of: datetime | None = None


class Source(Protocol):
    name: str                 # data_source.name
    politeness: Politeness
    min_refresh: timedelta
    creates_sites: bool
    geocode_method: str       # aed_site.geocode_method; 'address' = geocoded, never replaces a surveyed position
    # optional: match_radius_m (float), for sources whose positions are less precise than the default 30 m

    def fetch(self, http: PoliteClient) -> Pull: ...


# Conflict resolution between sources (higher wins, equal = newest wins).
SOURCE_PRIORITY = {
    "WarsawAPI": 40,
    "Krakow": 40,
    "OSM": 20,
    "OpenAEDMap": 20,
    "RatujZSercem": 10,
}
