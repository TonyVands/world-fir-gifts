"""«Ярус памяти»: создание, модерация, свечи, жалобы, отпечаток, удаление."""

import base64
import hashlib

import pytest

from app.services import memorial as memsvc
from tests.conftest import ADMIN_HEADERS, session_headers


def portrait(w=24, h=28):
    px = bytes((x + y) % 3 if 3 <= x < w - 3 else 255 for y in range(h) for x in range(w))
    depth = bytes((x * 15) // w for y in range(h) for x in range(w))
    return {
        "w": w,
        "h": h,
        "palette": ["#c89a7a", "#3b2a20", "#e8d0b8"],
        "px": base64.b64encode(px).decode(),
        "depth": base64.b64encode(depth).decode(),
    }


def payload(**kw):
    base = {
        "full_name": "Мария Ивановна Петрова",
        "birth_date": "1941",
        "death_date": "2019-03-08",
        "epitaph": "Пекла самые вкусные пироги",
        "relation": "внук / внучка",
        "energy": "warm",
        "melody": "moonlight",
        "portrait": portrait(),
        "heir_confirm": True,
        "pd_consent": True,
        "terms_accepted": True,
    }
    base.update(kw)
    return base


@pytest.fixture(autouse=True)
def fake_stamp(monkeypatch):
    async def _stamp(h):
        return memsvc.OTS_MAGIC + b"\x01\x08" + bytes.fromhex(h) + b"\xf0\x10" + b"x" * 16 + b"\x08\x00\x83\xdf\xe3\x0d\x2e\xf9\x0c\x8e\x00"

    monkeypatch.setattr(memsvc, "stamp", _stamp)


async def test_requires_heir_confirmation(client):
    res = await client.post("/api/memorials", json=payload(heir_confirm=False), headers=session_headers("m1"))
    assert res.status_code == 422


async def test_rejects_bad_portrait_and_dates(client):
    h = session_headers("m2")
    bad = portrait()
    bad["px"] = base64.b64encode(b"\x09" * (24 * 28)).decode()  # индекс вне палитры
    assert (await client.post("/api/memorials", json=payload(portrait=bad), headers=h)).status_code == 422
    assert (await client.post("/api/memorials", json=payload(death_date="2099-01-01"), headers=h)).status_code == 422
    assert (await client.post("/api/memorials", json=payload(birth_date="2020"), headers=h)).status_code == 422


async def test_full_flow(client):
    owner, guest = session_headers("m3"), session_headers("m4")
    res = await client.post("/api/memorials", json=payload(), headers=owner)
    assert res.status_code == 201, res.text
    mid = res.json()["id"]
    assert res.json()["status"] == "pending"
    assert res.json()["energy"] == "warm" and res.json()["melody"] == "moonlight"

    # До проверки видна только автору
    assert (await client.get(f"/api/memorials/{mid}", headers=guest)).status_code == 404
    lst = (await client.get("/api/memorials", headers=owner)).json()
    assert [m["id"] for m in lst["mine"]] == [mid] and lst["items"] == []
    assert (await client.post(f"/api/memorials/{mid}/candle", headers=guest)).status_code == 404

    # Модерация
    assert (await client.post(f"/api/memorials/{mid}/moderate?approve=true")).status_code in (401, 403)
    ok = await client.post(f"/api/memorials/{mid}/moderate?approve=true", headers=ADMIN_HEADERS)
    assert ok.status_code == 200 and ok.json()["stamped"] is True

    items = (await client.get("/api/memorials", headers=guest)).json()["items"]
    assert items[0]["id"] == mid and "portrait" in items[0]

    # Свеча — раз в сутки
    c1 = (await client.post(f"/api/memorials/{mid}/candle", headers=guest)).json()
    c2 = (await client.post(f"/api/memorials/{mid}/candle", headers=guest)).json()
    assert c1["candles"] == 1 and c2["already"] is True and c2["candles"] == 1

    # Запись и отпечаток согласованы: хеш файла = хеш в .ots
    rec = await client.get(f"/api/memorials/{mid}/record.json")
    ots = await client.get(f"/api/memorials/{mid}/proof.ots")
    digest = hashlib.sha256(rec.content).digest()
    assert ots.content.startswith(memsvc.OTS_MAGIC + b"\x01\x08" + digest)
    assert b"salt" in rec.content

    cert = await client.get(f"/memory/{mid}/certificate")
    assert cert.status_code == 200 and "Мария Ивановна" in cert.text
    png = await client.get(f"/api/memorials/{mid}/portrait.png")
    assert png.content[:4] == b"\x89PNG"

    # Две жалобы «человек жив» — память уходит на повторную проверку
    await client.post(f"/api/memorials/{mid}/report", json={"reason": "alive"}, headers=session_headers("r1"))
    r = await client.post(f"/api/memorials/{mid}/report", json={"reason": "alive"}, headers=session_headers("r2"))
    assert r.json()["hidden"] is True
    assert (await client.get(f"/api/memorials/{mid}", headers=guest)).status_code == 404

    # Удалить может только автор
    assert (await client.delete(f"/api/memorials/{mid}", headers=guest)).status_code == 404
    assert (await client.delete(f"/api/memorials/{mid}", headers=owner)).status_code == 200
    assert (await client.get(f"/api/memorials/{mid}", headers=owner)).status_code == 404


async def test_delete_my_data_removes_memorials(client):
    h = session_headers("m5")
    mid = (await client.post("/api/memorials", json=payload(), headers=h)).json()["id"]
    assert (await client.delete("/api/users/me", headers=h)).status_code == 200
    assert (await client.get(f"/api/memorials/{mid}", headers=h)).status_code == 404


async def test_per_session_limit(client):
    h = session_headers("m6")
    codes = [(await client.post("/api/memorials", json=payload(), headers=h)).status_code for _ in range(4)]
    assert codes[:3] == [201, 201, 201] and codes[3] == 409


def test_merge_calendar_replies():
    a, b = b"\xf0\x01a\x08", b"\xf0\x01b\x08"
    assert memsvc._merge_calendar_replies([a, b]) == b"\xff" + a + b
    assert memsvc._merge_calendar_replies([a]) == a


async def test_legal_memory_page(client):
    res = await client.get("/legal/memory")
    assert res.status_code == 200 and "152.1" in res.text


async def test_detailed_portrait_and_unknown_choices(client):
    h = session_headers("m7")
    res = await client.post(
        "/api/memorials", json=payload(portrait=portrait(64, 80), energy="evil", melody="x"), headers=h
    )
    assert res.status_code == 201, res.text
    assert res.json()["energy"] == "light" and res.json()["melody"] == "quiet_candle"
    too_big = await client.post("/api/memorials", json=payload(portrait=portrait(64, 96)), headers=h)
    assert too_big.status_code == 422


def custom_melody(**kw):
    base = {
        "tempo_bpm": 72,
        "celesta_track": [9, 0, 0, 10, 0, 0, 9, 0, 7, 0, 0, 8, 0, 0, 7, 0],
        "harp_track": [1, 0, 4, 0, 7, 0, 4, 0, 2, 0, 5, 0, 8, 0, 5, 0],
        "cello_track": [1] + [0] * 7 + [2] + [0] * 7,
        "flute_track": [0] * 16,
        "voices": {"celesta": "musicbox", "flute": "choir", "harp": "accordion"},
    }
    base.update(kw)
    return base


async def test_custom_melody(client):
    h = session_headers("m8")
    res = await client.post("/api/memorials", json=payload(melody="custom", melody_custom=custom_melody()), headers=h)
    assert res.status_code == 201, res.text
    got = res.json()
    assert got["melody"] == "custom"
    mel = got["melody_custom"]
    assert mel["tempo_bpm"] == 72 and mel["celesta_track"][0] == 9
    assert mel["voices"] == {"celesta": "musicbox", "flute": "choir"}  # громкий тембр (accordion) не из мягкого набора — отброшен
    assert "drum_track" not in mel
    again = (await client.get(f"/api/memorials/{got['id']}", headers=h)).json()
    assert again["melody_custom"] == mel
    # у готовых мелодий своей нет
    other = await client.post("/api/memorials", json=payload(melody="moonlight"), headers=h)
    assert other.json()["melody_custom"] is None


async def test_custom_melody_validation(client):
    h = session_headers("m9")
    cases = [
        None,  # нет мелодии
        custom_melody(tempo_bpm=150),  # слишком быстро
        custom_melody(celesta_track=[0] * 16, harp_track=[0] * 16, cello_track=[0] * 16),  # тишина
        custom_melody(celesta_track=[1, 2, 3]),  # не 16 шагов
        custom_melody(harp_track=[99] * 16),  # нота вне диапазона
        custom_melody(voices={"harp": "no_such_voice"}),  # неизвестный тембр
    ]
    for c in cases:
        res = await client.post("/api/memorials", json=payload(melody="custom", melody_custom=c), headers=h)
        assert res.status_code == 422, c


async def test_relation_must_be_from_list(client):
    h = session_headers("k0")
    assert (await client.post("/api/memorials", json=payload(relation="кто угодно"), headers=h)).status_code == 422
    assert (await client.post("/api/memorials", json=payload(relation=""), headers=h)).status_code == 422


async def test_kin_confirmation(client):
    owner, kin, other = session_headers("k1"), session_headers("k2"), session_headers("k3")
    res = await client.post("/api/memorials", json=payload(), headers=owner)
    mid, token = res.json()["id"], res.json()["kin_token"]
    assert token and res.json()["kin_count"] == 0

    # Чужим токен не виден
    assert "kin_token" not in (await client.get(f"/api/memorials/{mid}?kin={token}", headers=kin)).json()
    # Без токена до одобрения — 404, с токеном — видно
    assert (await client.get(f"/api/memorials/{mid}", headers=kin)).status_code == 404
    assert (await client.get(f"/api/memorials/{mid}?kin=wrong", headers=kin)).status_code == 404
    assert (await client.get(f"/api/memorials/{mid}?kin={token}", headers=kin)).status_code == 200

    body = {"relation": "сын / дочь", "consent": True, "token": token}
    # Автор не может подтверждать сам себя; без согласия и с левой степенью — 422; без токена — 404
    assert (await client.post(f"/api/memorials/{mid}/kin", json=body, headers=owner)).status_code == 409
    assert (await client.post(f"/api/memorials/{mid}/kin", json={**body, "consent": False}, headers=kin)).status_code == 422
    assert (await client.post(f"/api/memorials/{mid}/kin", json={**body, "relation": "друг"}, headers=kin)).status_code == 422
    assert (await client.post(f"/api/memorials/{mid}/kin", json={**body, "token": ""}, headers=other)).status_code == 404

    ok = await client.post(f"/api/memorials/{mid}/kin", json=body, headers=kin)
    assert ok.status_code == 200 and ok.json()["kin_count"] == 1
    assert (await client.post(f"/api/memorials/{mid}/kin", json=body, headers=kin)).status_code == 409

    # После одобрения токен не нужен, счётчик виден всем
    await client.post(f"/api/memorials/{mid}/moderate?approve=true", headers=ADMIN_HEADERS)
    pub = (await client.get(f"/api/memorials/{mid}", headers=other)).json()
    assert pub["kin_count"] == 1 and "kin_token" not in pub
    again = await client.post(f"/api/memorials/{mid}/kin", json={**body, "relation": "внук / внучка", "token": ""}, headers=other)
    assert again.status_code == 200 and again.json()["kin_count"] == 2


async def test_kin_count_drops_when_confirmer_deletes_data(client):
    owner, kin = session_headers("k4"), session_headers("k5")
    res = await client.post("/api/memorials", json=payload(), headers=owner)
    mid, token = res.json()["id"], res.json()["kin_token"]
    await client.post(f"/api/memorials/{mid}/kin", json={"relation": "сын / дочь", "consent": True, "token": token}, headers=kin)
    assert (await client.get(f"/api/memorials/{mid}", headers=owner)).json()["kin_count"] == 1
    assert (await client.delete("/api/users/me", headers=kin)).status_code == 200
    assert (await client.get(f"/api/memorials/{mid}", headers=owner)).json()["kin_count"] == 0
