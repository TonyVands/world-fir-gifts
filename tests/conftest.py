import os
import pathlib

TEST_DB_PATH = pathlib.Path(__file__).resolve().parent / "_test_world_fir.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DB_PATH}"
os.environ["CONTACT_ENCRYPTION_SECRET"] = "unit-test-secret"
os.environ["CONTACT_ENCRYPTION_SALT"] = "unit-test-salt"
os.environ["SEED_ON_START"] = "0"
os.environ["RATE_LIMIT_ENABLED"] = "0"
os.environ["RING_MATCH_AT"] = "off"
os.environ["ADMIN_TOKEN"] = "test-admin-token"

import httpx  # noqa: E402
import pytest_asyncio  # noqa: E402

from app.database import AsyncSessionLocal, Base, engine  # noqa: E402

ADMIN_HEADERS = {"X-Admin-Token": "test-admin-token"}


def session_headers(name: str = "1") -> dict:
    """Сессионный токен тестового браузера (формат как у фронтенда)."""
    return {"X-Session-Token": f"wfg2-test-session-token-{name:0>8}"}


GIFT_PAYLOAD = {
    "snowglobe": {
        "sculpture_id": "cottage",
        "base_material": "mahogany",
        "glitter_color": "#fde047",
        "custom_craft_title": "Зимняя диорама",
        "engraving_text": "Ручная работа • 2026",
        "voxels": [
            {"x": 3, "y": 0, "z": 3, "color": "#92400e"},
            {"x": 4, "y": 0, "z": 3, "color": "#92400e"},
            {"x": 3, "y": 1, "z": 4, "color": "#059669"},
            {"x": 4, "y": 1, "z": 4, "color": "#059669"},
            {"x": 3, "y": 2, "z": 3, "color": "#fbbf24"},
        ],
    },
    "packaging": {
        "box_shape": "cube",
        "paper_pattern": "nordic_knit",
        "ribbon_color": "#fbbf24",
        "wax_seal_stamp": "owl",
    },
    "melody": {
        "tempo_bpm": 104,
        "celesta_track": [7, 9, 10, 13, 12, 10, 9, 7, 8, 10, 11, 14, 13, 10, 9, 7],
        "harp_track": [1, 4, 5, 7, 5, 4, 3, 1, 2, 4, 5, 8, 7, 5, 4, 1],
        "cello_track": [1, 0, 0, 0, 4, 0, 0, 0, 2, 0, 0, 0, 5, 0, 1, 0],
        "flute_track": [0, 10, 0, 13, 0, 12, 0, 9, 0, 11, 0, 14, 0, 13, 10, 0],
        "drum_track": [1, 4, 5, 4, 2, 4, 5, 4, 1, 4, 5, 4, 2, 4, 6, 4],
    },
    "card": {
        "teaser_tag": "Тёплый маяк Севера",
        "secret_wish": "С Новым годом! Пусть все замыслы исполняются с первой попытки, а дома ждёт уют и чай.",
        "author_display_name": "Тестовый Мастер",
        "city": "Мирный",
        "totem_pet": "Полярная сова",
        "contact_handle": "@test_keeper",
    },
    "pd_consent": True,
    "publish_consent": True,
    "terms_accepted": True,
}

PHALLIC_VOXELS = [
    {"x": 2, "y": 0, "z": 3, "color": "#92400e"},
    {"x": 3, "y": 0, "z": 3, "color": "#92400e"},
    {"x": 4, "y": 0, "z": 3, "color": "#92400e"},
    {"x": 5, "y": 0, "z": 3, "color": "#92400e"},
    {"x": 3, "y": 1, "z": 3, "color": "#92400e"},
    {"x": 3, "y": 2, "z": 3, "color": "#059669"},
    {"x": 3, "y": 3, "z": 3, "color": "#059669"},
    {"x": 3, "y": 4, "z": 3, "color": "#059669"},
    {"x": 3, "y": 5, "z": 3, "color": "#fbbf24"},
]


@pytest_asyncio.fixture(autouse=True)
async def fresh_db():
    from app.core import ratelimit
    from app.routers.gifts import invalidate_showcase

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    invalidate_showcase()
    ratelimit.reset()
    yield


@pytest_asyncio.fixture()
async def db_session():
    async with AsyncSessionLocal() as session:
        yield session


@pytest_asyncio.fixture()
async def client():
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as test_client:
        yield test_client
