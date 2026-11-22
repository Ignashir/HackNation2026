# dane.gov.pl backend patch: data standards (AED register)

`backend-aed-standard.patch` adds **data standards** to the dane.gov.pl backend (mcod): datasets bound to a standard
only publish files that conform to it. AED v1.0 ([`solution/standard/aed`](../standard/aed/)) is the first standard.
See the design in [`solution/docs/backend_integration_plan.md`](../docs/backend_integration_plan.md) (Phase 1).
No AI in the portal: mapping is deterministic (standard names, header synonyms, value patterns).

## What it changes

| Area | Change |
|---|---|
| New app `mcod/standards` | `DataStandard` (versioned Table Schema), `ResourceConformity` (per-file mapping, status, report), admin pages, Celery tasks |
| `Dataset.data_standard` | Nullable FK + migration; "Data standard" field on the dataset admin form; one dataset per institution and standard |
| File processing (`resources/tasks/process_resource_file_data.py`) | Before the portal's own validation: suggest the column mapping, convert rows to the standard's columns, validate them with goodtables, store the report. Mapped columns get the standard's types (e.g. a phone column is text, not a guessed integer) |
| Publish block (`resources/forms.py`, `resources/admin.py`) | In a bound dataset a non-conforming file can't be published. A new or replaced file is saved as a draft and published automatically once it conforms |
| "Data standard" tab on the file page | Status, mapping table (standard field → provider column, how it was matched), warnings, errors |
| Portal map roles | For a conforming file, the portal's map (Maps and plots) is filled in automatically from the standard mapping |
| Broken-CSV check (all datasets) | New goodtables check `single-column-delimited` (`resources/goodtables_checks.py`): a mis-quoted CSV read as one column now fails visibly |
| `manage.py load_data_standards` | Loads `data/standards/<code>/<version>/schema.json` (copy of `solution/standard/aed/1.0/schema.json`) |
| `manage.py load_aed_providers` | Real providers (Krosno, Przemyśl, Marki, Warsaw): institutions, a representative account each, AED-register datasets, their real files from dane.gov.pl |

## Apply and set up (local portal from `codebase/`)

```bash
cd codebase/backend_latest
git apply ../../solution/portal_patch/backend-aed-standard.patch
docker exec mcod-admin python manage.py migrate
docker exec mcod-admin python manage.py load_data_standards
docker exec mcod-admin python manage.py load_aed_providers
docker compose -f docker-compose.local.yml -f docker-compose.hacknation.yml restart mcod-local-celery
```

Keep `data/standards/aed/1.0/schema.json` in sync with `solution/standard/aed/1.0/schema.json` (the source of truth).

Frontend (local dev only): `codebase/frontend_latest/angular.json`, serve configuration `local`, needs
`"prebundle": { "exclude": ["leaflet"] }`, otherwise maps crash in the dev server ("Dynamic require of leaflet").

## Try it

- Admin: https://admin.mcod.local. Representatives: `aed.krosno@mcod.local`, `aed.przemysl@mcod.local`,
  `aed.marki@mcod.local`, `aed.warszawa@mcod.local`, coordinator `aed.koordynator@mcod.local`; password `AedTest123!`
  (local only).
- Expected after `load_aed_providers`:

| Provider | Result |
|---|---|
| Krosno | Conforms; published automatically; table + map; `name` taken from "Lokalizacja" (not the generic "Nazwa") |
| Przemyśl | Conforms; lat/lon extracted from the JSON `geometry` column; published automatically (the live portal rejects this file) |
| Marki | Blocked as a draft: mis-quoted CSV read as one column, required fields unmapped; publishing is refused with the reason |
| Warsaw | Institution and dataset only; the data needs a dane.um.warszawa.pl API key (`solution/importer`) |

## Not yet (next steps in the plan)

- Editing the mapping by hand in the "Data standard" tab (it is shown read-only; suggestions are automatic).
- Harvester XSD 1.14 with `dataStandard` (Phase 2), national list + `/1.4/standards/aed/aggregated` (Phase 3),
  frontend badge and AED page (Phase 4).
- Tests in the portal's pytest suite.
