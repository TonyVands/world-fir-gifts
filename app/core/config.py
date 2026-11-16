"""Единая точка чтения настроек окружения (Amvera: раздел «Переменные»)."""

import os
from datetime import datetime, timedelta, timezone

from app.core.unlock import get_unlock_timestamp


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
IS_PRODUCTION = APP_ENV in ("prod", "production")

# Токен администратора (заголовок X-Admin-Token). Пусто — админ-ручки выключены.
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "").strip()

# Список разрешённых Origin через запятую. Пусто — CORS выключен
# (SPA отдаётся тем же FastAPI, кросс-доменные запросы не нужны).
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

DOCS_ENABLED = _env_bool("DOCS_ENABLED", not IS_PRODUCTION)
SECURITY_CSP = _env_bool("SECURITY_CSP", True)

# Лимиты (в минуту/час — см. app/core/ratelimit.py)
MAX_GIFTS_PER_USER = _env_int("MAX_GIFTS_PER_USER", 3)
# Свечи: каждый день у сессии DAILY_CANDLES огоньков, у одного шара — не больше
# одной свечи в день. День считается по Москве (UTC+3, без перехода на летнее).
DAILY_CANDLES = max(1, _env_int("DAILY_CANDLES", 3))
# Свой шар можно переделать раз в N дней (0 — без ограничения).
GIFT_EDIT_COOLDOWN_DAYS = max(0, _env_int("GIFT_EDIT_COOLDOWN_DAYS", 5))
CANDLE_DAY_TZ = timezone(timedelta(hours=_env_int("CANDLE_DAY_UTC_OFFSET_H", 3)))


def candle_day(now: datetime | None = None) -> str:
    """Текущие «свечные сутки» в виде YYYY-MM-DD."""
    return (now or datetime.now(timezone.utc)).astimezone(CANDLE_DAY_TZ).date().isoformat()


def candle_day_resets_at(now: datetime | None = None) -> datetime:
    """Момент (UTC), когда свечи пополнятся."""
    local = (now or datetime.now(timezone.utc)).astimezone(CANDLE_DAY_TZ)
    midnight = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(timezone.utc)
REPORT_QUARANTINE_THRESHOLD = _env_int("REPORT_QUARANTINE_THRESHOLD", 5)
WS_MAX_CONNECTIONS = _env_int("WS_MAX_CONNECTIONS", 5000)


def get_ring_match_at() -> datetime | None:
    """Когда автоматически сформировать Кольцо Чудес.

    RING_MATCH_AT=off — только вручную (POST /api/ring/match с X-Admin-Token).
    По умолчанию — за 15 минут до Новогодней полуночи, чтобы к моменту
    распаковки пары уже были готовы, а опоздавших было как можно меньше.
    """
    raw = os.getenv("RING_MATCH_AT", "").strip()
    if raw.lower() in ("off", "0", "false", "none", "disabled"):
        return None
    if raw:
        try:
            parsed = datetime.fromisoformat(raw)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            pass
    return get_unlock_timestamp() - timedelta(minutes=15)
