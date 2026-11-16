import copy

from sqlalchemy import select

from app.models import Gift, User
from tests.conftest import ADMIN_HEADERS, GIFT_PAYLOAD, PHALLIC_VOXELS, session_headers

H1 = session_headers("1")
H2 = session_headers("2")


def _payload(**card_overrides) -> dict:
    payload = copy.deepcopy(GIFT_PAYLOAD)
    payload["card"].update(card_overrides)
    return payload


async def test_health(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_create_gift_and_list(client):
    empty = await client.get("/api/gifts")
    assert empty.status_code == 200
    assert empty.json() == []

    created = await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=H1)
    assert created.status_code == 201, created.text
    dto = created.json()

    assert dto["created_order"] == 0
    coords = dto["coordinates"]
    assert coords["sequence_number"] == 0
    assert coords["tier_index"] == 0
    assert dto["card_preview"] == {
        "teaser_tag": "Тёплый маяк Севера",
        "author_display_name": "Тестовый Мастер",
        "city": "Мирный",
        "totem_pet": "Полярная сова",
    }
    assert dto["wish_char_count"] == len(GIFT_PAYLOAD["card"]["secret_wish"])
    assert "secret_wish" not in dto, "тайное пожелание не должно уходить в витрину"
    assert dto["genome_hash"].startswith("0x") and len(dto["genome_hash"]) == 18
    assert dto["quality_score"] > 0
    assert dto["candles_count"] == 1
    assert dto["my_user_id"], "автор получает свой user_id в ответе на создание"

    listed = (await client.get("/api/gifts")).json()
    assert [g["id"] for g in listed] == [dto["id"]]
    assert "author_id" not in listed[0], "внутренний id автора не должен светиться публично"
    assert "my_user_id" not in listed[0]


async def test_create_requires_session(client):
    response = await client.post("/api/gifts", json=GIFT_PAYLOAD)
    assert response.status_code == 401
    weak = await client.post("/api/gifts", json=GIFT_PAYLOAD, headers={"X-Session-Token": "keeper-anonymous"})
    assert weak.status_code == 401


async def test_showcase_etag_304(client):
    await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=H1)
    first = await client.get("/api/gifts")
    etag = first.headers["etag"]
    second = await client.get("/api/gifts", headers={"If-None-Match": etag})
    assert second.status_code == 304
    # после изменения витрины ETag меняется
    await client.post("/api/gifts", json=_payload(teaser_tag="Второй"), headers=H2)
    third = await client.get("/api/gifts", headers={"If-None-Match": etag})
    assert third.status_code == 200
    assert len(third.json()) == 2


async def test_sequence_number_grows(client):
    first = (await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=H1)).json()
    second = (await client.post("/api/gifts", json=_payload(teaser_tag="Второй шар"), headers=H2)).json()
    assert first["created_order"] == 0
    assert second["created_order"] == 1


async def test_gifts_sorted_by_quality_desc(client):
    rich = _payload(
        secret_wish=(
            "Дорогой друг! Пусть свет звёзд хранит тепло, уют и радость в каждом дне твоей жизни. "
            "С Новым годом и Рождеством, мастер!"
        )
    )
    rich["snowglobe"]["voxels"] = [
        {"x": x, "y": y, "z": z, "color": "#fff"} for x in range(2, 6) for y in range(0, 4) for z in range(2, 6)
    ]

    poor = _payload(secret_wish="Привет, добрый человек!")
    poor["snowglobe"]["voxels"] = [
        {"x": 3, "y": 0, "z": 3, "color": "#fff"},
        {"x": 4, "y": 0, "z": 3, "color": "#fff"},
        {"x": 3, "y": 0, "z": 4, "color": "#fff"},
        {"x": 4, "y": 0, "z": 4, "color": "#fff"},
    ]
    poor["melody"] = {k: [0] * 16 for k in ("celesta_track", "harp_track", "cello_track", "flute_track", "drum_track")}
    poor["melody"]["tempo_bpm"] = 100

    assert (await client.post("/api/gifts", json=poor, headers=session_headers("poor"))).status_code == 201
    assert (await client.post("/api/gifts", json=rich, headers=session_headers("rich"))).status_code == 201

    listed = (await client.get("/api/gifts")).json()
    assert len(listed) == 2
    assert listed[0]["quality_score"] >= listed[1]["quality_score"]
    assert [g["created_order"] for g in listed] == [1, 0]
    assert listed[0]["coordinates"]["sequence_number"] == 0


