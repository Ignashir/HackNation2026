import re
from dataclasses import dataclass

DAYS = {"Mo": 1, "Tu": 2, "We": 3, "Th": 4, "Fr": 5, "Sa": 6, "Su": 7}
PH = 8
WEEK = range(1, 8)

_TIME = r"(?:[01]\d|2[0-3]):[0-5]\d|24:00"
_SPAN = re.compile(rf"({_TIME})-({_TIME})")
_RULE = re.compile(rf"^(?P<days>.*?)\s*(?P<times>off|closed|(?:{_TIME})-(?:{_TIME})(?:\s*,\s*(?:{_TIME})-(?:{_TIME}))*)$")


@dataclass(frozen=True)
class Rule:
    weekday: int | None
    open_from: str
    open_to: str
    public_holiday: bool = False


@dataclass(frozen=True)
class Hours:
    is_24_7: bool
    rules: tuple[Rule, ...]


def parse_opening_hours(text: str) -> Hours | None:
    """Common subset of OSM opening_hours; None when the value is outside it."""
    text = text.strip()
    if text == "24/7":
        return Hours(True, ())

    schedule: dict[int, list[tuple[str, str]]] = {}
    for part in filter(None, (p.strip() for p in text.split(";"))):
        parsed = _parse_rule(part)
        if parsed is None:
            return None
        days, spans = parsed
        schedule.update({day: spans for day in days})

    if not schedule:
        return None
    if all(schedule.get(day) == [("00:00", "24:00")] for day in WEEK):
        return Hours(True, ())
    rules = tuple(
        Rule(None if day == PH else day, start, end, day == PH)
        for day in sorted(schedule)
        for start, end in schedule[day]
    )
    return Hours(False, rules)


def _parse_rule(part: str) -> tuple[list[int], list[tuple[str, str]]] | None:
    match = _RULE.match(part)
    if not match:
        return None
    days = _parse_days(match["days"])
    if days is None:
        return None
    if match["times"] in ("off", "closed"):
        return days, []
    spans = _SPAN.findall(match["times"])
    if any(start == end for start, end in spans):
        return None
    return days, spans


def _parse_days(selector: str) -> list[int] | None:
    if not selector:
        return list(WEEK)
    days: list[int] = []
    for token in (t.strip() for t in selector.split(",")):
        if token == "PH":
            days.append(PH)
        elif token in DAYS:
            days.append(DAYS[token])
        elif len(token) == 5 and token[2] == "-" and token[:2] in DAYS and token[3:] in DAYS:
            start, end = DAYS[token[:2]], DAYS[token[3:]]
            days.extend((start - 1 + i) % 7 + 1 for i in range((end - start) % 7 + 1))
        else:
            return None
    return days
