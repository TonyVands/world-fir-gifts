import os
from datetime import datetime, timezone

DEFAULT_UNLOCK_ISO = "2026-12-31T23:59:59+00:00"


def _parse_unlock_timestamp() -> datetime:
    raw = os.getenv("NEW_YEAR_UNLOCK_AT", DEFAULT_UNLOCK_ISO).strip()
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        parsed = datetime.fromisoformat(DEFAULT_UNLOCK_ISO)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


UNLOCK_TIMESTAMP: datetime = _parse_unlock_timestamp()


def get_unlock_timestamp() -> datetime:
    return UNLOCK_TIMESTAMP


def is_new_year_unlocked(now: datetime | None = None) -> bool:
    current = now or datetime.now(timezone.utc)
    return current >= get_unlock_timestamp()
