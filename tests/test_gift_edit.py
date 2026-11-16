"""Правка своего шара: только автор, раз в N дней, до открытия обмена."""

import copy
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core import config
from app.models import Gift
from tests.conftest import GIFT_PAYLOAD, session_headers

OWNER = session_headers("owner")
STRANGER = session_headers("stranger")


def _edited(title="Переделанный шар"):
    payload = copy.deepcopy(GIFT_PAYLOAD)
    payload["card"]["teaser_tag"] = title
    payload["card"]["contact_handle"] = ""
    payload["melody"]["voices"] = {"celesta": "piano", "cello": "choir"}
    return payload


async def _create(client):
    res = await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=OWNER)
    assert res.status_code == 201, res.text
    return res.json()


async def test_owner_reads_full_gift(client):
    gift = await _create(client)
    mine = await client.get(f"/api/gifts/{gift['id']}/mine", headers=OWNER)
    assert mine.status_code == 200
    body = mine.json()
    assert body["secret_wish"] == GIFT_PAYLOAD["card"]["secret_wish"]
    assert body["can_edit"] is True
    assert (await client.get(f"/api/gifts/{gift['id']}/mine", headers=STRANGER)).status_code == 403


async def test_edit_keeps_candles_and_applies_cooldown(client, db_session):
    gift = await _create(client)
    await client.post(f"/api/gifts/{gift['id']}/candle", headers=STRANGER)

    res = await client.put(f"/api/gifts/{gift['id']}", json=_edited(), headers=OWNER)
    assert res.status_code == 200, res.text
    dto = res.json()
    assert dto["card_preview"]["teaser_tag"] == "Переделанный шар"
    assert dto["candles_count"] == 2, "свечи при правке сохраняются"
    assert dto["melody"]["voices"] == {"celesta": "piano", "cello": "choir"}

    again = await client.put(f"/api/gifts/{gift['id']}", json=_edited("Ещё раз"), headers=OWNER)
    assert again.status_code == 429
    mine = (await client.get(f"/api/gifts/{gift['id']}/mine", headers=OWNER)).json()
    assert mine["can_edit"] is False and mine["next_edit_at"]

    # прошло больше N дней — снова можно
    row = (await db_session.execute(select(Gift).where(Gift.id == gift["id"]))).scalar_one()
    row.edited_at = datetime.now(timezone.utc) - timedelta(days=config.GIFT_EDIT_COOLDOWN_DAYS, minutes=1)
    await db_session.commit()
    ok = await client.put(f"/api/gifts/{gift['id']}", json=_edited("Ещё раз"), headers=OWNER)
    assert ok.status_code == 200, ok.text


async def test_stranger_cannot_edit_and_moderation_applies(client):
    gift = await _create(client)
    assert (await client.put(f"/api/gifts/{gift['id']}", json=_edited(), headers=STRANGER)).status_code == 403
    bad = _edited()
    bad["card"]["teaser_tag"] = "пиши в t.me/spam_channel"
    assert (await client.put(f"/api/gifts/{gift['id']}", json=bad, headers=OWNER)).status_code == 422


async def test_unknown_voice_rejected(client):
    payload = copy.deepcopy(GIFT_PAYLOAD)
    payload["melody"]["voices"] = {"celesta": "kazoo"}
    res = await client.post("/api/gifts", json=payload, headers=OWNER)
    assert res.status_code == 422


async def test_edit_blocked_after_unlock(client, monkeypatch):
    gift = await _create(client)
    import app.routers.gifts as gifts_router

    monkeypatch.setattr(gifts_router, "is_new_year_unlocked", lambda now=None: True)
    res = await client.put(f"/api/gifts/{gift['id']}", json=_edited(), headers=OWNER)
    assert res.status_code == 409
