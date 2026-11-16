import asyncio
import copy
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.core import unlock as unlock_module
from app.core.security import crypto_service
from app.models import ExchangeRingHandshake, User
from app.services.seeder import seed_initial_gifts
from tests.conftest import ADMIN_HEADERS, GIFT_PAYLOAD, session_headers


@pytest.fixture()
def unlocked(monkeypatch):
    monkeypatch.setattr(unlock_module, "UNLOCK_TIMESTAMP", datetime(2020, 1, 1, tzinfo=timezone.utc))


@pytest.fixture()
def locked(monkeypatch):
    monkeypatch.setattr(unlock_module, "UNLOCK_TIMESTAMP", datetime(2099, 1, 1, tzinfo=timezone.utc))


async def _create_masters(client, count: int) -> dict[str, dict]:
    """Создаёт настоящих мастеров через API. Возвращает {user_id: headers}."""
    masters: dict[str, dict] = {}
    for i in range(count):
        payload = copy.deepcopy(GIFT_PAYLOAD)
        payload["card"]["author_display_name"] = f"Мастер {i}"
        payload["card"]["city"] = f"Город {i}"
        payload["card"]["contact_handle"] = f"@master_{i:03d}"
        headers = session_headers(f"m{i}")
        response = await client.post("/api/gifts", json=payload, headers=headers)
        assert response.status_code == 201, response.text
        masters[response.json()["my_user_id"]] = headers
    return masters


