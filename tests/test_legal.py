"""Согласия (152-ФЗ), правовые страницы, удаление данных и счётчик Ёлки."""

import copy

from tests.conftest import GIFT_PAYLOAD, session_headers


async def test_gift_requires_all_three_consents(client):
    for missing in ("pd_consent", "publish_consent", "terms_accepted"):
        p = copy.deepcopy(GIFT_PAYLOAD)
        p[missing] = False
        res = await client.post("/api/gifts", json=p, headers=session_headers("noconsent"))
        assert res.status_code == 422, missing
    ok = await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=session_headers("noconsent"))
    assert ok.status_code in (200, 201)


async def test_legal_pages_render(client):
    for path in ("/legal", "/legal/privacy", "/legal/consent", "/legal/publish", "/legal/terms"):
        res = await client.get(path)
        assert res.status_code == 200, path
        assert "text/html" in res.headers["content-type"]
        assert "Ёлк" in res.text
    sec = await client.get("/.well-known/security.txt")
    assert sec.status_code == 200 and "Contact:" in sec.text


async def test_delete_my_data(client):
    me = session_headers("deleter")
    other = session_headers("voter")
    gid = (await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=me)).json()["id"]
    await client.post(f"/api/gifts/{gid}/candle", headers=other)

    res = await client.delete("/api/users/me", headers=me)
    assert res.status_code == 200
    assert (await client.get(f"/api/gifts/{gid}")).status_code == 404
    # Повторное удаление — не ошибка
    assert (await client.delete("/api/users/me", headers=me)).status_code == 200


async def test_world_stats_counts(client):
    before = (await client.get("/api/world/stats")).json()
    gid = (await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=session_headers("st-a"))).json()["id"]
    await client.post(f"/api/gifts/{gid}/candle", headers=session_headers("st-b"))
    from app.routers import world

    world._stats_cache.update(at=0.0, data=None)
    after = (await client.get("/api/world/stats")).json()
    assert after["today"]["gifts"] == before["today"]["gifts"] + 1
    assert after["today"]["candles"] >= before["today"]["candles"] + 1
    assert after["total"]["gifts"] >= after["week"]["gifts"] >= after["today"]["gifts"]
