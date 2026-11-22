# Konwerter danych AED (AEDane)

Jedna strona HTML, która zamienia rejestr AED dysponenta, w dowolnym układzie kolumn, na plik zgodny ze standardem
`aed-pl` 2.0 (`standard/aed_standard_v2.json`) gotowy do wgrania na dane.gov.pl. Działa w przeglądarce, bez serwera i bez wysyłania danych.
Otwórz `index.html` z dysku (internet potrzebny tylko do czcionek).

## Standard 2.0

Krajowa lista z 31 polami o angielskich nazwach. Plik jest poprawny, gdy ma 4 pola obowiązkowe; reszta podnosi jakość danych.

- **Obowiązkowe (4)**: `aed_id` (stały, unikalny, `[A-Za-z0-9._:/-]{1,64}`, np. `KRO-0001`), `lat` (49,0–54,9), `lon` (14,1–24,2),
  `name` (2–200 znaków).
- **Zalecane (14)**: `address`, `street`, `house_number`, `postcode`, `city`, `placement`, `indoor`, `access`
  (`yes`/`customers`/`permit`/`private`/`no`), `opening_hours` (składnia OSM), `is_24_7`, `status`
  (`active`/`out_of_service`/`removed`/`unknown`), `pads_expiry`, `battery_expiry`, `last_verified`.
  Ulica i numer są oznaczone w schemacie jako opcjonalne, ale „ulica + numer” jest na liście zalecanych, więc kreator pokazuje je
  w sekcji zalecanych; gdy brak `address`, składa go z części.
- **Opcjonalne (13)**: `teryt`, `floor`, `cabinet_locked`, `unlock_method` (`none`/`code_112`/`key`/`staff`), `manufacturer`, `model`,
  `serial_number`, `udi_di` (14 cyfr), `paediatric_capable`, `operator`, `contact_phone`, `notes`, `same_as`
  (`REGON:aed_id` lub `osm:node/N`, kilka po średniku).
- **Łączenie rejestrów** (`merge` w standardzie): `same_as` oraz tożsamość urządzenia (`udi_di` + `serial_number` albo
  `manufacturer` + `model` + `serial_number`). W jednym pliku powtórzona tożsamość lub `aed_id` to błąd. Pola
  `opening_hours`, `is_24_7`, `access`, `status`, `indoor`, `floor`, `unlock_method` przy rozbieżności źródeł trafiają do pliku konfliktów.

Stare polskie nazwy kolumn z wersji 1.0 (`id_aed`, `szerokosc_geo`, `nazwa_miejsca`…) są nadal rozpoznawane jako synonimy.

## Przepływ

Strona jest kreatorem dla osób bez przygotowania technicznego: jeden krok na ekranie, duże pola i przyciski, proste
objaśnienie przy każdym polu, podgląd „Do pliku trafi np.: …” i odpowiedzi słownikowe pokazane słowami, nie kodami.
Kroki: wczytaj tabelę → wskaż kolumny → wyjaśnij określenia (pomijany, gdy nie ma czego wyjaśniać) → popraw błędy → pobierz plik.

1. **Wczytaj plik**: CSV/TSV (średnik, przecinek, tabulator; UTF-8 lub Windows-1250), XLSX (wiele arkuszy, wiersze tytułowe nad
   nagłówkiem, daty Excela), JSON (tablica obiektów, obiekt z tablicą rekordów, eksport Overpass), GeoJSON (np. OpenAEDMap)
   i XML: dowolna lista rekordów (konwerter sam znajduje powtarzający się element, np. `<aed>`, a zagnieżdżone elementy
   i atrybuty zamienia na kolumny `adres.ulica`, `polozenie.@lat`), arkusz Excel 2003 XML oraz KML (Placemark ze współrzędnymi
   i ExtendedData). Kodowanie z deklaracji XML (UTF-8, Windows-1250, ISO-8859-2).
   GML (WFS 1.x i 2.0, `featureMember`/`member`, `gml:pos`, `gml:coordinates`, `gml:coord`): punkt zamieniany na kolumny `lat`/`lon`,
   z przeliczeniem z PUWG 1992 (EPSG:2180), PUWG 2000 (EPSG:2176–2179) i EPSG:3857 na WGS 84 (odwrotne odwzorowanie
   Gaussa-Krügera na GRS80, zgodne z PROJ do 0,1 m). Kolejność osi: przy zapisie `urn:ogc:def:crs:EPSG::…` najpierw
   szerokość/northing (jak w definicji EPSG), przy krótkim `EPSG:…` najpierw x/easting; dla PUWG 2000 kolejność sprawdzana jest
   też po strefie, a gdy wynik wypada poza Polską, osie są zamieniane.
2. **Dopasuj kolumny**: dla każdego z 31 pól konwerter proponuje kolumnę na podstawie nazwy (synonimy, podobieństwo nazw)
   i zawartości (kod pocztowy, zakres współrzędnych, e-mail, telefon, daty, godziny). Każde pole można zmienić ręcznie:
   inna kolumna, stała wartość dla wszystkich wierszy albo (dla `aed_id`) nowe identyfikatory.
   Przekształcenia: rozbicie pełnego adresu na ulicę, numer, kod i miejscowość; rozbicie pary współrzędnych (też WKT i stopnie
   z minutami); „dostępny 24/7” wyliczany z godzin. Wartości słownikowe i tak/nie tłumaczy się w tabelkach z podpowiedziami.
3. **Sprawdź wartości**: walidator standardu 2.0 (`src/walidator.js`) sprawdza każdą wartość
   według typu pola. Konwerter sam poprawia typowe zapisy (daty `15.11.2026`, liczby dat z Excela, kody pocztowe bez myślnika,
   godziny po polsku `pn-pt 7-19` → `Mo-Fr 07:00-19:00`, zamienione współrzędne) i pokazuje, co zmienił.
   Błędy grupowane są według pól i wierszy; pojedyncze wartości można poprawić na miejscu.
4. **Pobierz**: CSV (UTF-8, przecinek, kolumny w kolejności standardu) i JSON z wierszami bez błędów, raport problemów,
   opis zbioru dla dane.gov.pl i **plik mapowania** do ponownego użycia przy następnej aktualizacji.
   Przeglądarka sama pamięta mapowanie dla danego układu kolumn.

## Pliki

| Ścieżka | Co to jest |
|---|---|
| `index.html` | Gotowa strona (generowana, nie edytuj) |
| `src/mapper.js` | Logika bez interfejsu: wczytywanie plików, dopasowanie kolumn, przekształcenia, zapis mapowania. Działa też w Node |
| `src/walidator.js` | Walidator standardu 2.0 (przeglądarka i Node) |
| `standard/aed_standard_v2.json` | Standard 2.0: pola, poziomy, słowniki, reguły łączenia |
| `src/app.js`, `src/konwerter.template.html` | Interfejs |
| `przyklady/rejestr_gminy_przyklad.csv` | Fikcyjny „rejestr gminy” z innymi nazwami kolumn, wczytywany na start |
| `test/` | Testy (`node --test test/*.test.js`) i pliki XLSX, GeoJSON, XML, GML i KML do nich |

## Budowanie

```bash
cd solution/konwerter
node build.mjs             # składa index.html
node --test test/*.test.js
```
