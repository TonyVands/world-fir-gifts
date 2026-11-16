"""Telegram: привязка по коду, команды бота, плановые рассылки (без сети)."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core import config
from app.core.unlock import get_unlock_timestamp
from app.models import CandleLight, Gift, TelegramLink, User
from app.services import telegram
from tests.conftest import GIFT_PAYLOAD, session_headers


async def test_status_disabled_without_token(client):
    body = (await client.get("/api/telegram/status")).json()
    assert body["enabled"] is False and body["linked"] is False
    assert (await client.post("/api/telegram/link", headers=session_headers("x"))).status_code == 503


async def test_link_flow_and_commands(client, db_session, monkeypatch):
    sent: list[tuple[str, str]] = []

    async def fake_send(chat_id, text):
        sent.append((chat_id, text))
        return True

    monkeypatch.setattr(telegram, "send_message", fake_send)
    monkeypatch.setattr(config, "TELEGRAM_BOT_TOKEN", "test")
    monkeypatch.setattr(telegram, "_bot_username", "elka_test_bot")

    owner = session_headers("tg-owner")
    assert (await client.post("/api/telegram/link", headers=owner)).status_code == 409  # нет шара
    gift = (await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=owner)).json()
    res = await client.post("/api/telegram/link", headers=owner)
    assert res.status_code == 200
    url = res.json()["url"]
    assert url.startswith("https://t.me/elka_test_bot?start=")
    code = url.split("start=")[1]

    reply = await telegram.handle_update(db_session, {"message": {"chat": {"id": 777}, "text": f"/start {code}"}})
    assert "Готово" in reply
    assert (await client.get("/api/telegram/status", headers=owner)).json()["linked"] is True
    # повтор кода не работает
    again = await telegram.handle_update(db_session, {"message": {"chat": {"id": 777}, "text": f"/start {code}"}})
    assert "устарела" in again

    # рубеж свечей → уведомление автору
    telegram.bind_session_factory(lambda: _ctx(db_session))
    await client.post(f"/api/gifts/{gift['id']}/candle", headers=session_headers("fan"))
    await telegram.notify_candle(gift["id"])
    assert any("первую свечу" in t for _, t in sent)

    stop = await telegram.handle_update(db_session, {"message": {"chat": {"id": 777}, "text": "/stop"}})
    assert "отключены" in stop
    assert (await db_session.execute(select(TelegramLink))).first() is None


class _ctx:
    def __init__(self, s):
        self.s = s

    async def __aenter__(self):
        return self.s

    async def __aexit__(self, *a):
        return False


async def test_daily_and_ring_jobs(client, db_session, monkeypatch):
    sent: list[tuple[str, str]] = []

    async def fake_send(chat_id, text):
        sent.append((chat_id, text))
        return True

    monkeypatch.setattr(telegram, "send_message", fake_send)
    owner = session_headers("daily")
    gift = (await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=owner)).json()
    user = (await db_session.execute(select(User).where(User.id == gift["my_user_id"]))).scalar_one()
    db_session.add(TelegramLink(user_id=user.id, chat_id="42"))
    yesterday = config.candle_day(datetime.now(timezone.utc) - timedelta(days=1))
    db_session.add(CandleLight(gift_id=gift["id"], voter_hash="h1:x", day=yesterday))
    await db_session.commit()

    done = await telegram.run_daily_and_ring_jobs(db_session)
    assert f"ball_of_day:{yesterday}" in done
    assert any("Шаром дня" in t for _, t in sent)
    assert await telegram.run_daily_and_ring_jobs(db_session) == []  # без повторов

    unlock = get_unlock_timestamp()
    done = await telegram.run_daily_and_ring_jobs(db_session, now=unlock - timedelta(minutes=59))
    assert any(k.startswith("ring_1h") for k in done)
    assert any("остался час" in t for _, t in sent)
