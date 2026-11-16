import hashlib

from sqlalchemy import select, text

from app.database import engine
from app.migrations import run_migrations
from app.models import ExchangeRingHandshake, Gift, User

LEGACY_TOKEN = "wfg-lx2k3abc-abcdefgh"


def _gift(author_id: str, seq: int) -> Gift:
    return Gift(
        author_id=author_id,
        sequence_number=seq,
        snowglobe={},
        packaging={},
        melody={},
        card_preview={"teaser_tag": "t", "author_display_name": "a", "city": "c", "totem_pet": "p"},
        secret_wish="Старое пожелание из прошлой версии",
        encrypted_contact="x",
        quality_score=50.0,
        candles_count=1,
        reports_count=0,
        is_quarantined=False,
        is_matched=False,
        genome_hash="0x0",
    )


async def test_migrations_upgrade_legacy_data(client, db_session):
    async with engine.begin() as conn:
        await conn.execute(text("DROP INDEX IF EXISTS uq_gifts_sequence_number"))

    seed = User(session_fingerprint="seed-user-0001", display_name="S", city="C", encrypted_contact="x")
    seed2 = User(session_fingerprint="seed-user-0002", display_name="S2", city="C", encrypted_contact="x")
    real = User(session_fingerprint=LEGACY_TOKEN, display_name="R", city="C", encrypted_contact="x")
    real2 = User(session_fingerprint="wfg-other-legacy-token", display_name="R2", city="C", encrypted_contact="x")
    db_session.add_all([seed, seed2, real, real2])
    await db_session.flush()
    g_seed, g_seed2 = _gift(seed.id, 0), _gift(seed2.id, 1)
    g_real, g_real2 = _gift(real.id, 1), _gift(real2.id, 2)  # дубль sequence_number=1
    db_session.add_all([g_seed, g_seed2, g_real, g_real2])
    await db_session.flush()
    db_session.add_all(
        [
            ExchangeRingHandshake(giver_user_id=seed.id, receiver_user_id=seed2.id, gift_id=g_seed.id),
            ExchangeRingHandshake(giver_user_id=real.id, receiver_user_id=real2.id, gift_id=g_real.id),
        ]
    )
    await db_session.commit()

    async with engine.begin() as conn:
        await conn.run_sync(run_migrations)
        await conn.run_sync(run_migrations)  # идемпотентность

    db_session.expire_all()
    users = {u.display_name: u for u in (await db_session.execute(select(User))).scalars().all()}
    assert users["S"].is_demo and users["S2"].is_demo
    assert not users["R"].is_demo
    assert users["R"].session_fingerprint == "h1:" + hashlib.sha256(LEGACY_TOKEN.encode()).hexdigest()

    handshakes = (await db_session.execute(select(ExchangeRingHandshake))).scalars().all()
    assert [(h.giver_user_id, h.receiver_user_id) for h in handshakes] == [(real.id, real2.id)]

    seqs = sorted((await db_session.execute(select(Gift.sequence_number))).scalars().all())
    assert seqs == [0, 1, 2, 3]

    # Старый браузер со старым токеном продолжает узнаваться.
    profile = (await client.get("/api/users/me", headers={"X-Session-Token": LEGACY_TOKEN})).json()
    assert profile["user_id"] == real.id
