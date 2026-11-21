import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import requests

log = logging.getLogger(__name__)

USER_AGENT = "aed-poland-importer/0.1"
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


def user_agent() -> str:
    contact = os.environ.get("AED_IMPORT_CONTACT")
    return f"{USER_AGENT} ({contact})" if contact else USER_AGENT


@dataclass(frozen=True)
class Politeness:
    min_interval_s: float = 1.0
    timeout_s: float = 60.0
    max_retries: int = 4
    backoff_s: float = 5.0


class PoliteClient:
    def __init__(self, politeness: Politeness, user_agent: str,
                 session: requests.Session | None = None,
                 sleep=time.sleep, clock=time.monotonic):
        self.politeness = politeness
        self.session = session or requests.Session()
        self.session.headers["User-Agent"] = user_agent
        self._sleep = sleep
        self._clock = clock
        self._last_request_at: float | None = None

    def get(self, url: str, **kwargs) -> requests.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> requests.Response:
        return self.request("POST", url, **kwargs)

    def request(self, method: str, url: str, **kwargs) -> requests.Response:
        attempt = 0
        while True:
            self._wait_for_slot()
            try:
                response = self.session.request(method, url, timeout=self.politeness.timeout_s, **kwargs)
            except (requests.ConnectionError, requests.Timeout) as error:
                if attempt >= self.politeness.max_retries:
                    raise
                delay, reason = None, type(error).__name__
            else:
                if response.status_code not in RETRYABLE_STATUS or attempt >= self.politeness.max_retries:
                    response.raise_for_status()
                    return response
                delay, reason = _retry_after(response), f"HTTP {response.status_code}"
            delay = delay if delay is not None else self.politeness.backoff_s * 2 ** attempt
            log.warning("%s from %s, retrying in %.0f s", reason, url, delay)
            self._sleep(delay)
            attempt += 1

    def _wait_for_slot(self) -> None:
        if self._last_request_at is not None:
            remaining = self.politeness.min_interval_s - (self._clock() - self._last_request_at)
            if remaining > 0:
                self._sleep(remaining)
        self._last_request_at = self._clock()


def _retry_after(response: requests.Response) -> float | None:
    value = response.headers.get("Retry-After")
    if not value:
        return None
    if value.isdigit():
        return float(value)
    try:
        return max(0.0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
    except (TypeError, ValueError):
        return None
