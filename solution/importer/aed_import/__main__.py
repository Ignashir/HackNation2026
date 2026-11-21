import argparse
import logging
import os
import sys

import psycopg
from dotenv import find_dotenv, load_dotenv

from . import SOURCES, ImportRefused, SourceImporter

log = logging.getLogger("aed_import")


def main(argv: list[str] | None = None) -> int:
    load_dotenv(find_dotenv(usecwd=True))
    parser = argparse.ArgumentParser(prog="python -m aed_import", description="Pull AED records into the database.")
    parser.add_argument("source", choices=SOURCES, help="data_source.name to pull from")
    parser.add_argument("--dsn", default=os.environ.get("AED_DSN"), help="PostgreSQL DSN (default: $AED_DSN)")
    parser.add_argument("--force", action="store_true", help="ignore the source's minimum refresh interval")
    args = parser.parse_args(argv)
    if not args.dsn:
        parser.error("no database: pass --dsn or set AED_DSN")
    try:
        source = SOURCES[args.source]()
    except ValueError as error:
        parser.error(str(error))

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    with psycopg.connect(args.dsn, autocommit=True) as conn:
        try:
            summary = SourceImporter(conn, source).run(force=args.force)
        except ImportRefused as refused:
            log.error("%s", refused)
            return 2
    return 0 if summary.status == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
