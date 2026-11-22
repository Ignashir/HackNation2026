from datetime import datetime, timezone

import pytest

from aed_import.krakow import (ADDRESS_POINT_ACCURACY_M, STREET_ACCURACY_M, as_of, last_page_index, parse_address,
                               parse_detail, parse_list, pick_geocode, site_name)

# Trimmed from krakow.pl (list page 1 and a detail page), markup as served.
LIST_PAGE = """
<div class="article__description_lead"><p>Wykaz lokalizacji automatycznych defibrylatorów zewnętrznych rozmieszczonych
w Krakowie w ramach programu Krakowski IMPULS ŻYCIA AED (stan na dzień 01.10.2026 r.).</p>
<tbody class="article-map-points__table__content">
  <tr><td><div class="article-map-points__table__content__name">
    <h4 class="h6"><a href="/instcbi/3992/inst/33070/2432/Bazylika-Mariacka-Zakrystia.html">Bazylika Mariacka - Parafia pw. Wniebowzięcia Najświętszej Maryi Panny- Zakrystia</a></h4>
        <p>Plac Mariacki 5 31-042 Kraków</p>
  </div></td><td class="article-map-points__table__content__category"> Defibrylatory zewnętrzne AED</td></tr>
  <tr><td><div class="article-map-points__table__content__name">
    <h4 class="h6"><a href="/instcbi/3992/inst/33063/2432/Centrum-Jana-Pawla-II.html">Centrum Jana Pawła II &bdquo;Nie lękajcie się!&rdquo; – hol parter</a></h4>
        <p>ul. Totus Tuus 34 30-610 Kraków</p>
  </div></td></tr>
</tbody>
<a href="/instcbi/3992/2432/1/#article-map-points__tableCBO">2</a> <a href="/instcbi/3992/2432/3/#article-map-points__tableCBO">4</a>
"""

DETAIL_PAGE = """
<table class="article-place__table"> <tr> <td> Kategoria: </td> <td> Defibrylatory zewnętrzne AED </td> </tr>
<tr> <td>Adres:</td> <td>Plac Mariacki 5, 31-042 Kraków</td> </tr> </table></div>
<div class="object_desc">
    <b>Liczba AED: 1</b><br>Zakrystia </div>
<span class="bold"> Data: </span> <time class="article-title__time" datetime="2024-04-23">2024-04-23</time>
"""


def test_list_page():
    rows = parse_list(LIST_PAGE)
    assert [r["id"] for r in rows] == ["33070", "33063"]
    assert rows[1]["name"] == "Centrum Jana Pawła II „Nie lękajcie się!” – hol parter"
    assert rows[0]["address"] == "Plac Mariacki 5 31-042 Kraków"
    assert last_page_index(LIST_PAGE) == 3
    assert as_of(LIST_PAGE) == datetime(2026, 10, 1, tzinfo=timezone.utc)


def test_detail_page():
    assert parse_detail(DETAIL_PAGE) == {"address": "Plac Mariacki 5, 31-042 Kraków", "count": 1,
                                         "placement": "Zakrystia", "published": "2024-04-23"}


@pytest.mark.parametrize("name, placement, expected", [
    ("Bazylika Mariacka - Parafia pw. Wniebowzięcia Najświętszej Maryi Panny- Zakrystia", "Zakrystia",
     "Bazylika Mariacka - Parafia pw. Wniebowzięcia Najświętszej Maryi Panny"),
    ("Dom Jana Matejki - Muzeum Narodowe w Krakowie – hol parter", "hol parter",
     "Dom Jana Matejki - Muzeum Narodowe w Krakowie"),
    ("Dwór Czeczów", "hol", "Dwór Czeczów"),
    ("Opera Krakowska", None, "Opera Krakowska"),
])
def test_site_name_drops_placement(name, placement, expected):
    assert site_name(name, placement) == expected


