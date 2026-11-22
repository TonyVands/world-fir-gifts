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
# Публичный адрес сайта для ссылок в превью и Telegram (иначе берётся из запроса).
PUBLIC_URL = os.getenv("PUBLIC_URL", "").strip()
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
# Telegram-бот для уведомлений (токен от @BotFather). Без токена всё работает,
# просто кнопка «Уведомления» сообщает, что бот не подключён.
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "").strip().lstrip("@")
# Чат модератора «Яруса памяти» (узнать id: написать боту /myid)
TELEGRAM_ADMIN_CHAT_ID = os.getenv("TELEGRAM_ADMIN_CHAT_ID", "").strip()
# Отпечатки памяти в Bitcoin через OpenTimestamps (бесплатно, без кошелька)
OTS_ENABLED = os.getenv("OTS_ENABLED", "1") == "1"
OTS_CALENDARS = [u.strip() for u in os.getenv("OTS_CALENDARS", "https://a.pool.opentimestamps.org,https://b.pool.opentimestamps.org,https://a.pool.eternitywall.com").split(",") if u.strip()]
MEMORIALS_PER_SESSION = int(os.getenv("MEMORIALS_PER_SESSION", "3"))
# Бот в мессенджере MAX (platform-api.max.ru): те же уведомления, что и в Telegram.
MAX_BOT_TOKEN = os.getenv("MAX_BOT_TOKEN", "").strip()
MAX_BOT_USERNAME = os.getenv("MAX_BOT_USERNAME", "").strip().lstrip("@")
MAX_API_BASE = os.getenv("MAX_API_BASE", "https://platform-api.max.ru").strip().rstrip("/")
# Свой шар можно переделать раз в N дней (0 — без ограничения).
GIFT_EDIT_COOLDOWN_DAYS = max(0, _env_int("GIFT_EDIT_COOLDOWN_DAYS", 5))

# --- Правовые документы (152-ФЗ) --------------------------------------------
# Оператор персональных данных — тот, кто ведёт проект. Задаётся переменными
# окружения; пока не задано, на страницах /legal видна заметная подсказка.
OPERATOR_NAME = os.getenv("OPERATOR_NAME", "").strip()
OPERATOR_STATUS = os.getenv("OPERATOR_STATUS", "").strip()  # «физическое лицо», «самозанятый», «ИП»
OPERATOR_INN = os.getenv("OPERATOR_INN", "").strip()
OPERATOR_EMAIL = os.getenv("OPERATOR_EMAIL", "").strip()
OPERATOR_ADDRESS = os.getenv("OPERATOR_ADDRESS", "").strip()
DATA_LOCATION = os.getenv("DATA_LOCATION", "").strip()  # «Российская Федерация, г. Москва»
# Версия документов: при изменении текста — новая дата, и пользователи дают согласие заново
LEGAL_VERSION = os.getenv("LEGAL_VERSION", "2026-11-21").strip()
# После этой даты контакты для обмена удаляются автоматически (сезон закончился)
PURGE_CONTACTS_AFTER = os.getenv("PURGE_CONTACTS_AFTER", "2027-03-31").strip()
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
