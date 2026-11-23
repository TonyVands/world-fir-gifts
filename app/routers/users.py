from fastapi import APIRouter, Depends, Request
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config, ratelimit
from app.core.auth import find_user_by_hash, optional_session_hash, require_session_hash
from app.database import get_db
from app.models import (
    CandleLight,
    ExchangeRingHandshake,
    Gift,
    GiftCandle,
    GiftReport,
    MaxLink,
    TelegramLink,
    User,
)
from app.schemas import UserProfileDTO

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserProfileDTO)
async def get_my_profile(
    session_hash: str | None = Depends(optional_session_hash),
    session: AsyncSession = Depends(get_db),
):
    # Токен приходит в заголовке X-Session-Token, а не в URL — не оседает в логах прокси.
    user = await find_user_by_hash(session, session_hash) if session_hash else None
    if user is None:
        return UserProfileDTO(user_id=None, max_gifts=config.MAX_GIFTS_PER_USER)

    gift_ids = list(
        (
            await session.execute(
                select(Gift.id).where(Gift.author_id == user.id).order_by(Gift.sequence_number.asc())
            )
        ).scalars().all()
    )
    return UserProfileDTO(
        user_id=user.id,
        display_name=user.display_name,
        city=user.city,
        totem_pet=user.totem_pet,
        gift_ids=gift_ids,
        max_gifts=config.MAX_GIFTS_PER_USER,
    )


@router.delete("/me")
async def delete_my_data(
    request: Request,
    session_hash: str = Depends(require_session_hash),
    session: AsyncSession = Depends(get_db),
):
    """Отзыв согласия и удаление всех своих данных (ст. 9, 21 152-ФЗ).

    Удаляются: шары мастера и всё, что к ним привязано (свечи, жалобы, звенья
    Кольца Чудес), подписки на уведомления, свечи, зажжённые этим браузером,
    и сама запись мастера с именем, городом и контактом.
    """
    ratelimit.enforce(request, "delete_me", limit=5, window_s=600, extra_key=session_hash)
    from app.models import Memorial
    from app.routers.memorials import delete_memorials

    mem_ids = list((await session.execute(select(Memorial.id).where(Memorial.creator_hash == session_hash))).scalars().all())
    await delete_memorials(session, mem_ids)
    from app.models import MemorialCandle, MemorialKin, MemorialReport

    await session.execute(delete(MemorialCandle).where(MemorialCandle.voter_hash == session_hash))
    await session.execute(delete(MemorialReport).where(MemorialReport.reporter_hash == session_hash))
    await session.execute(delete(MemorialKin).where(MemorialKin.confirmer_hash == session_hash))
    user = await find_user_by_hash(session, session_hash)
    if user is None:
        await session.commit()
        return {"deleted": bool(mem_ids), "gifts": 0}
    gift_ids = list((await session.execute(select(Gift.id).where(Gift.author_id == user.id))).scalars().all())
    if gift_ids:
        await session.execute(delete(GiftCandle).where(GiftCandle.gift_id.in_(gift_ids)))
        await session.execute(delete(CandleLight).where(CandleLight.gift_id.in_(gift_ids)))
        await session.execute(delete(GiftReport).where(GiftReport.gift_id.in_(gift_ids)))
    ring_conds = [ExchangeRingHandshake.giver_user_id == user.id, ExchangeRingHandshake.receiver_user_id == user.id]
    if gift_ids:
        ring_conds.append(ExchangeRingHandshake.gift_id.in_(gift_ids))
    await session.execute(delete(ExchangeRingHandshake).where(or_(*ring_conds)))
    await session.execute(delete(CandleLight).where(CandleLight.voter_hash == session_hash))
    await session.execute(delete(GiftCandle).where(GiftCandle.voter_hash == session_hash))
    await session.execute(delete(GiftReport).where(GiftReport.reporter_hash == session_hash))
    await session.execute(delete(TelegramLink).where(TelegramLink.user_id == user.id))
    await session.execute(delete(MaxLink).where(MaxLink.user_id == user.id))
    if gift_ids:
        await session.execute(delete(Gift).where(Gift.id.in_(gift_ids)))
    await session.execute(delete(User).where(User.id == user.id))
    await session.commit()
    from app.routers.gifts import invalidate_showcase

    invalidate_showcase()
    return {"deleted": True, "gifts": len(gift_ids)}