async def test_create_rejects_banned_text(client):
    for bad_wish in ("Только сегодня казино и ставки!", "С Новым годом! Мой скам https://evil.example"):
        response = await client.post("/api/gifts", json=_payload(secret_wish=bad_wish), headers=H1)
        assert response.status_code == 422, bad_wish
        assert "18+" in response.json()["detail"]


async def test_create_rejects_banned_public_fields(client):
    # Раньше проверялись только пожелание/бирка/гравировка — имя и город обходили фильтр.
    for field, value in (("author_display_name", "Казино Вулкан"), ("city", "х у й"), ("teaser_tag", "сукa")):
        response = await client.post("/api/gifts", json=_payload(**{field: value}), headers=H1)
        assert response.status_code == 422, field


async def test_create_allows_normal_words_previously_blocked(client):
    wish = "Волшебного года! Не болей, пусть будет много сюрпризов и тёплого хлеба на столе."
    response = await client.post("/api/gifts", json=_payload(secret_wish=wish), headers=H1)
    assert response.status_code == 201, response.text


async def test_create_rejects_short_wish(client):
    response = await client.post("/api/gifts", json=_payload(secret_wish="коротко"), headers=H1)
    assert response.status_code == 422


async def test_create_rejects_invalid_shapes(client):
    bad_color = copy.deepcopy(GIFT_PAYLOAD)
    bad_color["snowglobe"]["voxels"][0]["color"] = "red;background:url(x)"
    assert (await client.post("/api/gifts", json=bad_color, headers=H1)).status_code == 422

    bad_track = copy.deepcopy(GIFT_PAYLOAD)
    bad_track["melody"]["celesta_track"] = [7] * 15
    assert (await client.post("/api/gifts", json=bad_track, headers=H1)).status_code == 422

    bad_enum = copy.deepcopy(GIFT_PAYLOAD)
    bad_enum["packaging"]["box_shape"] = "<script>"
    assert (await client.post("/api/gifts", json=bad_enum, headers=H1)).status_code == 422


async def test_create_rejects_phallic_voxels(client):
    payload = copy.deepcopy(GIFT_PAYLOAD)
    payload["snowglobe"]["voxels"] = PHALLIC_VOXELS
    response = await client.post("/api/gifts", json=payload, headers=H1)
    assert response.status_code == 422
    assert "Топологический" in response.json()["detail"]


async def test_contact_normalized_and_encrypted(client, db_session):
    created = (
        await client.post("/api/gifts", json=_payload(contact_handle="https://t.me/polar_nav"), headers=H1)
    ).json()
    user = await db_session.get(User, created["my_user_id"])
    from app.core.security import decrypt_contact

    assert user.contact_type == "telegram"
    assert decrypt_contact(user.encrypted_contact) == "@polar_nav"
    assert user.session_fingerprint.startswith("h1:"), "в БД хранится только хеш токена"


async def test_gift_limit_per_user(client, monkeypatch):
    from app.core import config

    monkeypatch.setattr(config, "MAX_GIFTS_PER_USER", 2)
    assert (await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=H1)).status_code == 201
    assert (await client.post("/api/gifts", json=_payload(teaser_tag="2"), headers=H1)).status_code == 201
    third = await client.post("/api/gifts", json=_payload(teaser_tag="3"), headers=H1)
    assert third.status_code == 409


async def test_light_candle_updates_score(client):
    created = (await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=H1)).json()
    lit = await client.post(f"/api/gifts/{created['id']}/candle", headers=H2)
    assert lit.status_code == 200, lit.text
    dto = lit.json()
    assert dto["candles_count"] == 2
    assert dto["quality_score"] > created["quality_score"]

    listed = (await client.get("/api/gifts")).json()
    assert listed[0]["candles_count"] == 2


