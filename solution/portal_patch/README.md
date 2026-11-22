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
| Harvester XSD 1.14 (`data/harvester/`, `harvester/serializers.py`, `harvester/models.py`, `standards/harvest.py`) | Optional `<dataStandard code=".." version=".."/>` binds a harvested dataset to a standard. Harvested files of a bound dataset are drafts until they conform, then published automatically. Feeds come from [`solution/feed`](../feed/) |
| National list (`standards/aggregate.py`, `GET /1.4/standards/{code}/aggregated`) | Nightly "Krajowy wykaz AED" from all conforming files: merged list, all rows, conflicts, changes |
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

- Rejection codes for non-conforming harvested files in the harvest report and the email.
- A search filter by standard (needs re-indexing) and `related_resource` links from provider files to the list.
- Tests in the portal's pytest suite.
