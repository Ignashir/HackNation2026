from datetime import date, datetime, timedelta

from .hours import parse_opening_hours
from .http import Politeness, PoliteClient
from .records import Pull, SiteFields, SourceRecord

ACCESS = {"yes": "yes", "permissive": "yes", "customers": "customers",
          "permit": "permit", "private": "private", "no": "no"}


class OpenAEDMapSource:
    name = "OpenAEDMap"
    politeness = Politeness(min_interval_s=1, timeout_s=180)
    min_refresh = timedelta(hours=1)   # export is served with Cache-Control: max-age=3600
    creates_sites = True
    geocode_method = "osm"

    def __init__(self, url: str = "https://openaedmap.org/api/v1/countries/PL.geojson"):
        self.url = url

    def fetch(self, http: PoliteClient) -> Pull:
        features = http.get(self.url).json()["features"]
        return Pull([self._record(feature) for feature in features])

    @staticmethod
    def _record(feature: dict) -> SourceRecord:
        props = feature["properties"]
        lon, lat = feature["geometry"]["coordinates"]
        tags = {k: v for k, v in props.items() if not k.startswith("@")}
        return osm_record(props["@osm_type"], props["@osm_id"], tags, lon, lat,
                          version=props.get("@osm_version"), payload=feature, mirror_of="OSM")


class OverpassSource:
    """Overpass usage policy: few heavy queries, back off on 429/504."""
    name = "OSM"
    politeness = Politeness(min_interval_s=10, timeout_s=330, backoff_s=30)
    min_refresh = timedelta(hours=1)
    creates_sites = True
    geocode_method = "osm"
    QUERY = """[out:json][timeout:300];
area["ISO3166-1"="PL"][admin_level=2]->.pl;
nwr["emergency"="defibrillator"](area.pl);
out meta center;"""

    def __init__(self, url: str = "https://overpass-api.de/api/interpreter"):
        self.url = url

    def fetch(self, http: PoliteClient) -> Pull:
        body = http.post(self.url, data={"data": self.QUERY}).json()
        as_of = _timestamp(body.get("osm3s", {}).get("timestamp_osm_base"))
        return Pull([self._record(element) for element in body["elements"]], as_of)

    @staticmethod
    def _record(element: dict) -> SourceRecord:
        point = element.get("center", element)
        return osm_record(element["type"], element["id"], element.get("tags", {}),
                          point.get("lon"), point.get("lat"),
                          version=element.get("version"), payload=element, mirror_of="OpenAEDMap",
                          modified_at=_timestamp(element.get("timestamp")))


def osm_record(osm_type: str, osm_id: int, tags: dict, lon: float | None, lat: float | None, *,
               version: int | None, payload: dict, mirror_of: str,
               modified_at: datetime | None = None) -> SourceRecord:
    external_id = f"{osm_type}/{osm_id}"
    links = [(mirror_of, external_id)]
    if warsaw_ref := tags.get("ref:api-um-warszawa-pl"):
        links.append(("WarsawAPI", warsaw_ref))
    site = site_from_tags(lon, lat, tags) if lon is not None and lat is not None else None
    return SourceRecord(external_id, payload, site, version, modified_at, tuple(links))


def site_from_tags(lon: float, lat: float, tags: dict) -> SiteFields:
    hours = tags.get("opening_hours")
    parsed = parse_opening_hours(hours) if hours else None
    return SiteFields(
        lon=lon,
        lat=lat,
        name=tags.get("name"),
        indoor=_indoor(tags),
        floor_level=tags.get("level") or tags.get("addr:floor") or tags.get("floor"),
        placement_pl=tags.get("defibrillator:location:pl") or tags.get("defibrillator:location"),
        placement_en=tags.get("defibrillator:location:en"),
        access_type=ACCESS.get(tags.get("access")),
        opening_hours_raw=hours,
        is_24_7=bool(parsed and parsed.is_24_7) if hours else None,
        wheelchair_accessible=_yes_no(tags.get("wheelchair"), yes=("yes", "designated")),
        cabinet_locked=_yes_no(tags.get("locked")),
        last_verified_at=max(filter(None, (_date(tags.get("check_date")), _date(tags.get("survey:date")))),
                             default=None),
    )


def _indoor(tags: dict) -> bool | None:
    for key, indoor_value, outdoor_value in (("indoor", "yes", "no"),
                                             ("location", "indoor", "outdoor"),
                                             ("outdoor", "no", "yes")):
        value = tags.get(key)
        if value in (indoor_value, outdoor_value):
            return value == indoor_value
    return None


def _yes_no(value: str | None, yes=("yes",), no=("no",)) -> bool | None:
    return True if value in yes else False if value in no else None


def _date(value: str | None) -> date | None:
    if not value:
        return None
    value = value.split(";")[0].strip()
    for fmt in ("%Y-%m-%d", "%Y-%m", "%d.%m.%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    return None


def _timestamp(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None
