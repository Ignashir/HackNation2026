from datetime import date

import pytest
import requests

from aed_import.hours import Rule, parse_opening_hours
from aed_import.http import Politeness, PoliteClient
from aed_import.osm import site_from_tags


@pytest.mark.parametrize("text, is_24_7, days", [
    ("24/7", True, []),
    ("Mo-Su 00:00-24:00", True, []),
    ("Mo-Fr 07:30-15:30; Sa-Su, PH off", False, [1, 2, 3, 4, 5]),
    ("Mo-Su 08:00-20:00; Su off", False, [1, 2, 3, 4, 5, 6]),
    ("Fr-Mo 22:00-06:00", False, [1, 5, 6, 7]),
])
def test_opening_hours(text, is_24_7, days):
    hours = parse_opening_hours(text)
    assert hours.is_24_7 is is_24_7
    assert [rule.weekday for rule in hours.rules] == days


def test_opening_hours_keeps_split_shifts_and_holidays():
    hours = parse_opening_hours("Mo 08:00-12:00,13:00-16:00; PH 10:00-14:00")
    assert hours.rules == (Rule(1, "08:00", "12:00"), Rule(1, "13:00", "16:00"),
                           Rule(None, "10:00", "14:00", public_holiday=True))


@pytest.mark.parametrize("text", ["Mo-Fr sunrise-sunset", "Jan-Mar Mo 08:00-10:00", "Mo-Fr 08:00-08:00"])
def test_unsupported_opening_hours(text):
    assert parse_opening_hours(text) is None


def test_site_from_osm_tags():
    site = site_from_tags(21.0, 52.2, {
        "location": "outdoor", "access": "permissive", "wheelchair": "designated",
        "check_date": "03.04.2023", "survey:date": "2022-01-01",
        "defibrillator:location": "przy wejściu", "opening_hours": "Mo-Fr 08:00-16:00",
    })
    assert (site.indoor, site.access_type, site.wheelchair_accessible) == (False, "yes", True)
    assert site.last_verified_at == date(2023, 4, 3)
    assert site.placement_pl == "przy wejściu"
    assert site.is_24_7 is False
    assert site.columns()["location"] == (21.0, 52.2)
    assert "name" not in site.columns()


def test_client_spaces_requests_and_honours_retry_after():
    responses = [_response(429, {"Retry-After": "7"}), _response(200)]
    session = requests.Session()
    session.request = lambda *args, **kwargs: responses.pop(0)
    sleeps = []
    client = PoliteClient(Politeness(min_interval_s=2), "test", session=session,
                          sleep=sleeps.append, clock=lambda: 0.0)

    assert client.get("https://example.org").status_code == 200
    assert sleeps == [7.0, 2.0]


def _response(status: int, headers: dict | None = None) -> requests.Response:
    response = requests.Response()
    response.status_code = status
    response.headers.update(headers or {})
    return response
