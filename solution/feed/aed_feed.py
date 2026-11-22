"""
Generate dane.gov.pl harvester feeds (XML, XSD 1.14) for AED providers.

    python aed_feed.py --config feeds.json --out public/ --base-url https://example.org/aed-feeds

For each provider in the config it writes `<out>/<slug>/feed.xml`, `<out>/<slug>/feed.md5` (the portal requires an
MD5 file next to the feed) and a copy of each CSV file. Publish the folder on any HTTPS host; the provider registers
`<base-url>/<slug>/feed.xml` once as a data source in the dane.gov.pl admin panel, and the portal harvests it on
schedule. No more uploading by hand.

The dataset carries `<dataStandard code=".." version=".."/>`, so the portal checks every file against the standard and
publishes only files that conform. File URLs end with `?v=<content hash>`: the portal downloads a file again only when
its URL changes, so a changed file gets a new URL and the next harvest picks it up.

Standard library only.
"""

import argparse
import hashlib
import json
import shutil
import sys
from datetime import date
from pathlib import Path
from xml.etree import ElementTree as ET

XSD_VERSION = "1.14"
NS = f"urn:otwarte-dane:harvester:{XSD_VERSION}"


def _text(parent, tag, value):
    element = ET.SubElement(parent, tag)
    element.text = str(value)
    return element


def _bilingual(parent, tag, polish, english=None):
    element = ET.SubElement(parent, tag)
    _text(element, "polish", polish)
    if english:
        _text(element, "english", english)
    return element


def file_version(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def build_feed(feed: dict, standard: dict, base_url: str, config_dir: Path, out_dir: Path) -> ET.Element:
    root = ET.Element(f"{{{NS}}}datasets")
    meta = feed["dataset"]
    dataset = ET.SubElement(root, "dataset", status=meta.get("status", "published"))
    _text(dataset, "extIdent", meta["ext_ident"])
    if meta.get("int_ident"):  # take over a dataset the provider created by hand in the portal
        _text(dataset, "intIdent", meta["int_ident"])
    _bilingual(dataset, "title", meta["title_pl"], meta.get("title_en"))
    _bilingual(dataset, "description", meta["description_pl"], meta.get("description_en"))
    if meta.get("url"):
        _text(dataset, "url", meta["url"])
    _text(dataset, "updateFrequency", meta.get("update_frequency", "irregular"))
    categories = ET.SubElement(dataset, "categories")
    for code in meta.get("categories", ["HEAL"]):
        _text(categories, "category", code)
    if meta.get("license"):
        conditions = ET.SubElement(dataset, "conditions")
        _text(conditions, "dbOrCopyrighted", meta.get("license_condition", "Warunek wymagany"))
        _text(conditions, "dbOrCopyrightedLicenseChosen", meta["license"])

    resources = ET.SubElement(dataset, "resources")
    for res in feed["resources"]:
        source = (config_dir / res["file"]).resolve()
        name = f"{res['ext_ident']}.csv"
        shutil.copyfile(source, out_dir / name)
        resource = ET.SubElement(resources, "resource", status=res.get("status", "published"))
        _text(resource, "extIdent", res["ext_ident"])
        _text(resource, "url", f"{base_url}/{feed['slug']}/{name}?v={file_version(source)}")
        _bilingual(resource, "title", res["title_pl"], res.get("title_en"))
        _bilingual(resource, "description", res["description_pl"], res.get("description_en"))
        _text(resource, "availability", "local")
        _text(resource, "dataDate", res.get("data_date", date.today().isoformat()))
        if res.get("special_signs"):
            signs = ET.SubElement(resource, "specialSigns")
            for sign in res["special_signs"]:
                _text(signs, "specialSign", sign)

    tags = ET.SubElement(dataset, "tags")
    for tag in meta.get("tags", ["AED", "defibrylator"]):
        ET.SubElement(tags, "tag", lang="pl").text = tag
    ET.SubElement(dataset, "dataStandard", code=standard["code"], version=standard["version"])
    return root


def write_feed(feed: dict, standard: dict, base_url: str, config_dir: Path, out: Path) -> Path:
    out_dir = out / feed["slug"]
    out_dir.mkdir(parents=True, exist_ok=True)
    root = build_feed(feed, standard, base_url, config_dir, out_dir)
    ET.register_namespace("od", NS)
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    xml_path = out_dir / "feed.xml"
    tree.write(xml_path, encoding="UTF-8", xml_declaration=True)
    (out_dir / "feed.md5").write_text(hashlib.md5(xml_path.read_bytes()).hexdigest() + "\n", encoding="ascii")
    return xml_path


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--config", required=True, type=Path, help="feeds config (JSON)")
    parser.add_argument("--out", required=True, type=Path, help="output folder to publish over HTTPS")
    parser.add_argument("--base-url", required=True, help="HTTPS URL where the output folder is published")
    parser.add_argument("--only", help="comma-separated provider slugs (default: all)")
    args = parser.parse_args(argv)

    if not args.base_url.startswith("https://"):
        parser.error("the portal only accepts https:// URLs")
    config = json.loads(args.config.read_text(encoding="utf-8"))
    only = {s.strip() for s in args.only.split(",")} if args.only else None
    for feed in config["feeds"]:
        if only and feed["slug"] not in only:
            continue
        path = write_feed(feed, config["standard"], args.base_url.rstrip("/"), args.config.parent, args.out)
        print(f"{feed['slug']}: {path} -> {args.base_url.rstrip('/')}/{feed['slug']}/feed.xml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
