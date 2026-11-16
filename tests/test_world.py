"""Карта мира, лидеры городов, ачивки и превью для мессенджеров."""

import copy

from app.core import config
from app.services.geo import city_coords, city_key
from tests.conftest import GIFT_PAYLOAD, session_headers


def _payload(city: str, title: str = "Шар"):
    p = copy.deepcopy(GIFT_PAYLOAD)
    p["card"]["city"] = city
    p["card"]["teaser_tag"] = title
    return p


def _set_day(monkeypatch, today: str, yesterday: str) -> None:
    monkeypatch.setattr(config, "candle_day", lambda now=None: today if now is None else yesterday)


def test_city_normalization():
    assert city_key("г. Москва") == "Москва"
    assert city_key("спб") == "Санкт-Петербург"
    assert city_key("ростов на дону") == "Ростов-на-Дону"
    assert city_coords("Орел")[2] == 3
    assert city_coords("Урюпинск") is None


async def test_world_map_aggregates_known_cities(client):
    for i, city in enumerate(["Москва", "москва", "Казань", "Урюпинск"]):
        res = await client.post("/api/gifts", json=_payload(city), headers=session_headers(f"m{i}"))
        assert res.status_code == 201
    from app.routers import world

    world._map_cache["data"] = None
    body = (await client.get("/api/world/map")).json()
    by = {c["city"]: c for c in body["cities"]}
    assert by["Москва"]["gifts"] == 2 and by["Казань"]["gifts"] == 1
    assert body["unplaced_gifts"] == 1


async def test_city_leaders_and_achievements(client, monkeypatch):
    _set_day(monkeypatch, "2030-01-01", "2029-12-31")
    a = (await client.post("/api/gifts", json=_payload("Казань", "Казанский"), headers=session_headers("ka"))).json()
    b = (await client.post("/api/gifts", json=_payload("Москва", "Московский"), headers=session_headers("mo"))).json()
    voter = session_headers("fan")
    await client.post(f"/api/gifts/{a['id']}/candle", headers=voter)
    await client.post(f"/api/gifts/{b['id']}/candle", headers=voter)
    await client.post(f"/api/gifts/{a['id']}/candle", headers=session_headers("fan2"))

    board = (await client.get("/api/world/city-leaders", params={"city": "казань"})).json()
    assert board["cities"][0]["city"] == "Казань" and board["cities"][0]["candles"] == 2
    assert board["my_city"]["today"]["gift_id"] == a["id"]

    ach = {i["id"]: i for i in (await client.get("/api/world/achievements", headers=voter)).json()["items"]}
    assert ach["generous"]["progress"] == 2 and not ach["generous"]["unlocked"]
    assert ach["time_zones"]["progress"] == 1  # Москва и Казань — один пояс

    # следующий день: вчерашний лидер получает «Шар дня» и «Звезду города»
    _set_day(monkeypatch, "2030-01-02", "2030-01-01")
    mine = {i["id"]: i for i in (await client.get("/api/world/achievements", headers=session_headers("ka"))).json()["items"]}
    assert mine["first_gift"]["unlocked"] and mine["first_candle"]["unlocked"]
    assert mine["ball_of_day"]["unlocked"] and mine["city_star"]["unlocked"]
    other = {i["id"]: i for i in (await client.get("/api/world/achievements", headers=session_headers("mo"))).json()["items"]}
    assert not other["ball_of_day"]["unlocked"] and other["city_star"]["unlocked"]


async def test_share_meta_and_png(client):
    gift = (await client.post("/api/gifts", json=_payload("Москва", "Огонёк"), headers=session_headers("s"))).json()
    png = await client.get(f"/api/share/gift/{gift['id']}.png")
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"
    assert png.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert (await client.get("/api/share/gift/00000000-0000-0000-0000-000000000000.png")).status_code == 404
    from app.routers.share import page_meta
    from starlette.requests import Request

    req = Request({"type": "http", "headers": [(b"host", b"elka.example")], "scheme": "https", "path": "/", "query_string": b""})
    tags, title = await page_meta(req, gift["id"])
    assert "«Огонёк»" in title
    assert f"https://elka.example/api/share/gift/{gift['id']}.png" in tags
    assert "зажги свечу" in tags