async def _match_ring(client):
    response = await client.post("/api/ring/match", headers=ADMIN_HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


async def test_ring_status_shape(client, unlocked):
    response = await client.get("/api/ring/status")
    assert response.status_code == 200
    body = response.json()
    assert body["cycle_year"] == 2026
    assert body["handshakes"] == 0
    assert body["formed"] is False
    assert body["unlocked"] is True
    assert body["unlock_at"].startswith("2020-01-01")
    assert "server_time" in body


async def test_match_requires_admin(client, locked):
    await _create_masters(client, 3)
    assert (await client.post("/api/ring/match")).status_code == 403
    assert (await client.post("/api/ring/match", headers={"X-Admin-Token": "wrong"})).status_code == 403


async def test_match_ring_creates_handshakes(client, db_session, locked):
    masters = await _create_masters(client, 4)
    result = await _match_ring(client)
    assert result == {"cycle_year": 2026, "created": 4, "participants": 4}

    handshakes = (await db_session.execute(select(ExchangeRingHandshake))).scalars().all()
    assert {hs.giver_user_id for hs in handshakes} == set(masters)
    assert all(hs.giver_user_id != hs.receiver_user_id for hs in handshakes)
    assert all(not hs.giver_consent and not hs.receiver_consent for hs in handshakes)

    status = (await client.get("/api/ring/status")).json()
    assert status["formed"] is True and status["participants"] == 4


async def test_demo_masters_excluded_from_ring(client, db_session, locked):
    await seed_initial_gifts(db_session, target_count=5)
    masters = await _create_masters(client, 2)
    result = await _match_ring(client)
    assert result["participants"] == 2, "демо-мастера не должны попадать в Кольцо"
    handshakes = (await db_session.execute(select(ExchangeRingHandshake))).scalars().all()
    assert {hs.giver_user_id for hs in handshakes} == set(masters)


async def test_seed_does_not_create_ring(client, db_session):
    await seed_initial_gifts(db_session, target_count=5)
    handshakes = (await db_session.execute(select(ExchangeRingHandshake))).scalars().all()
    assert handshakes == []
    users = (await db_session.execute(select(User))).scalars().all()
    assert users and all(u.is_demo for u in users)
    assert all(u.session_fingerprint.startswith("h1:") for u in users)


async def test_match_ring_conflict(client, locked):
    await _create_masters(client, 3)
    await _match_ring(client)
    again = await client.post("/api/ring/match", headers=ADMIN_HEADERS)
    assert again.status_code == 409


async def test_late_joiner_inserted_before_midnight(client, db_session, locked):
    await _create_masters(client, 3)
    await _match_ring(client)
    late = await _create_masters_with_prefix(client, "late", 1)
    late_id = next(iter(late))

    handshakes = (await db_session.execute(select(ExchangeRingHandshake))).scalars().all()
    assert len(handshakes) == 4
    givers = [hs.giver_user_id for hs in handshakes]
    receivers = [hs.receiver_user_id for hs in handshakes]
    assert sorted(givers) == sorted(receivers), "каждый дарит и получает ровно один раз"
    assert late_id in givers and late_id in receivers
    # кольцо остаётся единым циклом
    nxt = {hs.giver_user_id: hs.receiver_user_id for hs in handshakes}
    cur, seen = late_id, set()
    for _ in range(len(nxt)):
        seen.add(cur)
        cur = nxt[cur]
    assert cur == late_id and len(seen) == 4


async def _create_masters_with_prefix(client, prefix: str, count: int) -> dict[str, dict]:
    masters = {}
    for i in range(count):
        headers = session_headers(f"{prefix}{i}")
        response = await client.post("/api/gifts", json=copy.deepcopy(GIFT_PAYLOAD), headers=headers)
        assert response.status_code == 201, response.text
        masters[response.json()["my_user_id"]] = headers
    return masters


async def test_my_ring_locked_before_midnight(client, locked):
    masters = await _create_masters(client, 3)
    await _match_ring(client)
    headers = next(iter(masters.values()))
    response = await client.get("/api/handshakes/my-ring", headers=headers)
    assert response.status_code == 403
    assert "Новогоднюю полночь" in response.json()["detail"]


async def test_my_ring_empty_for_unknown_session(client, unlocked):
    response = await client.get("/api/handshakes/my-ring", headers=session_headers("nobody"))
    assert response.status_code == 200
    assert response.json() == []


async def test_old_user_id_endpoints_removed(client, unlocked):
    # Раньше достаточно было знать user_id из публичной витрины — больше нельзя.
    assert (await client.get("/api/handshakes/my-ring/some-user-id")).status_code == 404


async def test_consent_flow_and_contact_unlock(client, db_session, monkeypatch, locked):
    masters = await _create_masters(client, 4)
    await _match_ring(client)
    monkeypatch.setattr(unlock_module, "UNLOCK_TIMESTAMP", datetime(2020, 1, 1, tzinfo=timezone.utc))

    hs = (await db_session.execute(select(ExchangeRingHandshake))).scalars().first()
    giver_h, receiver_h = masters[hs.giver_user_id], masters[hs.receiver_user_id]

    broadcast_calls = []

    async def fake_broadcast(event_type, payload):
        broadcast_calls.append((event_type, payload))

    monkeypatch.setattr("app.routers.handshakes.ws_manager.broadcast_event", fake_broadcast)

    giver_cards = (await client.get("/api/handshakes/my-ring", headers=giver_h)).json()
    assert len(giver_cards) == 2
    assert {card["role"] for card in giver_cards} == {"MY_RECIPIENT", "MY_SECRET_SANTA"}
    for card in giver_cards:
        assert card["mutual_unlocked"] is False
        assert card["partner_decrypted_contact"] is None
        assert card["gift_details"]["secret_wish"]

    my_recipient_card = next(c for c in giver_cards if c["role"] == "MY_RECIPIENT")
    assert my_recipient_card["handshake_id"] == hs.id

    after_first = (await client.post(f"/api/handshakes/{hs.id}/consent", headers=giver_h)).json()
    assert after_first["my_consent"] is True
    assert after_first["partner_consent"] is False
    assert after_first["partner_decrypted_contact"] is None
    await asyncio.sleep(0.01)
    assert broadcast_calls == []

    after_second = (await client.post(f"/api/handshakes/{hs.id}/consent", headers=receiver_h)).json()
    assert after_second["mutual_unlocked"] is True

    giver = await db_session.get(User, hs.giver_user_id)
    receiver = await db_session.get(User, hs.receiver_user_id)
    assert after_second["partner_decrypted_contact"] == crypto_service.decrypt_contact(giver.encrypted_contact)
    assert after_second["partner_decrypted_contact"].startswith("@master_")
    assert after_second["partner_contact_type"] == "telegram"

    await asyncio.sleep(0.01)  # рассылка идёт фоновой задачей
    assert broadcast_calls == [
        ("CELESTIAL_OWL_FLIGHT", {"handshake_id": hs.id, "from_city": giver.city, "to_city": receiver.city})
    ]


async def test_consent_stranger_rejected(client, db_session, locked, monkeypatch):
    await _create_masters(client, 3)
    await _match_ring(client)
    monkeypatch.setattr(unlock_module, "UNLOCK_TIMESTAMP", datetime(2020, 1, 1, tzinfo=timezone.utc))
    # После полуночи опоздавшие в Кольцо уже не встраиваются.
    stranger = await _create_masters_with_prefix(client, "x", 1)
    stranger_headers = next(iter(stranger.values()))
    assert len((await db_session.execute(select(ExchangeRingHandshake))).scalars().all()) == 3

    hs = (await db_session.execute(select(ExchangeRingHandshake))).scalars().first()
    response = await client.post(f"/api/handshakes/{hs.id}/consent", headers=stranger_headers)
    assert response.status_code == 403

    no_user = await client.post(f"/api/handshakes/{hs.id}/consent", headers=session_headers("ghost"))
    assert no_user.status_code == 403
    assert (await client.get("/api/handshakes/my-ring", headers=stranger_headers)).json() == []


async def test_receiver_marks_handshake_unpacked(client, db_session, locked, monkeypatch):
    masters = await _create_masters(client, 3)
    await _match_ring(client)
    monkeypatch.setattr(unlock_module, "UNLOCK_TIMESTAMP", datetime(2020, 1, 1, tzinfo=timezone.utc))
    hs = (await db_session.execute(select(ExchangeRingHandshake))).scalars().first()

    await client.get("/api/handshakes/my-ring", headers=masters[hs.receiver_user_id])
    await db_session.refresh(hs)
    assert hs.is_unpacked is True

    hs.is_unpacked = False
    await db_session.commit()
    await client.get("/api/handshakes/my-ring", headers=masters[hs.giver_user_id])
    await db_session.refresh(hs)
    assert hs.is_unpacked is False


async def test_unreadable_contact_excluded_from_ring(client, db_session, locked):
    masters = await _create_masters(client, 3)
    broken_id = next(iter(masters))
    user = await db_session.get(User, broken_id)
    user.encrypted_contact = "gAAAA-not-a-valid-token"  # как контакт под утерянным ключом
    await db_session.commit()

    result = await _match_ring(client)
    assert result["participants"] == 2
    handshakes = (await db_session.execute(select(ExchangeRingHandshake))).scalars().all()
    assert broken_id not in {h.giver_user_id for h in handshakes} | {h.receiver_user_id for h in handshakes}
