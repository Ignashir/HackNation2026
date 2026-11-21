import pytest

from aed_import.warsaw import WarsawSource, polish_hours_to_osm

# Example response from the dataset's documentation (scb_lokalizacja_defibrylatorow_pw.json)
DOCUMENTED_ITEM = {
    "geometry": {"coordinates": [[21.0148748892902, 52.2086170695684]], "type": "Point"},
    "properties": {
        "defibrillator_id": "622",
        "device_access_description": "Poniedziałek: godz. 8:00-18:00; Wtorek-Piątek: godz. 8:00-16:00",
        "device_availability": "Ograniczona",
        "device_location": "Wewnątrz budynku",
        "device_manufacturer": "Medtronic",
        "device_public_access": "Publiczny",
        "location_building": "25/27",
        "location_city": "Warszawa",
        "location_description": "Przy wejściu na półpiętrze.",
        "location_object_name": "Urząd Dzielnicy Mokotów m.st. Warszawy",
        "location_postcode": "02-517",
        "location_street": "Rakowiecka",
    },
}


def test_documented_record_maps_to_site():
    record = WarsawSource._record(DOCUMENTED_ITEM)
    site = record.site
    assert record.external_id == "622"
    assert (site.lon, site.lat) == (21.0148748892902, 52.2086170695684)
    assert site.name == "Urząd Dzielnicy Mokotów m.st. Warszawy"
    assert (site.indoor, site.access_type, site.is_24_7) == (True, "yes", False)
    assert site.opening_hours_raw == "Mo 08:00-18:00; Tu-Fr 08:00-16:00"
    assert record.payload_links[0].value == "622"


def test_availability_and_access_vocabulary():
    props = {**DOCUMENTED_ITEM["properties"], "device_availability": "Tak", "device_public_access": "Prywatny"}
    site = WarsawSource._record({**DOCUMENTED_ITEM, "properties": props}).site
    assert (site.is_24_7, site.access_type) == (True, "private")


@pytest.mark.parametrize("text, osm", [
    ("od poniedziałku do piątku w godzinach 07:30 - 19:00", "Mo-Fr 07:30-19:00"),
    ("Dni powszednie 07:00-17:00", "Mo-Fr 07:00-17:00"),
    ("pon., wt. 11.30 – 19.00, śr. 8:30 – 16:00", "Mo,Tu 11:30-19:00; We 08:30-16:00"),
    ("W tygodniu 6-22:00 w weekendy 8:00-22:00", "Mo-Fr 06:00-22:00; Sa,Su 08:00-22:00"),
    ("poniedziałek - piątek 7;00 - 17;30", "Mo-Fr 07:00-17:30"),
    ("Całodobowo", "24/7"),
])
def test_polish_hours(text, osm):
    assert polish_hours_to_osm(text) == osm


@pytest.mark.parametrize("text", [
    "W godzinach otwarcia stacji metra",
    "8-16",                                               # no days: do not guess
    "W roku szkolnym 9-21, w wakacje i ferie 8-16",
    "Dni powszednie 8:00 - 16:00 (możliwa chwilowa niedostępność z uwagi na spacer dzieci)",
])
def test_ambiguous_hours_are_not_converted(text):
    assert polish_hours_to_osm(text) is None
