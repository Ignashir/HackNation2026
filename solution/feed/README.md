# AED feed generator (harvester, XSD 1.14)

Lets a provider publish its AED register on dane.gov.pl **without uploading files by hand**. The tool writes a
harvester feed for each provider; the provider's representative registers the feed URL once as a data source in the
dane.gov.pl admin panel, and the portal harvests it on schedule.

```sh
python aed_feed.py --config demo/feeds.json --out public/ --base-url https://example.org/aed-feeds
```

For each provider it writes `public/<slug>/feed.xml`, `feed.md5` (the portal requires it next to the feed) and the CSV
files. Publish the folder on any HTTPS host. Python 3.9+, standard library only.

## What the portal does with it

- The dataset carries `<dataStandard code="aed" version="1.0"/>` (new in XSD 1.14, added by our backend patch), so the
  portal checks each file against the [AED standard](../standard/aed/).
- A new or changed file is saved as a draft, checked, and **published automatically when it conforms**. A file that
  does not conform stays a draft; the reason is on the file's "Data standard" tab in the admin panel.
- The portal downloads a file again only when its URL changes, so each URL ends with `?v=<content hash>`: a corrected
  file gets a new URL and the next harvest picks it up.
- `int_ident` (optional) takes over a dataset the provider already created by hand, instead of creating a second one.
  An institution can have only one dataset per standard.

## Config

`demo/feeds.json`: per provider a `slug`, the dataset (`ext_ident`, titles, description, categories, tags, licence,
optional `int_ident`) and its files (`ext_ident`, `file`, title, description). Paths are relative to the config file.

## Demo on the local portal (Marki)

Marki's original file is mis-quoted (each row is one quoted string) and has latitude and longitude swapped, so the
portal blocks it. `demo/marki/1-oryginal.csv` is that file, `demo/marki/2-poprawiony.csv` the corrected one in the
standard's columns (AED no. 7 is left out: its coordinates in the source point to Krosno). `rejestr.csv` is the file
the feed serves.

```sh
cp demo/marki/1-oryginal.csv demo/marki/rejestr.csv
python aed_feed.py --config demo/feeds.json --out ../../codebase/backend_latest/media/feeds \
    --base-url https://mcod.local/media/feeds
```

1. Admin → Harvester → data sources: add an XML source for Urząd Miasta Marki with
   `https://mcod.local/media/feeds/marki/feed.xml`, and run the import. The file arrives as a **draft**, status
   "Required columns are not mapped".
2. `cp demo/marki/2-poprawiony.csv demo/marki/rejestr.csv`, generate the feed again, run the import again. The file
   conforms and is **published**; the next national list build includes Marki.

Locally the feed is served by the portal's nginx (`media/feeds`) under `mcod.local`. Don't use `api.mcod.local`: the
portal treats links on its own API domain as uploaded files and does not download them.
