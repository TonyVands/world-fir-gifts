"""Свечи дня: суточный запас, одна свеча на шар в сутки, лидеры и «Шар дня»."""

from datetime import datetime, timezone

from app.core import config
from tests.conftest import GIFT_PAYLOAD, session_headers

VOTER = session_headers("voter")


async def _make_gifts(client, n: int) -> list[str]:
    ids = []
    for i in range(n):
        res = await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=session_headers(f"author-{i}"))
        assert res.status_code == 201, res.text
        ids.append(res.json()["id"])
    return ids


def _set_day(monkeypatch, today: str, yesterday: str) -> None:
    def fake(now=None):
        return today if now is None else yesterday

    monkeypatch.setattr(config, "candle_day", fake)


async def test_status_without_session(client):
    res = await client.get("/api/gifts/candles/status")
    assert res.status_code == 200
    body = res.json()
    assert body["daily_limit"] == config.DAILY_CANDLES
    assert body["remaining_today"] == config.DAILY_CANDLES
    assert body["lit_today"] == []


async def test_daily_allowance_runs_out_and_refills(client, monkeypatch):
    _set_day(monkeypatch, "2030-01-01", "2029-12-31")
    ids = await _make_gifts(client, config.DAILY_CANDLES + 1)

    for i, gid in enumerate(ids[: config.DAILY_CANDLES]):
        res = await client.post(f"/api/gifts/{gid}/candle", headers=VOTER)
        assert res.status_code == 200, res.text
        assert res.headers["X-Candles-Remaining"] == str(config.DAILY_CANDLES - i - 1)

    over = await client.post(f"/api/gifts/{ids[-1]}/candle", headers=VOTER)
    assert over.status_code == 429
    assert "закончились" in over.json()["detail"]

    status = (await client.get("/api/gifts/candles/status", headers=VOTER)).json()
    assert status["remaining_today"] == 0
    assert set(status["lit_today"]) == set(ids[: config.DAILY_CANDLES])

    # Наступили новые сутки — запас пополнился, тот же шар снова можно поддержать.
    _set_day(monkeypatch, "2030-01-02", "2030-01-01")
    again = await client.post(f"/api/gifts/{ids[0]}/candle", headers=VOTER)
    assert again.status_code == 200
    assert again.json()["candles_count"] == 3  # 1 от автора + 2 дня поддержки


async def test_one_candle_per_gift_per_day(client, monkeypatch):
    _set_day(monkeypatch, "2030-01-01", "2029-12-31")
    (gid,) = await _make_gifts(client, 1)
    assert (await client.post(f"/api/gifts/{gid}/candle", headers=VOTER)).status_code == 200
    dup = await client.post(f"/api/gifts/{gid}/candle", headers=VOTER)
    assert dup.status_code == 409
    status = (await client.get("/api/gifts/candles/status", headers=VOTER)).json()
    assert status["remaining_today"] == config.DAILY_CANDLES - 1, "повтор не тратит свечу"


async def test_leaders_today_and_yesterday_winner(client, monkeypatch):
    _set_day(monkeypatch, "2030-01-01", "2029-12-31")
    a, b = await _make_gifts(client, 2)
    for v in ("v1", "v2"):
        await client.post(f"/api/gifts/{a}/candle", headers=session_headers(v))
    await client.post(f"/api/gifts/{b}/candle", headers=session_headers("v3"))

    board = (await client.get("/api/gifts/leaders")).json()
    assert board["day"] == "2030-01-01"
    assert [e["gift_id"] for e in board["today"]] == [a, b]
    assert board["today"][0]["candles"] == 2
    assert board["yesterday_winner"] is None

    _set_day(monkeypatch, "2030-01-02", "2030-01-01")
    board = (await client.get("/api/gifts/leaders")).json()
    assert board["today"] == []
    assert board["yesterday_winner"]["gift_id"] == a


def test_candle_day_is_moscow_time():
    # 21:30 UTC 31 декабря — это уже 1 января по Москве
    assert config.candle_day(datetime(2030, 12, 31, 21, 30, tzinfo=timezone.utc)) == "2031-01-01"
    resets = config.candle_day_resets_at(datetime(2030, 12, 31, 12, 0, tzinfo=timezone.utc))
    assert resets == datetime(2030, 12, 31, 21, 0, tzinfo=timezone.utc)
