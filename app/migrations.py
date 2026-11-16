"""Лёгкие идемпотентные миграции схемы (без Alembic).

create_all создаёт только отсутствующие таблицы, поэтому новые колонки и
индексы для уже существующих баз (Postgres в /data на Amvera) добавляются
здесь. Каждый шаг можно безопасно запускать при каждом старте.
"""

import hashlib
import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

logger = logging.getLogger("uvicorn.error")

HASH_PREFIX = "h1:"


def _columns(conn: Connection, table: str) -> set[str]:
    return {c["name"] for c in inspect(conn).get_columns(table)}


def _add_is_demo(conn: Connection) -> None:
    if "is_demo" in _columns(conn, "users"):
        return
    conn.execute(text("ALTER TABLE users ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE"))
    logger.info("[Migrate] users.is_demo добавлена.")


def _mark_demo_users(conn: Connection) -> None:
    # Сидер всегда создавал пользователей с отпечатком seed-user-XXXX.
    conn.execute(
        text("UPDATE users SET is_demo = TRUE WHERE session_fingerprint LIKE 'seed-user-%' AND is_demo = FALSE")
    )


def _hash_legacy_fingerprints(conn: Connection) -> None:
    rows = conn.execute(
        text("SELECT id, session_fingerprint FROM users WHERE session_fingerprint NOT LIKE 'h1:%'")
    ).all()
    for user_id, fingerprint in rows:
        hashed = HASH_PREFIX + hashlib.sha256((fingerprint or "").encode("utf-8")).hexdigest()
        conn.execute(
            text("UPDATE users SET session_fingerprint = :h WHERE id = :id"),
            {"h": hashed, "id": user_id},
        )
    if rows:
        logger.info("[Migrate] Захешировано сессионных отпечатков: %s", len(rows))


def _drop_demo_ring(conn: Connection) -> None:
    """Старый сидер формировал Кольцо из демо-мастеров, из-за чего настоящее
    Кольцо уже не могло быть создано (409). Удаляем такие рукопожатия."""
    result = conn.execute(
        text(
            "DELETE FROM exchange_ring_handshakes WHERE "
            "giver_user_id IN (SELECT id FROM users WHERE is_demo = TRUE) OR "
            "receiver_user_id IN (SELECT id FROM users WHERE is_demo = TRUE)"
        )
    )
    if result.rowcount:
        conn.execute(
            text(
                "UPDATE gifts SET is_matched = FALSE WHERE author_id IN "
                "(SELECT id FROM users WHERE is_demo = TRUE)"
            )
        )
        logger.info("[Migrate] Удалено демо-рукопожатий: %s", result.rowcount)


def _renumber_duplicate_sequences(conn: Connection) -> None:
    dup = conn.execute(
        text("SELECT sequence_number FROM gifts GROUP BY sequence_number HAVING COUNT(*) > 1 LIMIT 1")
    ).first()
    if dup is None:
        return
    rows = conn.execute(text("SELECT id FROM gifts ORDER BY sequence_number, created_at, id")).all()
    # Два прохода, чтобы не наткнуться на временные коллизии.
    for idx, (gift_id,) in enumerate(rows):
        conn.execute(text("UPDATE gifts SET sequence_number = :s WHERE id = :id"), {"s": -1 - idx, "id": gift_id})
    for idx, (gift_id,) in enumerate(rows):
        conn.execute(text("UPDATE gifts SET sequence_number = :s WHERE id = :id"), {"s": idx, "id": gift_id})
    logger.warning("[Migrate] Найдены дубли sequence_number — подарки перенумерованы.")


def _create_index(conn: Connection, ddl: str, name: str) -> None:
    try:
        if conn.dialect.name == "postgresql":
            # В Postgres ошибка обрывает транзакцию — изолируем шаг в SAVEPOINT.
            with conn.begin_nested():
                conn.execute(text(ddl))
        else:
            conn.execute(text(ddl))
    except Exception as exc:  # дубли в старых данных не должны ронять старт
        logger.error("[Migrate] Не удалось создать индекс %s: %s", name, exc)


def run_migrations(conn: Connection) -> None:
    _add_is_demo(conn)
    _mark_demo_users(conn)
    _hash_legacy_fingerprints(conn)
    _drop_demo_ring(conn)
    _renumber_duplicate_sequences(conn)
    _create_index(
        conn,
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_gifts_sequence_number ON gifts (sequence_number)",
        "uq_gifts_sequence_number",
    )
    _create_index(
        conn,
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_handshake_cycle_giver "
        "ON exchange_ring_handshakes (cycle_year, giver_user_id)",
        "uq_handshake_cycle_giver",
    )
    _create_index(
        conn,
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_handshake_cycle_receiver "
        "ON exchange_ring_handshakes (cycle_year, receiver_user_id)",
        "uq_handshake_cycle_receiver",
    )