async def test_candle_once_per_session_and_not_own(client):
    created = (await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=H1)).json()
    own = await client.post(f"/api/gifts/{created['id']}/candle", headers=H1)
    assert own.status_code == 403
    assert (await client.post(f"/api/gifts/{created['id']}/candle", headers=H2)).status_code == 200
    again = await client.post(f"/api/gifts/{created['id']}/candle", headers=H2)
    assert again.status_code == 409
    no_session = await client.post(f"/api/gifts/{created['id']}/candle")
    assert no_session.status_code == 401


async def test_light_candle_unknown_gift(client):
    response = await client.post("/api/gifts/missing-id/candle", headers=H1)
    assert response.status_code == 404


async def test_users_me_profile(client):
    unknown = await client.get("/api/users/me", headers=session_headers("ghost"))
    assert unknown.status_code == 200
    assert unknown.json()["user_id"] is None

    no_header = await client.get("/api/users/me")
    assert no_header.json()["user_id"] is None

    created = (await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=H1)).json()
    profile = (await client.get("/api/users/me", headers=H1)).json()
    assert profile["user_id"] == created["my_user_id"]
    assert profile["gift_ids"] == [created["id"]]
    assert profile["display_name"] == "Тестовый Мастер"


async def test_admin_quarantine_hides_gift(client):
    created = (await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=H1)).json()
    denied = await client.post(f"/api/gifts/{created['id']}/quarantine")
    assert denied.status_code == 403

    hidden = await client.post(f"/api/gifts/{created['id']}/quarantine", headers=ADMIN_HEADERS)
    assert hidden.status_code == 200
    assert (await client.get("/api/gifts")).json() == []

    shown = await client.post(
        f"/api/gifts/{created['id']}/quarantine", params={"hidden": "false"}, headers=ADMIN_HEADERS
    )
    assert shown.status_code == 200
    assert len((await client.get("/api/gifts")).json()) == 1


async def test_reports_auto_quarantine(client, monkeypatch):
    from app.core import config

    monkeypatch.setattr(config, "REPORT_QUARANTINE_THRESHOLD", 2)
    created = (await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=H1)).json()
    first = (await client.post(f"/api/gifts/{created['id']}/report", json={"reason": "spam"}, headers=H2)).json()
    assert first == {"gift_id": created["id"], "accepted": True, "quarantined": False}
    dup = (await client.post(f"/api/gifts/{created['id']}/report", headers=H2)).json()
    assert dup["accepted"] is False, "одна сессия — одна жалоба"
    second = (await client.post(f"/api/gifts/{created['id']}/report", headers=session_headers("3"))).json()
    assert second["quarantined"] is True
    assert (await client.get("/api/gifts")).json() == []


async def test_same_author_reused(client):
    first = (await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=H1)).json()
    second = (await client.post("/api/gifts", json=_payload(teaser_tag="Второй шар того же мастера"), headers=H1)).json()
    assert first["my_user_id"] == second["my_user_id"]


async def test_users_linked_to_gifts(client, db_session):
    created = (await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=H1)).json()
    gift = (await db_session.execute(select(Gift).where(Gift.id == created["id"]))).scalar_one()
    assert gift.author_id == created["my_user_id"]
    assert gift.genome_hash == created["genome_hash"]


async def test_rate_limit_returns_429(client, monkeypatch):
    from app.core import ratelimit

    monkeypatch.setattr(ratelimit, "ENABLED", True)
    created = (await client.post("/api/gifts", json=GIFT_PAYLOAD, headers=H1)).json()
    codes = []
    for i in range(125):
        r = await client.post(f"/api/gifts/{created['id']}/candle", headers=session_headers(f"v{i}"))
        codes.append(r.status_code)
    assert codes[0] == 200
    assert codes[-1] == 429
    assert "Retry-After" in r.headers