@pytest.mark.parametrize("text, expected", [
    ("Plac Mariacki 5, 31-042 Kraków", ("Plac Mariacki", "5", "31-042", "Kraków")),
    ("ul. Lipowa 4 4 30-702 Kraków", ("Lipowa", "4", "30-702", "Kraków")),          # number repeated
    ("ul. Dojazdowa 4 Kraków", ("Dojazdowa", "4", None, "Kraków")),                  # no postcode
    ("Rynek Główny 31-011 Kraków", ("Rynek Główny", None, "31-011", "Kraków")),      # no number
    ("os. Centrum E 1 1 31-934 Kraków", ("os. Centrum E", "1", "31-934", "Kraków")),
    ("ul. Przy Rondzie 7 31-547 Kraków", ("Przy Rondzie", "7", "31-547", "Kraków")),
    ("ul. Medweckiego 1 32-083 Balice", ("Medweckiego", "1", "32-083", "Balice")),
    ("ul. Pawia 5A 31-154 Kraków", ("Pawia", "5A", "31-154", "Kraków")),
    ("Plac Wszystkich Świętych 3-4, 31-004 Kraków", ("Plac Wszystkich Świętych", "3-4", "31-004", "Kraków")),
])
def test_parse_address(text, expected):
    a = parse_address(text)
    assert (a["street"], a["number"], a["postcode"], a["city"]) == expected


def _result(number, accuracy, code="31-041", x="19.94", y="50.06", street="Plac Mariacki"):
    return {"city": "Kraków", "street": street, "number": number, "code": code, "x": x, "y": y,
            "accuracy": str(accuracy), "simc": "0950463", "ulic": "45908"}


ADDRESS = {"street": "Plac Mariacki", "number": "5", "postcode": "31-042", "city": "Kraków"}


def test_geocode_takes_exact_number_with_best_accuracy():
    body = {"type": "address", "results": {"1": _result("5", 1, x="19.9400"), "2": _result("5", 0.6, x="19.9500",
                                                                                        street="Plac Nowy")}}
    point = pick_geocode(body, ADDRESS)
    assert (point["lon"], point["accuracy_m"]) == (19.94, ADDRESS_POINT_ACCURACY_M)


def test_geocode_rejects_other_numbers_and_weak_matches():
    assert pick_geocode({"type": "address", "results": {"1": _result("15", 1)}}, ADDRESS) is None
    assert pick_geocode({"type": "address", "results": {"1": _result("5", 0.4)}}, ADDRESS) is None
    assert pick_geocode({"type": "address", "results": {}}, ADDRESS) is None


def test_geocode_rejects_another_street_with_the_same_number():
    # "Kraków, Wadowicka 8" (not in PRG) comes back as Wadowska 8, Rakowicka 8, ...
    body = {"type": "address", "results": {"1": _result("8", 0.68, street="Wadowska"),
                                           "2": _result("8", 0.61, street="Rakowicka")}}
    assert pick_geocode(body, {**ADDRESS, "street": "Wadowicka", "number": "8"}) is None


def test_geocode_accepts_prg_full_street_names():
    body = {"type": "address", "results": {"1": _result("12", 0.575, street="Marszałka Józefa Piłsudskiego")}}
    assert pick_geocode(body, {**ADDRESS, "street": "Piłsudskiego", "number": "12"}) is not None
    body = {"type": "address", "results": {"1": _result("1", 0.75, street="Osiedle Centrum E")}}
    assert pick_geocode(body, {**ADDRESS, "street": "os. Centrum E", "number": "1"}) is not None


def test_missing_house_number_is_not_replaced_by_the_street():
    body = {"type": "street", "results": {"1": {"street": "Plac Mariacki", "x": "19.94", "y": "50.06"}}}
    assert pick_geocode(body, ADDRESS) is None


def test_geocode_falls_back_to_street_centroid():
    body = {"type": "street", "results": {"1": {"street": "Rynek Główny", "x": "19.9372", "y": "50.0616"}}}
    point = pick_geocode(body, {**ADDRESS, "street": "Rynek Główny", "number": None})
    assert (point["lat"], point["accuracy_m"]) == (50.0616, STREET_ACCURACY_M)
