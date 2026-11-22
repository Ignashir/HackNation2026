import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from itertools import batched
from uuid import UUID

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from .hours import parse_opening_hours
from .http import PoliteClient, user_agent
from .records import SOURCE_PRIORITY, Pull, SiteFields, Source, SourceRecord

log = logging.getLogger(__name__)

POINT = sql.SQL("ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography")
VALUE_WHEN_CLEARED = {"is_24_7": False}
POSITION = ("location", "position_accuracy_m")


class ImportRefused(RuntimeError):
    pass


@dataclass
class RunSummary:
    run_id: UUID
    status: str = "running"
    fetched: int = 0
    gone: int = 0
    outcomes: Counter = field(default_factory=Counter)


class SourceImporter:
    def __init__(self, conn: psycopg.Connection, source: Source, *,
                 http: PoliteClient | None = None, actor: str | None = None,
                 batch_size: int = 500, match_radius_m: float | None = None):
        if not conn.autocommit:
            raise ValueError("SourceImporter needs an autocommit connection; it manages its own transactions")
        self.conn = conn
        self.source = source
        self.http = http or PoliteClient(source.politeness, user_agent())
        self.actor = actor or f"ingest:{source.name.lower()}"
        self.batch_size = batch_size
        self.match_radius_m = match_radius_m or getattr(source, "match_radius_m", 30.0)
        self.priority = SOURCE_PRIORITY.get(source.name, 0)
        self.source_id, self.redistributable = self._load_source()

    def run(self, *, force: bool = False) -> RunSummary:
        self._lock()
        try:
            if not force:
                self._check_refresh_interval()
            return self._run()
        finally:
            self.conn.execute("SELECT pg_advisory_unlock(hashtext('aed_import'), %s)", (self.source_id,))

    def _run(self) -> RunSummary:
        summary = RunSummary(self._start_run())
        log.info("%s: run %s started", self.source.name, summary.run_id)
        pull: Pull | None = None
        try:
            pull = self.source.fetch(self.http)
            summary.fetched = len(pull.records)
            log.info("%s: fetched %d records", self.source.name, summary.fetched)
            records = self._closest_first(pull.records) if self.source.geocode_method == "address" else pull.records
            for batch in batched(records, self.batch_size):
                self._ingest_batch(batch, summary)
            summary.gone = self._count_gone(summary.run_id)
            summary.status = "partial" if summary.outcomes["failed"] else "success"
        except Exception:
            summary.status = "failed"
            log.error("%s: run %s failed", self.source.name, summary.run_id)
            raise
        finally:
            self._finish_run(summary, pull.data_as_of if pull else None)
            log.info("%s: run %s %s, fetched=%d %s gone=%d", self.source.name, summary.run_id,
                     summary.status, summary.fetched,
                     " ".join(f"{k}={v}" for k, v in sorted(summary.outcomes.items())), summary.gone)
        return summary

    # --- run bookkeeping -------------------------------------------------

    def _load_source(self) -> tuple[int, bool]:
        row = self.conn.execute("SELECT source_id, redistributable FROM data_source WHERE name = %s",
                                (self.source.name,)).fetchone()
        if row is None:
            raise LookupError(f"data_source {self.source.name!r} is not registered")
        return row

    def _lock(self) -> None:
        locked = self.conn.execute("SELECT pg_try_advisory_lock(hashtext('aed_import'), %s)",
                                   (self.source_id,)).fetchone()[0]
        if not locked:
            raise ImportRefused(f"{self.source.name}: another import is already running")

    def _check_refresh_interval(self) -> None:
        last = self.conn.execute(
            "SELECT max(started_at) FROM import_run WHERE source_id = %s AND status IN ('success', 'partial')",
            (self.source_id,)).fetchone()[0]
        if last and datetime.now(timezone.utc) - last < self.source.min_refresh:
            raise ImportRefused(f"{self.source.name}: last run at {last:%Y-%m-%d %H:%M %Z}, "
                                f"source allows one pull per {self.source.min_refresh}")

    def _start_run(self) -> UUID:
        return self.conn.execute("INSERT INTO import_run (source_id) VALUES (%s) RETURNING run_id",
                                 (self.source_id,)).fetchone()[0]

    def _finish_run(self, summary: RunSummary, data_as_of: datetime | None) -> None:
        self.conn.execute("UPDATE import_run SET status = %s, records_fetched = %s, data_as_of = %s WHERE run_id = %s",
                          (summary.status, summary.fetched, data_as_of, summary.run_id))

    def _count_gone(self, run_id: UUID) -> int:
        return self.conn.execute(
            """SELECT count(*) FROM source_record r JOIN import_run i ON i.source_id = r.source_id
               WHERE i.run_id = %s AND r.last_seen_at < i.started_at""", (run_id,)).fetchone()[0]

    # --- ingest ----------------------------------------------------------

    def _ingest_batch(self, batch: tuple[SourceRecord, ...], summary: RunSummary) -> None:
        with self.conn.transaction():
            self.conn.execute(
                """SELECT set_config('app.actor', %s, true),
                          set_config('app.import_run_id', %s, true),
                          set_config('app.change_reason', %s, true)""",
                (self.actor, str(summary.run_id), f"import from {self.source.name}"))
            for record in batch:
                try:
                    with self.conn.transaction():
                        summary.outcomes[self._ingest(record, summary.run_id)] += 1
                except psycopg.Error as error:
                    summary.outcomes["failed"] += 1
                    log.warning("%s: skipped %s: %s", self.source.name, record.external_id, error)

    def _ingest(self, record: SourceRecord, run_id: UUID) -> str:
        record_id, site_id = self._upsert_record(record, run_id)
        outcome = "known"
        if site_id is None:
            site_id, outcome = self._find_or_create_site(record_id, record)
        if site_id and record.site and self.redistributable:
            self._apply_fields(site_id, record_id, record.site)
        return outcome

    def _upsert_record(self, record: SourceRecord, run_id: UUID) -> tuple[UUID, UUID | None]:
        return self.conn.execute(
            """INSERT INTO source_record (source_id, run_id, external_id, external_version,
                                          raw_payload, source_modified_at)
               VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (source_id, external_id) DO UPDATE SET
                   run_id = EXCLUDED.run_id,
                   external_version = EXCLUDED.external_version,
                   raw_payload = EXCLUDED.raw_payload,
                   source_modified_at = EXCLUDED.source_modified_at,
                   last_seen_at = now()
               RETURNING source_record_id, site_id""",
            (self.source_id, run_id, record.external_id, record.version,
             Jsonb(record.payload), record.modified_at)).fetchone()

    # --- matching --------------------------------------------------------

    def _find_or_create_site(self, record_id: UUID, record: SourceRecord) -> tuple[UUID | None, str]:
        if match := self._linked_site(record) or self._nearby_site(record):
            site_id, method, distance = match
            outcome = "matched"
        elif record.site and self.source.creates_sites and self.redistributable:
            site_id, method, distance = self._create_site(record.site), "exact_id", None
            outcome = "created"
        else:
            return None, "unmatched"
        self.conn.execute(
            "UPDATE source_record SET site_id = %s, match_method = %s, match_distance_m = %s WHERE source_record_id = %s",
            (site_id, method, distance, record_id))
        return site_id, outcome

    def _linked_site(self, record: SourceRecord) -> tuple[UUID, str, None] | None:
        for source_name, external_id in record.links:
            row = self.conn.execute(
                """SELECT r.site_id FROM source_record r JOIN data_source d USING (source_id)
                   WHERE d.name = %s AND r.external_id = %s AND r.site_id IS NOT NULL""",
                (source_name, external_id)).fetchone()
            if row:
                return row[0], "exact_id", None
        for link in record.payload_links:
            row = self.conn.execute(
                """SELECT r.site_id FROM source_record r JOIN data_source d USING (source_id)
                   WHERE d.name = %s AND r.raw_payload @> %s AND r.site_id IS NOT NULL LIMIT 1""",
                (link.source, Jsonb(_nested(link.path, link.value)))).fetchone()
            if row:
                return row[0], "exact_id", None
        return None

    def _closest_first(self, records: list[SourceRecord]) -> list[SourceRecord]:
        """Geocoded positions are imprecise and matching is greedy: let the closest pairs match first, so a record
        51 m from an AED does not take the one that is 2 m from another record."""
        def distance(record: SourceRecord) -> float:
            match = self._nearby_site(record) if record.site else None
            return match[2] if match else float("inf")
        return sorted(records, key=distance)

    def _nearby_site(self, record: SourceRecord) -> tuple[UUID, str, float] | None:
        """Closest site within the radius that this source does not already describe."""
        if not record.site:
            return None
        row = self.conn.execute(
            sql.SQL("""SELECT s.site_id, ST_Distance(s.location, p.g)
                       FROM aed_site s, (SELECT {point} AS g) p
                       WHERE ST_DWithin(s.location, p.g, %s)
                         AND NOT EXISTS (SELECT 1 FROM source_record r
                                         WHERE r.site_id = s.site_id AND r.source_id = %s)
                         AND (%s::text IS NULL OR s.name IS NULL OR similarity(s.name, %s::text) >= 0.3)
                       ORDER BY 2 LIMIT 1""").format(point=POINT),
            (record.site.lon, record.site.lat, self.match_radius_m, self.source_id,
             record.site.name, record.site.name)).fetchone()
        return (row[0], "distance+name", row[1]) if row else None

    def _create_site(self, site: SiteFields) -> UUID:
        columns = {"geocode_method": self.source.geocode_method} | site.columns()
        return self.conn.execute(
            sql.SQL("INSERT INTO aed_site ({}) VALUES ({}) RETURNING site_id").format(
                sql.SQL(", ").join(map(sql.Identifier, columns)),
                sql.SQL(", ").join(_value_sql(c) for c in columns)),
            _params(columns)).fetchone()[0]

    # --- curated fields --------------------------------------------------

    def _apply_fields(self, site_id: UUID, record_id: UUID, site: SiteFields) -> None:
        rows = self.conn.execute(
            """SELECT fp.field_name, fp.source_record_id, d.name
               FROM field_provenance fp
               JOIN source_record sr ON sr.source_record_id = fp.source_record_id
               JOIN data_source d ON d.source_id = sr.source_id
               WHERE fp.site_id = %s""", (site_id,))
        owners = {column: (owner_record, owner_source) for column, owner_record, owner_source in rows}
        offered = site.columns()

        writes, rules = {}, {}
        for column, value in offered.items():
            owner_record, owner_source = owners.get(column, (None, None))
            owner_priority = SOURCE_PRIORITY.get(owner_source, 0)
            if owner_record in (None, record_id) or self.priority > owner_priority:
                writes[column], rules[column] = value, "priority"
            elif self.priority == owner_priority:
                writes[column], rules[column] = value, "newest"
        cleared = {column: VALUE_WHEN_CLEARED.get(column)
                   for column, (owner_record, _) in owners.items()
                   if owner_record == record_id and column not in offered}
        self._position_precedence(site_id, record_id, owners, offered, writes, rules, cleared)

        changes = writes | cleared

        hours_before = self.conn.execute("SELECT opening_hours_raw FROM aed_site WHERE site_id = %s",
                                         (site_id,)).fetchone()[0]
        self._update_site(site_id, changes)
        self._set_provenance(site_id, record_id, rules, cleared)

        if "opening_hours_raw" in changes:
            hours_owner = owners.get("opening_hours_raw", (None, None))[0]
            if hours_owner != record_id or changes["opening_hours_raw"] != hours_before:
                self._replace_availability(site_id, changes["opening_hours_raw"])

    def _position_precedence(self, site_id: UUID, record_id: UUID, owners: dict, offered: dict,
                             writes: dict, rules: dict, cleared: dict) -> None:
        """A surveyed position beats one geocoded from an address, whatever the source priority."""
        if owners.get("location", (None, None))[0] in (None, record_id):
            return
        site_geocoded = self.conn.execute("SELECT geocode_method FROM aed_site WHERE site_id = %s",
                                          (site_id,)).fetchone()[0] == "address"
        mine_geocoded = self.source.geocode_method == "address"
        if mine_geocoded and not site_geocoded:
            for column in POSITION:
                writes.pop(column, None)
                rules.pop(column, None)
        elif site_geocoded and not mine_geocoded:
            writes["location"], rules["location"] = offered["location"], "priority"
            writes["geocode_method"] = self.source.geocode_method   # site metadata, no provenance
            if "position_accuracy_m" in offered:
                writes["position_accuracy_m"], rules["position_accuracy_m"] = offered["position_accuracy_m"], "priority"
            elif "position_accuracy_m" in owners:
                cleared["position_accuracy_m"] = None

    def _update_site(self, site_id: UUID, values: dict[str, object]) -> None:
        if not values:
            return
        assignments = sql.SQL(", ").join(
            sql.SQL("{} = {}").format(sql.Identifier(column), _value_sql(column)) for column in values)
        self.conn.execute(sql.SQL("UPDATE aed_site SET {} WHERE site_id = %s").format(assignments),
                          [*_params(values), site_id])

    def _set_provenance(self, site_id: UUID, record_id: UUID, rules: dict[str, str], cleared: dict) -> None:
        with self.conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO field_provenance (site_id, field_name, source_record_id, rule)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (site_id, field_name) DO UPDATE
                       SET source_record_id = EXCLUDED.source_record_id, rule = EXCLUDED.rule, chosen_at = now()
                       WHERE (field_provenance.source_record_id, field_provenance.rule)
                             IS DISTINCT FROM (EXCLUDED.source_record_id, EXCLUDED.rule)""",
                [(site_id, column, record_id, rule) for column, rule in rules.items()])
            cur.executemany("DELETE FROM field_provenance WHERE site_id = %s AND field_name = %s",
                            [(site_id, column) for column in cleared])

    def _replace_availability(self, site_id: UUID, opening_hours: str | None) -> None:
        hours = parse_opening_hours(opening_hours) if opening_hours else None
        rules = hours.rules if hours else ()
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM availability_rule WHERE site_id = %s", (site_id,))
            cur.executemany(
                """INSERT INTO availability_rule (site_id, weekday, open_from, open_to, public_holiday)
                   VALUES (%s, %s, %s, %s, %s)""",
                [(site_id, r.weekday, r.open_from, r.open_to, r.public_holiday) for r in rules])


def _nested(path: tuple[str, ...], value: str) -> dict:
    document: object = value
    for key in reversed(path):
        document = {key: document}
    return document


def _value_sql(column: str) -> sql.Composable:
    return POINT if column == "location" else sql.Placeholder()


def _params(values: dict[str, object]) -> list:
    params: list = []
    for column, value in values.items():
        params.extend(value if column == "location" else (value,))
    return params
