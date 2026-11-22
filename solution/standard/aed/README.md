# AED register: data standard

The shared format for publishing AED (automated external defibrillator) locations on dane.gov.pl. Each provider
(a town hall, hospital, company…) publishes **its own** AED register in this format and stays accountable for it.
dane.gov.pl checks files against the standard and combines all registers into one national list.

| Version | Status | Files |
|---|---|---|
| [1.0](1.0/) | draft | [`schema.json`](1.0/schema.json) (Table Schema), [`example.csv`](1.0/example.csv) (Krosno, real data) |

## The file

- CSV in UTF-8, comma-separated, header row first. One row = **one AED device**.
- Column names are the standard's names (below). If your file uses other names, map them once when uploading:
  the portal suggests the mapping, or our converter produces a file with the standard's names.
- Empty cells are allowed in optional columns. `-` also means "no data".
- Dates: `YYYY-MM-DD`. Decimal numbers: a dot as the separator (`49.718809`). Yes/no: `tak`/`nie` (also
  `true`/`false`, `1`/`0`).
- Coordinates: WGS84 decimal degrees. Files whose points fall outside Poland are rejected; this usually means latitude
  and longitude are swapped.

## Columns (v1.0)

**Required**

| Column | Meaning | Example |
|---|---|---|
| `aed_id` | Stable ID of the device in your register, unique in the file, **never reused or changed** | `KRO-0001` |
| `lat` | Latitude, 49.0–54.9 | `49.718809` |
| `lon` | Longitude, 14.1–24.2 | `21.720344` |
| `name` | Name of the place (shown on the map); not just "Defibrylator" | `Zespół Krytych Pływalni` |

**Recommended:** `address` or (`street`, `house_number`), `postcode` (`NN-NNN`), `city`, `placement`, `indoor`, `access`
(`yes`/`customers`/`permit`/`private`/`no`), `opening_hours` (OSM syntax, e.g. `Mo-Fr 08:00-16:00`, `24/7`),
`is_24_7`, `status` (`active`/`out_of_service`/`removed`/`unknown`), `pads_expiry`, `battery_expiry`, `last_verified`.

**Optional:** `teryt` (7-digit TERC code), `floor`, `cabinet_locked`, `unlock_method`
(`none`/`code_112`/`key`/`staff`), `manufacturer`, `model`, `serial_number`, `udi_di` (14-digit GTIN from the UDI
barcode), `paediatric_capable`, `operator`, `contact_phone`, `notes`.

Full descriptions (PL/EN), examples and accepted header synonyms are in `schema.json` under each field's `x-aed`.

## How it maps to our database (`solution/sql`)

| Standard | Database |
|---|---|
| `aed_id` | `source_record.external_id` (per provider = per `data_source`) |
| `lat`, `lon` | `aed_site.location` |
| `name`, `placement`, `indoor`, `floor`, `access`, `opening_hours`, `is_24_7`, `cabinet_locked`, `unlock_method`, `last_verified` | `aed_site.name`, `placement_pl`, `indoor`, `floor_level`, `access_type`, `opening_hours_raw`, `is_24_7`, `cabinet_locked`, `unlock_method`, `last_verified_at` |
| `address`, `street`, `house_number`, `postcode`, `city`, `teryt` | `address` |
| `manufacturer`, `model`, `udi_di` | `device_model` (+ manufacturer `organization`) |
| `serial_number`, `status`, `paediatric_capable`, `pads_expiry`, `battery_expiry` | `aed_device` |
| `operator` | `aed_site.operator_org_id` → `organization` |

## Validating a file

The schema is a standard [Frictionless Table Schema](https://specs.frictionlessdata.io/table-schema/), the same
engine dane.gov.pl uses (`goodtables` 2.1, `tableschema` 1.21):

```python
from goodtables import validate
report = validate("my_aeds.csv", schema="1.0/schema.json", checks=["structure", "schema"])
print(report["valid"], report["tables"][0]["errors"])
```

## Changelog

- **1.0** (2026-11-21, draft): first version, derived from `solution/sql` and the four AED datasets already on
  dane.gov.pl (Krosno, Przemyśl, Marki, Warsaw).
