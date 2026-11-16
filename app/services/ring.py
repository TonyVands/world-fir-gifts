import asyncio
import logging
import random
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import PROTECTED_PLACEHOLDER, crypto_service
from app.models import ExchangeRingHandshake, Gift, User

logger = logging.getLogger("uvicorn.error")

CYCLE_YEAR = 2026


class RingAlreadyFormed(Exception):
    pass


def build_exchange_ring_pairs(user_ids: list[str], cycle_year: int = CYCLE_YEAR) -> list[tuple[str, str]]:
    """Кольцо Чудес: детерминированный деранжмент-хоровод.

    Участники перемешиваются (seed зависит от цикла и состава) и дарят по кругу
    следующему участнику: никто не дарит себе, кольцо всегда единое.
    """
    unique_ids = list(dict.fromkeys(user_ids))
    total = len(unique_ids)
    if total < 2:
        return []

    rng = random.Random(f"{cycle_year}:{','.join(sorted(unique_ids))}")
    order = sorted(unique_ids)
    rng.shuffle(order)
    return [(order[i], order[(i + 1) % total]) for i in range(total)]


async def create_exchange_ring(
    session: AsyncSession,
    user_gift_map: dict[str, str],
    cycle_year: int = CYCLE_YEAR,
) -> list[ExchangeRingHandshake]:
    pairs = build_exchange_ring_pairs(list(user_gift_map.keys()), cycle_year)
    handshakes = [
        ExchangeRingHandshake(
            cycle_year=cycle_year,
            giver_user_id=giver_id,
            receiver_user_id=receiver_id,
            gift_id=user_gift_map[giver_id],
            giver_consent=False,
            receiver_consent=False,
        )
        for giver_id, receiver_id in pairs
    ]
    session.add_all(handshakes)
    return handshakes


async def is_ring_formed(session: AsyncSession, cycle_year: int = CYCLE_YEAR) -> bool:
    count = (
        await session.execute(
            select(func.count(ExchangeRingHandshake.id)).where(ExchangeRingHandshake.cycle_year == cycle_year)
        )
    ).scalar_one()
    return count > 0


async def form_ring(session: AsyncSession, cycle_year: int = CYCLE_YEAR) -> tuple[int, int]:
    """Формирует Кольцо из настоящих (не демо) мастеров. Возвращает (рукопожатий, участников)."""
    if await is_ring_formed(session, cycle_year):
        raise RingAlreadyFormed()

    rows = (
        await session.execute(
            select(Gift.author_id, Gift.id, User.encrypted_contact)
            .join(User, User.id == Gift.author_id)
            .where(Gift.is_quarantined.is_(False), User.is_demo.is_(False))
            .order_by(Gift.sequence_number.asc())
        )
    ).all()

    user_gift_map: dict[str, str] = {}
    skipped: set[str] = set()
    for author_id, gift_id, encrypted_contact in rows:
        if author_id in user_gift_map or author_id in skipped:
            continue
        # Мастер с нечитаемым контактом (утерян старый ключ) не сможет познакомиться
        # с партнёром — в Кольцо его не берём, его шар остаётся украшением Ёлки.
        if crypto_service.decrypt_contact(encrypted_contact or "") == PROTECTED_PLACEHOLDER:
            skipped.add(author_id)
            continue
        user_gift_map[author_id] = gift_id  # в Кольцо идёт первый шар мастера
    if skipped:
        logger.warning("[Ring] Пропущено мастеров с нечитаемым контактом: %s", len(skipped))

    handshakes = await create_exchange_ring(session, user_gift_map, cycle_year)
    if handshakes:
        await session.execute(
            update(Gift).where(Gift.id.in_([hs.gift_id for hs in handshakes])).values(is_matched=True)
        )
    try:
        await session.commit()
    except IntegrityError as exc:  # параллельный запуск — уникальные индексы не дадут задвоить
        await session.rollback()
        raise RingAlreadyFormed() from exc
    return len(handshakes), len(user_gift_map)


async def join_ring_late(session: AsyncSession, user_id: str, gift_id: str, cycle_year: int = CYCLE_YEAR) -> bool:
    """Вставляет опоздавшего мастера в уже сформированное Кольцо (только ДО распаковки).

    Берём случайное звено A→B и превращаем его в A→U→B. Пока никто не видел
    своих пар, это незаметно и честно: кольцо остаётся единым циклом.
    Возвращает True, если мастер добавлен. Коммит — на вызывающей стороне.
    """
    already = (
        await session.execute(
            select(func.count(ExchangeRingHandshake.id)).where(
                ExchangeRingHandshake.cycle_year == cycle_year,
                ExchangeRingHandshake.giver_user_id == user_id,
            )
        )
    ).scalar_one()
    if already:
        return False

    ids = (
        await session.execute(
            select(ExchangeRingHandshake.id).where(ExchangeRingHandshake.cycle_year == cycle_year)
        )
    ).scalars().all()
    if not ids:
        return False

    link_id = random.SystemRandom().choice(ids)
    link = (
        await session.execute(
            select(ExchangeRingHandshake).where(ExchangeRingHandshake.id == link_id).with_for_update()
        )
    ).scalar_one()
    old_receiver = link.receiver_user_id
    link.receiver_user_id = user_id
    await session.flush()  # сначала освобождаем «слот» получателя B (уникальный индекс)
    session.add(
        ExchangeRingHandshake(
            cycle_year=cycle_year,
            giver_user_id=user_id,
            receiver_user_id=old_receiver,
            gift_id=gift_id,
        )
    )
    await session.execute(update(Gift).where(Gift.id == gift_id).values(is_matched=True))
    await session.flush()
    return True


async def ring_auto_match_loop(session_factory, match_at: datetime, cycle_year: int = CYCLE_YEAR) -> None:
    """Фоновая задача: формирует Кольцо в RING_MATCH_AT без участия админа."""
    while True:
        now = datetime.now(timezone.utc)
        if now >= match_at:
            try:
                async with session_factory() as session:
                    created, participants = await form_ring(session, cycle_year)
                logger.info("[Ring] Кольцо Чудес сформировано автоматически: %s пар, %s мастеров.", created, participants)
                return
            except RingAlreadyFormed:
                return
            except Exception:  # БД может моргнуть — пробуем снова
                logger.exception("[Ring] Ошибка автоформирования Кольца, повтор через 30 с.")
                await asyncio.sleep(30)
                continue
        await asyncio.sleep(min(60.0, max(1.0, (match_at - now).total_seconds())))
